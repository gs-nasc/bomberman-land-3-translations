"""Search executables/overlays for references to DIG resource IDs ((entry<<16)|(file<<12)|local).

Finds raw 32-bit words and lui+ori/addiu pairs (within 8 instructions) that build the ID.
Usage: idsearch.py FILE [FILE...] -- ID_HEX [ID_HEX...]
"""
import struct
import sys


def find(d, ident):
    hits = []
    raw = struct.pack('<I', ident)
    i = -1
    while (i := d.find(raw, i + 1)) != -1:
        if i % 4 == 0:
            hits.append(('word', i))
    hi, lo = ident >> 16, ident & 0xffff
    his = {hi, (ident + 0x8000) >> 16 & 0xffff}
    n = len(d) // 4
    words = struct.unpack_from(f'<{n}I', d)
    for k, w in enumerate(words):
        if w >> 26 == 0x0f and (w & 0xffff) in his:
            rt = (w >> 16) & 31
            for j in range(k + 1, min(n, k + 9)):
                w2 = words[j]
                op = w2 >> 26
                if (w2 >> 21) & 31 == rt and op in (0x09, 0x0d):
                    imm = w2 & 0xffff
                    val = ((w & 0xffff) << 16) + (imm if op == 0x0d or imm < 0x8000 else imm - 0x10000)
                    if val & 0xffffffff == ident:
                        hits.append(('code', k * 4))
                    break
    return hits


if __name__ == '__main__':
    sep = sys.argv.index('--')
    files, ids = sys.argv[1:sep], [int(x, 16) for x in sys.argv[sep + 1:]]
    for f in files:
        d = open(f, 'rb').read()
        for ident in ids:
            for kind, off in find(d, ident):
                print(f'{f}\t{ident:08x}\t{kind}\t{off:#x}')
