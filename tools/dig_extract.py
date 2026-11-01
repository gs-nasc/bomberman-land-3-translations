"""Extract every entry of a Bomberman Land 3 .DIG archive.

Archive header (array of 16-byte records, terminated by an all-zero record):
  u32 start_sector, u32 size_sectors (decompressed), u32 sub_count, u32 comp_sectors
  comp_sectors == 0 -> stored raw.
Each decompressed entry begins with `sub_count` 16-byte records:
  u32 type, u32 size, u32 offset (from entry start), u32 0

Usage: dig_extract.py ARCHIVE.DIG OUT_DIR
Writes OUT_DIR/eNNNN.bin (whole entry) and OUT_DIR/eNNNN/sMM_tTYPE.bin, plus index.tsv.
"""
import os
import struct
import sys

from digcomp import decompress

SECTOR = 2048


def read_header(d):
    entries = []
    i = 0
    while True:
        rec = struct.unpack_from('<4I', d, i * 16)
        if rec == (0, 0, 0, 0):
            break
        entries.append(rec)
        i += 1
    return entries


def load_entry(d, rec):
    start, size, _, comp = rec
    if comp:
        return decompress(d[start * SECTOR:(start + comp) * SECTOR], size * SECTOR)
    return d[start * SECTOR:(start + size) * SECTOR]


def main(path, out):
    d = open(path, 'rb').read()
    os.makedirs(out, exist_ok=True)
    entries = read_header(d)
    with open(os.path.join(out, 'index.tsv'), 'w', encoding='utf-8') as idx:
        idx.write('entry\tstart\tsize_sec\tsubs\tcomp_sec\tsub\ttype\tsize\toffset\n')
        for n, rec in enumerate(entries):
            data = load_entry(d, rec)
            open(os.path.join(out, f'e{n:04d}.bin'), 'wb').write(data)
            sub_dir = os.path.join(out, f'e{n:04d}')
            os.makedirs(sub_dir, exist_ok=True)
            for k in range(rec[2]):
                typ, size, off, _ = struct.unpack_from('<4I', data, k * 16)
                open(os.path.join(sub_dir, f's{k:02d}_t{typ}.bin'), 'wb').write(data[off:off + size])
                idx.write('\t'.join(map(str, (n, *rec, k, typ, size, off))) + '\n')
            print(f'{n}/{len(entries)}', end='\r', flush=True)
    print(f'{path}: {len(entries)} entries')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
