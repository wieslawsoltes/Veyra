"""Recover exact source packets; CRCs locate typos, Git SHA verifies every byte."""
import base64
import hashlib
import itertools
import json
import os
import pathlib
import re
import urllib.error
import urllib.request
import zlib

ALPHABET = b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='

def git_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def candidates(text, target, size):
    data = text.encode('ascii')
    found = [text] if len(data) == size else []
    crc = zlib.crc32(data)
    if len(data) == size and crc == target:
        return found
    def keep(candidate):
        if zlib.crc32(candidate) == target:
            found.append(candidate.decode('ascii'))
    if len(data) == size + 1:
        for i in range(len(data)):
            keep(data[:i] + data[i+1:])
    elif len(data) == size - 1:
        for i in range(len(data) + 1):
            for symbol in ALPHABET:
                keep(data[:i] + bytes([symbol]) + data[i:])
    elif len(data) == size:
        wanted = target ^ crc
        seen = {}
        work = bytearray(data)
        for i, old in enumerate(data):
            for symbol in ALPHABET:
                if symbol == old:
                    continue
                work[i] = symbol
                delta = zlib.crc32(work) ^ crc
                if delta == wanted:
                    found.append(work.decode('ascii'))
                for j, other in seen.get(delta ^ wanted, ()):
                    if j == i:
                        continue
                    work[j] = other
                    keep(work)
                    work[j] = data[j]
                seen.setdefault(delta, []).append((i, symbol))
            work[i] = old
    found = list(dict.fromkeys(found))
    if not found or len(found) > 16:
        raise ValueError('Line needs an exact replacement')
    return found

def decode_packet(text, expected, byte_size):
    encoded_size = 4 * ((byte_size + 2) // 3)
    count = (encoded_size + 255) // 256
    rows = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        index, crc, value = line.split(maxsplit=2)
        index = int(index)
        if index in rows or not 0 <= index < count:
            raise ValueError('Duplicate or invalid line index')
        if not re.fullmatch(r'[0-9a-f]{8}', crc):
            raise ValueError('Invalid line checksum')
        size = min(256, encoded_size - index * 256)
        try:
            rows[index] = candidates(value.strip(), int(crc, 16), size)
        except Exception as error:
            raise ValueError('Packet line %03d: %s' % (index, error)) from error
    if len(rows) != count:
        raise ValueError('Packet is missing lines')
    variants = [rows[i] for i in range(count)]
    combinations = 1
    for options in variants:
        combinations *= len(options)
    if combinations > 65536:
        raise ValueError('Too many ambiguous line repairs')
    for choice in itertools.product(*variants):
        try:
            data = base64.b64decode(''.join(choice), validate=True)
        except ValueError:
            continue
        if len(data) == byte_size and git_sha(data) == expected:
            return data
    raise ValueError('Reconstructed packet does not match its original Git SHA')

def api(method, route, payload=None):
    request = urllib.request.Request(
        'https://api.github.com/repos/wieslawsoltes/Veyra/' + route,
        data=None if payload is None else json.dumps(payload).encode(),
        method=method,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

def main():
    spec = pathlib.Path('.github/workflows/verify-recovery.yml').read_text()
    expected = spec.split("expected = '''", 1)[1].split("'''.split()", 1)[0].split()
    assert len(expected) == 58 and all(re.fullmatch('[a-f0-9]{40}', s) for s in expected)
    report = []
    for path in sorted(pathlib.Path('.source-import').glob('retry-*.txt')):
        index = int(path.stem.split('-')[1])
        if not 0 <= index < len(expected):
            raise ValueError('Invalid packet index')
        sha = expected[index]
        try:
            existing = api('GET', 'git/blobs/' + sha)
            data = base64.b64decode(existing['content'])
            assert git_sha(data) == sha
            report.append({'index': index, 'status': 'already-verified', 'sha': sha})
            continue
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        size = min(12288, 710984 - index * 12288)
        try:
            data = decode_packet(path.read_text(), sha, size)
            created = api('POST', 'git/blobs', {'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
            assert created['sha'] == sha
            report.append({'index': index, 'status': 'verified', 'sha': sha})
        except Exception as error:
            report.append({'index': index, 'status': 'needs-repair', 'error': str(error)})
    pathlib.Path('packet-verification.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    if any(item['status'] == 'needs-repair' for item in report):
        raise SystemExit(1)

if __name__ == '__main__':
    main()
