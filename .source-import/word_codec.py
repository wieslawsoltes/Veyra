"""A deterministic prime-field, two-symbol-error-correcting source transport."""
import zlib


def solve(matrix, values, prime):
    rows = [[x % prime for x in row] + [value % prime] for row, value in zip(matrix, values)]
    count = len(rows)
    for col in range(count):
        pivot = next(i for i in range(col, count) if rows[i][col])
        rows[col], rows[pivot] = rows[pivot], rows[col]
        inv = pow(rows[col][col], -1, prime)
        rows[col] = [(x * inv) % prime for x in rows[col]]
        for i in range(count):
            if i != col:
                factor = rows[i][col]
                rows[i] = [(a - factor * b) % prime for a, b in zip(rows[i], rows[col])]
    return [row[-1] for row in rows]


def syndrome(values, prime):
    return [sum(v * pow(i + 1, k, prime) for i, v in enumerate(values)) % prime for k in range(4)]


def protect(values, prime):
    offsets = list(range(len(values) + 1, len(values) + 5))
    errors = syndrome(values, prime)
    check = solve([[pow(i, k, prime) for i in offsets] for k in range(4)], [-s for s in errors], prime)
    result = values + check
    assert syndrome(result, prime) == [0] * 4
    return result


def repair(values, prime):
    values = list(values)
    missing = [i for i, v in enumerate(values) if v is None]
    values = [v if v is not None else 0 for v in values]
    s0, s1, s2, s3 = s = syndrome(values, prime)
    if not any(s):
        return values
    if 2 < len(missing) <= 4:
        errors = solve([[pow(i + 1, k, prime) for i in missing] for k in range(len(missing))], s[:len(missing)], prime)
        for i, error in zip(missing, errors):
            values[i] = (values[i] - error) % prime
    elif len(missing) > 4:
        raise ValueError('Too many erased symbols')
    else:
        position = (s1 * pow(s0, -1, prime)) % prime if s0 else 0
        if 1 <= position <= len(values) and s2 == s0 * position ** 2 % prime and s3 == s0 * position ** 3 % prime:
            values[position - 1] = (values[position - 1] - s0) % prime
        else:
            det = (s1 * s1 - s0 * s2) % prime
            if not det:
                raise ValueError('Uncorrectable symbol errors')
            inv = pow(det, -1, prime)
            a = (s1 * s2 - s0 * s3) * inv % prime
            b = (s2 * s2 - s1 * s3) * inv % prime
            roots = [i for i in range(1, len(values) + 1) if (i * i - a * i + b) % prime == 0]
            if len(roots) != 2:
                raise ValueError('Uncorrectable symbol errors')
            i, j = roots
            first = (s1 - j * s0) * pow(i - j, -1, prime) % prime
            second = (s0 - first) % prime
            values[i - 1] = (values[i - 1] - first) % prime
            values[j - 1] = (values[j - 1] - second) % prime
    if any(syndrome(values, prime)):
        raise ValueError('Symbol repair failed')
    return values


def digit_count(size, prime):
    count, capacity = 0, 1
    while capacity < 1 << (size * 8):
        capacity *= prime
        count += 1
    return count


def encode_row(data, dictionary):
    prime, words = dictionary['prime'], dictionary['words']
    digits = [0] * digit_count(len(data), prime)
    number = int.from_bytes(data, 'big')
    for i in range(len(digits) - 1, -1, -1):
        number, digits[i] = divmod(number, prime)
    assert number == 0
    return ' '.join(words[i] for i in protect(digits, prime))


def decode_row(text, size, crc, dictionary, lookup):
    prime = dictionary['prime']
    count = digit_count(size, prime) + 4
    values = [lookup.get(word) for word in text.split()]
    attempts = []
    if len(values) == count:
        attempts.append(values)
    elif len(values) == count - 1:
        attempts.extend(values[:i] + [None] + values[i:] for i in range(count))
    elif len(values) == count + 1:
        attempts.extend(values[:i] + values[i + 1:] for i in range(len(values)))
    else:
        raise ValueError(f'Incorrect symbol count: {len(values)}; expected {count}')
    matches = set()
    for attempt in attempts:
        try:
            repaired = repair(attempt, prime)
            number = 0
            for digit in repaired[:-4]:
                number = number * prime + digit
            data = number.to_bytes(size, 'big')
            if zlib.crc32(data) == crc:
                matches.add(data)
        except (ValueError, OverflowError, StopIteration):
            pass
    if len(matches) != 1:
        raise ValueError('Row needs exact replacement')
    return matches.pop()


def encode_packet(data, dictionary, width=128):
    rows = []
    for index, offset in enumerate(range(0, len(data), width)):
        piece = data[offset:offset + width]
        rows.append(f'{index:03d} {zlib.crc32(piece):08x} {encode_row(piece, dictionary)}')
    return '\n'.join(rows) + '\n'


def decode_packet(text, size, dictionary, width=128):
    rows, errors = {}, []
    lookup = {word: i for i, word in enumerate(dictionary['words'])}
    count = (size + width - 1) // width
    for line in text.splitlines():
        if not line.strip():
            continue
        index, crc, body = line.split(maxsplit=2)
        index = int(index)
        if index in rows or not 0 <= index < count:
            raise ValueError('Invalid or duplicate row index')
        row_size = min(width, size - index * width)
        try:
            rows[index] = decode_row(body, row_size, int(crc, 16), dictionary, lookup)
        except ValueError as error:
            rows[index] = None
            errors.append(f'{index:03d}: {error}')
    if len(rows) != count:
        raise ValueError('Missing packet rows: ' + str(sorted(set(range(count)) - rows.keys())))
    if errors:
        raise ValueError('; '.join(errors))
    return b''.join(rows[i] for i in range(count))
