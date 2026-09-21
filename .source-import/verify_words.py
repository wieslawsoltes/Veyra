"""Recover original Git blobs from compact error-corrected packets."""
import base64
import concurrent.futures
import hashlib
import json
import pathlib
import re
import urllib.error
from verify_packets import api, git_sha
from word_codec import decode_packet

root = pathlib.Path('.source-import')
dictionary_bytes = (root / 'words.json').read_bytes()
assert hashlib.sha256(dictionary_bytes).hexdigest() == '455ad82d1f94bd1fc32c83e716a8141c4ade62e2c071718cbf6f1393e216bfdf'
dictionary = json.loads(dictionary_bytes)
spec = pathlib.Path('.github/workflows/verify-recovery.yml').read_text()
expected = spec.split("expected = '''", 1)[1].split("'''.split()", 1)[0].split()
assert len(expected) == 58
corrections = {}
for file in sorted(root.glob('word-corrections*.json')):
    for index, rows in json.loads(file.read_text()).items():
        corrections.setdefault(int(index), {}).update({int(k): v for k, v in rows.items()})

def verify(index):
    sha = expected[index]
    size = min(12288, 710984 - index * 12288)
    try:
        data = base64.b64decode(api('GET', 'git/blobs/' + sha)['content'])
        assert git_sha(data) == sha and len(data) == size
        return {'index': index, 'status': 'verified', 'source': 'retained-object', 'sha': sha}
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    paths = sorted(root.glob('word-%03d-*.txt' % index))
    if not paths:
        return {'index': index, 'status': 'missing'}
    rows = {}
    for path in paths:
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            position = int(line.split()[0])
            if position in rows:
                raise ValueError('Duplicate packet row')
            rows[position] = line
    rows.update(corrections.get(index, {}))
    needed = (size + 127) // 128
    if sorted(rows) != list(range(needed)):
        return {'index': index, 'status': 'incomplete', 'rows': len(rows), 'needed': needed}
    try:
        data = decode_packet('\n'.join(rows[i] for i in range(needed)), size, dictionary)
        assert len(data) == size and git_sha(data) == sha, 'Original Git object hash mismatch'
        result = api('POST', 'git/blobs', {'encoding': 'base64', 'content': base64.b64encode(data).decode()})
        assert result['sha'] == sha
        return {'index': index, 'status': 'verified', 'source': 'corrected-packet', 'sha': sha}
    except Exception as error:
        return {'index': index, 'status': 'needs-repair', 'error': str(error)}

indices = sorted({int(path.name.split('-')[1]) for path in root.glob('word-*-*.txt')})
assert all(0 <= i < 58 for i in indices)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    report = list(pool.map(verify, indices))
pathlib.Path('word-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
if any(item['status'] == 'needs-repair' for item in report):
    raise SystemExit(1)
