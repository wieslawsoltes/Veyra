"""Verify source transport; never accept bytes without the original Git hash."""
import base64
import concurrent.futures
import json
import pathlib
import urllib.error
from verify_packets import api, decode_packet, git_sha

ROOT = pathlib.Path('.source-import')
spec = pathlib.Path('.github/workflows/verify-recovery.yml').read_text()
EXPECTED = spec.split("expected = '''", 1)[1].split("'''.split()", 1)[0].split()
assert len(EXPECTED) == 58
corrections = {}
for path in sorted(ROOT.glob('corrections*.json')):
    for name, rows in json.loads(path.read_text()).items():
        corrections.setdefault(name, {}).update(rows)


def verify(index):
    sha = EXPECTED[index]
    size = min(12288, 710984 - index * 12288)
    name = 'part-%03d.xz-part' % index
    candidates = []
    if (ROOT / name).exists():
        candidates.append((ROOT / name).read_bytes())
    halves = sorted(ROOT.glob('part-%03d-*.xz-part' % index))
    if halves:
        candidates.append(b''.join(p.read_bytes() for p in halves))
    if (ROOT / (name + '.b64')).exists():
        try:
            candidates.append(base64.b64decode((ROOT / (name + '.b64')).read_text(), validate=True))
        except Exception:
            pass
    for data in candidates:
        if len(data) == size and git_sha(data) == sha:
            return {'index': index, 'status': 'verified', 'source': 'committed-bytes', 'sha': sha}
    try:
        stored = base64.b64decode(api('GET', 'git/blobs/' + sha)['content'])
        if len(stored) != size or git_sha(stored) != sha:
            raise ValueError('Invalid retained Git object')
        return {'index': index, 'status': 'verified', 'source': 'retained-object', 'sha': sha}
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    packet = ROOT / ('retry-%03d.txt' % index)
    if not packet.exists():
        return {'index': index, 'status': 'missing'}
    rows = {}
    for line in packet.read_text().splitlines():
        if line.strip():
            number = int(line.split()[0])
            if number in rows:
                raise ValueError('Duplicate packet line')
            rows[number] = line
    for number, line in corrections.get(packet.name, {}).items():
        assert int(number) == int(line.split()[0])
        rows[int(number)] = line
    needed = (4 * ((size + 2) // 3) + 255) // 256
    if len(rows) != needed:
        return {'index': index, 'status': 'incomplete-packet', 'lines': len(rows), 'needed': needed}
    try:
        data = decode_packet('\n'.join(rows[i] for i in range(needed)), sha, size)
        result = api('POST', 'git/blobs', {'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
        assert result['sha'] == sha
        return {'index': index, 'status': 'verified', 'source': 'checked-packet', 'sha': sha}
    except Exception as error:
        return {'index': index, 'status': 'needs-repair', 'error': str(error)}


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(verify, range(len(EXPECTED))))
report = {'verified': sum(r['status'] == 'verified' for r in results), 'total': len(EXPECTED), 'blocks': results}
pathlib.Path('publication-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
if any(r['status'] == 'needs-repair' for r in results):
    raise SystemExit(1)
