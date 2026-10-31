"""Bomberman Land 3 .DIG compression (reversed from SLPM_626.43 @ 0x12a010/0x12a070).

Bitstream of 9-bit tokens, LSB-first, read in chunks of 0x9000 bytes
(the CD thread feeds 0x9000-byte chunks and resets the bit position per chunk;
0x9000 bytes = exactly 32768 tokens, so the stream is continuous).

Token:
  bit8 = 1 -> literal byte (bits 0-7)
  bit8 = 0 -> copy: slot = bits 3-7 (0..31), length = bits 0-2 + 1 (1..8)
              source = hist[ctx][slot] (absolute output position)
After every token:
  hist[ctx][cursor[ctx]] = output position where the token started
  cursor[ctx] = (cursor[ctx] + 1) & 31
  ctx = last output byte
ctx starts at 0. Decoding stops once `size` bytes are produced.
"""

CHUNK = 0x9000


def decompress(src, size):
    out = bytearray()
    hist = [[0] * 32 for _ in range(256)]
    cur = [0] * 256
    ctx = 0
    n = len(src)
    src = bytes(src) + b'\0'
    pos = 0  # bit position in current stream
    while len(out) < size and (pos >> 3) < n:
        byte = pos >> 3
        tok = ((src[byte] | (src[byte + 1] << 8)) >> (pos & 7)) & 0x1ff
        pos += 9
        start = len(out)
        if tok & 0x100:
            out.append(tok & 0xff)
        else:
            p = hist[ctx][tok >> 3]
            for _ in range((tok & 7) + 1):
                out.append(out[p])
                p += 1
        h = hist[ctx]
        h[cur[ctx]] = start
        cur[ctx] = (cur[ctx] + 1) & 31
        ctx = out[-1]
    return bytes(out[:size])


def compress(data):
    """Greedy encoder: longest match (2..8) among the written history slots of the current ctx."""
    data = bytes(data)
    n = len(data)
    hist = [[0] * 32 for _ in range(256)]
    cur = [0] * 256
    filled = [0] * 256
    ctx = 0
    acc = nbits = 0
    out = bytearray()
    i = 0
    while i < n:
        h = hist[ctx]
        best_len, best_slot = 1, -1
        limit = min(8, n - i)
        target = data[i:i + limit]
        for slot in range(filled[ctx]):
            p = h[slot]
            k = 0
            while k < limit and data[p + k] == target[k]:
                k += 1
            if k > best_len:
                best_len, best_slot = k, slot
                if k == limit:
                    break
        if best_slot >= 0:
            tok = (best_slot << 3) | (best_len - 1)
        else:
            best_len = 1
            tok = 0x100 | data[i]
        acc |= tok << nbits
        nbits += 9
        while nbits >= 8:
            out.append(acc & 0xff)
            acc >>= 8
            nbits -= 8
        h[cur[ctx]] = i
        cur[ctx] = (cur[ctx] + 1) & 31
        filled[ctx] = min(32, filled[ctx] + 1)
        i += best_len
        ctx = data[i - 1]
    if nbits:
        out.append(acc & 0xff)
    return bytes(out)
