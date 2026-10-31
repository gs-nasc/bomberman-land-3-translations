"""Check a rebuilt ISO against the translated TSV, reading it the way the game does
(ISO directory -> .DIG -> entry -> subfiles).

For every table bound to a font touched by the translation (or every table with --all), each string
is decoded with the font found in the rebuilt ISO and compared with `pt` (or the original text).
Also reports which sectors of the original image changed (only the PVD and the root directory
should) and checks that each rebuilt font's texture still validates against its glyph table.

Usage: verify.py DIG_OUT ORIGINAL.iso REBUILT.iso TRANSLATED.tsv [--all]
"""
import argparse
import os
import struct
import sys
from collections import defaultdict

from digcomp import decompress
from encode import find_dir_record, res_path
from fonttex import find_texture_in_dir, read_texture, validate
from textscan import decode, parse_glyphs, parse_strings

SECTOR = 2048


class IsoDig:
    def __init__(self, iso, dig_root):
        self.iso = iso
        self.dig_root = dig_root
        self.digs = {}
        self.entries = {}

    def dig(self, arc):
        if arc not in self.digs:
            rec = find_dir_record(self.iso, f'{arc}.DIG;1')
            lba, = struct.unpack_from('<I', self.iso, rec + 2)
            size, = struct.unpack_from('<I', self.iso, rec + 10)
            self.digs[arc] = self.iso[lba * SECTOR:lba * SECTOR + size]
        return self.digs[arc]

    def subfiles(self, arc, e):
        if (arc, e) not in self.entries:
            d = self.dig(arc)
            start, size, subs, comp = struct.unpack_from('<4I', d, e * 16)
            raw = (decompress(d[start * SECTOR:(start + comp) * SECTOR], size * SECTOR) if comp
                   else d[start * SECTOR:(start + size) * SECTOR])
            self.entries[arc, e] = [raw[o:o + n] for _, n, o in
                                    (struct.unpack_from('<3I', raw, k * 16) for k in range(subs))]
        return self.entries[arc, e]

    def resource(self, rid):
        arc, e, k, _ = res_path(self.dig_root, rid)
        return self.subfiles(arc, e)[k]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dig_root')
    ap.add_argument('original_iso')
    ap.add_argument('rebuilt_iso')
    ap.add_argument('tsv')
    ap.add_argument('--all', action='store_true')
    a = ap.parse_args(argv)

    orig = open(a.original_iso, 'rb').read()
    new = open(a.rebuilt_iso, 'rb').read()
    changed = [i // SECTOR for i in range(0, len(orig), SECTOR) if new[i:i + SECTOR] != orig[i:i + SECTOR]]
    print(f'setores alterados dentro da imagem original: {[hex(s) for s in changed]}')

    lines = open(a.tsv, encoding='utf-8').read().splitlines()
    head = lines[0].split('\t')
    col = {k: i for i, k in enumerate(head)}
    rows = [l.split('\t') + [''] * (len(head) - len(l.split('\t'))) for l in lines[1:]]
    touched = {r[col['font_res']] for r in rows if r[col['pt']]}
    rows = [r for r in rows if a.all or r[col['font_res']] in touched]
    src = IsoDig(new, a.dig_root)

    bad = 0
    by_table = defaultdict(list)
    for r in rows:
        by_table[r[col['string_res']], r[col['font_res']]].append(r)
    for (sid, fid), table in sorted(by_table.items()):
        glyphs = parse_glyphs(src.resource(int(fid, 16)))
        strings = parse_strings(src.resource(int(sid, 16)))
        for r in table:
            want = r[col['pt']] or r[col['text']]
            got = decode(strings[int(r[col['id']])], glyphs)
            if got != want:
                bad += 1
                if bad <= 10:
                    print(f'DIFERENTE {sid}#{r[col["id"]]}: esperado {want[:40]!r} obtido {got[:40]!r}')
    print(f'strings conferidas: {len(rows)}, diferentes: {bad}')

    tex_bad = 0
    for fid in sorted(touched):
        rid = int(fid, 16)
        arc, e, k, path = res_path(a.dig_root, rid)
        glyphs = parse_glyphs(src.resource(rid))
        tex_name = find_texture_in_dir(os.path.dirname(path), os.path.basename(path), parse_glyphs(open(path, 'rb').read()))
        tk = int(tex_name[1:].split('_')[0])
        ok, cells, beyond = validate(read_texture(src.subfiles(arc, e)[tk]), glyphs)
        tex_bad += not ok
        print(f'fonte {fid}: {glyphs["count"]} glifos, textura {"ok" if ok else "INVÁLIDA"} ({cells} células visíveis, {beyond} além do fim)')
    return 1 if bad or tex_bad or any(s not in (0x10, 0x16) for s in changed) else 0


if __name__ == '__main__':
    sys.exit(main())
