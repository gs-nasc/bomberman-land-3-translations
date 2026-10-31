"""Find dialogue in extracted .DIG entries (output of dig_extract.py).

Per-scene font ("glyph table"):
  u16 0, u16 1, u16 count, u16 tex_w, u16 tex_h, u16 cell_w, u16 cell_h, u16 0
  count x { u16 index, u8[2] sjis (big-endian), u16 advance_width, u16 0 }
  (fonts rebuilt by encode.py store new Latin-1 characters as 0x00XX in the sjis field)
String table:
  u32 count, u32 offset[count] (from table start), then strings of u16 LE codes:
  code < 0x8000 -> glyph index into the paired glyph table
  code >= 0x8000 -> control (0x8000 = end of string, 0x8001 = line break, others TBD)
Pairing table -> font: see fontbind.py (ELF group bindings + bigram model for the rest).

Usage: textscan.py DIG_OUT_DIR SLPM_626.43 MSG.MGC OUT.tsv
"""
import os
import struct
import sys


def parse_glyphs(d):
    if len(d) < 24:
        return None
    z, one, n, tw, th, cw, ch, z2 = struct.unpack_from('<8H', d, 0)
    if z or one != 1 or z2 or not n or not cw or cw != ch or len(d) < 16 + n * 8:
        return None
    table = {}
    for i in range(n):
        idx, = struct.unpack_from('<H', d, 16 + i * 8)
        sj = d[18 + i * 8:20 + i * 8]
        if sj[0] == 0:
            table[idx] = chr(sj[1])
            continue
        try:
            table[idx] = sj.decode('shift_jis')
        except UnicodeDecodeError:
            return None
    return {'count': n, 'cell': cw, 'tex': (tw, th), 'chars': table}


def parse_strings(d):
    if len(d) < 10:
        return None
    n, = struct.unpack_from('<I', d, 0)
    if not 0 < n < 4096 or 4 + 4 * n > len(d):
        return None
    offs = struct.unpack_from(f'<{n}I', d, 4)
    if offs[0] != 4 + 4 * n or any(b < a for a, b in zip(offs, offs[1:])) or offs[-1] >= len(d):
        return None
    out = []
    for o in offs:
        codes = []
        while o + 2 <= len(d):
            c, = struct.unpack_from('<H', d, o)
            codes.append(c)
            o += 2
            if c == 0x8000:
                break
        else:
            return None
        out.append(codes)
    return out


# Control codes, from the glyph-string renderer @ 0x14d050 (SLPM_626.43) and the variable
# expansion pass @ 0x14f5d0. Colours are GS RGB (0x80 = full).
CONTROL = {
    0x8001: '\\n',             # line break (x back to margin, y += line height)
    0x8036: '{PAG}',           # page break: wait for button, clear window (0x14e720)
    0x8006: '{TAM:1}',         # glyph size x1.0 (default)
    0x8005: '{TAM:0.8}',
    0x8007: '{TAM:1.5}',
    0x8003: '{TAM:0.6}',
    0x8004: '{TAM:2}',
    0x800A: '{COR:preto}',     # (0x00, 0x00, 0x00)
    0x800B: '{COR:vermelho}',  # (0x80, 0x00, 0x00)
    0x800C: '{COR:verde}',     # (0x00, 0x80, 0x00)
    0x800D: '{COR:azul}',      # (0x00, 0x00, 0x80)
    0x800E: '{COR:amarelo}',   # (0x80, 0x80, 0x00)
    0x800F: '{COR:rosa}',      # (0x80, 0x20, 0x80)
    0x8022: '{COR:laranja}',   # (0x80, 0x20, 0x00)
    0x8023: '{COR:branco}',    # (0x80, 0x80, 0x80)
    0x8024: '{COR}',           # back to the window's default colour
    0x8032: '{CONTORNO:off}',
    0x8033: '{CONTORNO}',      # outline on, colour (0, 0, 0)
    0x8034: '{CONTORNO:2}',    # outline on, one channel 0x40
    0x8035: '{CONTORNO:3}',    # outline on, two channels 0x40
    0x8009: '{ONDA}',          # wavy text on (sine on the y offset)
    0x8008: '{ONDA:off}',
    0x8031: '{ESP:1/2}',       # advance x by half a glyph
    0x8038: '{ESP:1/4}',
    0x8037: '{ESP:1}',
    0x8021: '{X8021}',         # bumps window counter +0x38; nothing in the text module reads it
    0x8025: '{NOME}',          # player name (save data + 0x10b4), drawn with the second font
    0x8100: '{VAR}',           # caller-supplied text, same font (list @ window+0x30)
    0x8101: '{VAR2}',          # caller-supplied text, second font (list @ window+0x2c)
    0x8102: '{FONTE2}',        # switch to the window's second glyph stream (inserted by 0x14f5d0)
    0x8103: '{FONTE1}',        # back to the main stream
}


def decode(codes, glyphs):
    s = []
    for c in codes:
        if c == 0x8000:
            break
        if c >= 0x8000:
            s.append(CONTROL.get(c, f'{{{c:04X}}}'))
        else:
            s.append(glyphs['chars'].get(c, f'{{?{c}}}'))
    return ''.join(s)


def main(dig_root, elf_path, msg_path, dump):
    from fontbind import bind  # fontbind imports the parsers above

    res, fonts, binding = bind(dig_root, elf_path, msg_path)
    with open(dump, 'w') as out:
        out.write('archive\tentry\tfile\tid\tstring_res\tfont_res\tmethod\tmargin\ttext\n')
        for sid in sorted(binding):
            fid, method, margin = binding[sid]
            path = res[sid][1]
            arc, entry, fname = path.split(os.sep)[-3:]
            strings = parse_strings(open(path, 'rb').read())
            for i, codes in enumerate(strings):
                out.write(f'{arc}\t{entry}\t{fname}\t{i}\t{sid:08x}\t{fid:08x}\t{method}\t'
                          f'{"" if margin is None else margin}\t{decode(codes, fonts[fid])}\n')


if __name__ == '__main__':
    main(*sys.argv[1:5])
