"""Re-insert translated text: TSV -> string tables + rebuilt fonts/textures -> .DIG -> ISO.

Input TSV: dialogos_jp.tsv (textscan.py) plus one column per language (`pt`, `es`, `en`...);
--lang picks the column (default `pt`) and an empty cell keeps the original.
Text syntax: plain characters, `\\n`, the tags of textscan.CONTROL ({PAG}, {COR:vermelho}...),
{XXXX} for a raw control code and {?n} for a raw glyph index. Any character below U+8100
(Latin, Greek, Cyrillic...) or with a 2-byte Shift-JIS code can be used.

Per font touched by a translation:
  * every table bound to that font (TSV `font_res`) is re-encoded; untranslated strings keep their
    original codes byte for byte;
  * characters already in the font reuse their glyph; others get new glyphs drawn with the first
    --ttf of the chain that has them (default: Noto Sans Bold, then Noto Sans CJK Black; Arial Bold
    and Yu Gothic Bold on Windows without Noto),
    placed in slots no bound table uses any more (never 0-12: the code prints digits from there),
    then appended; --no-reuse only appends;
  * the texture is rebuilt with full pages; growing past the original page count is reported
    because the scene's VRAM budget is unknown.
Each modified entry is re-laid out (16-byte aligned subfiles, keeping larger original alignments),
recompressed and appended to its .DIG; each modified .DIG is appended to the ISO and its directory
record repointed (the game opens the .DIG files by name, see SLPM_626.43 @ 0x12a7e0).

Usage: encode.py DIG_OUT ISO_ROOT GAME.iso TRANSLATED.tsv OUT_DIR [--lang pt] [--ttf FONT ...] [--no-reuse]
"""
import argparse
import os
import re
import shutil
import struct
import sys
from collections import defaultdict

from digcomp import compress
from fonttex import GlyphRenderer, find_texture_in_dir, get_cell, put_cell, read_texture, write_texture
from textscan import CONTROL, parse_glyphs, parse_strings

SECTOR = 2048
ARCS = ['CDDATA', 'CDDATA0', 'CDDATA1', 'CDDATA2', 'CDDATA4', 'CDDATA5']
PROTECTED = 13          # glyphs 0..12 ('　＋ー０..９') are addressed directly by game code
TAG_TO_CODE = {v: k for k, v in CONTROL.items()}
TOKEN = re.compile(r'\\n|\{[^}]*\}|.', re.S)
# Noto Sans covers Latin (incl. Polish, Czech, Turkish, Romanian...), Greek and Cyrillic; Noto Sans
# CJK catches any new Japanese character a translator may add. Each slot takes the first file found
# (Linux, then Windows/macOS font folders); Windows' Arial and Yu Gothic stand in when Noto is missing.
DEFAULT_TTFS = [
    ['/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf', 'NotoSans-Bold.ttf', 'arialbd.ttf'],
    ['/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc', 'NotoSansCJK-Black.ttc',
     'NotoSansCJKjp-Black.otf', 'NotoSansJP-Black.ttf', 'YuGothB.ttc', 'msgothic.ttc'],
]


def font_dirs():
    dirs = [os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')] if os.name == 'nt' else []
    if os.environ.get('LOCALAPPDATA'):
        dirs.append(os.path.join(os.environ['LOCALAPPDATA'], 'Microsoft', 'Windows', 'Fonts'))
    dirs += ['/Library/Fonts', os.path.expanduser('~/Library/Fonts'), os.path.expanduser('~/.local/share/fonts')]
    return dirs


def default_ttfs():
    """First existing file of each DEFAULT_TTFS slot (bare names are looked up in the font folders)."""
    found = []
    for slot in DEFAULT_TTFS:
        for name in slot:
            paths = [name] if os.path.isabs(name) else [os.path.join(d, name) for d in font_dirs()]
            hit = next((p for p in paths if os.path.isfile(p)), None)
            if hit:
                found.append(hit)
                break
    if not found:
        raise EncodeError('nenhuma fonte padrão encontrada (instale Noto Sans ou use --ttf)')
    return found


class EncodeError(Exception):
    pass


# ---------------------------------------------------------------- text

def tokenize(text):
    """Text -> list of ('code', int) for controls/raw glyphs and ('char', str) for characters."""
    out = []
    for tok in TOKEN.findall(text):
        if tok in TAG_TO_CODE:
            out.append(('code', TAG_TO_CODE[tok]))
        elif tok.startswith('{?') and tok.endswith('}'):
            out.append(('glyph', int(tok[2:-1])))
        elif re.fullmatch(r'\{[0-9A-Fa-f]{4}\}', tok):
            out.append(('code', int(tok[1:-1], 16)))
        elif tok.startswith('{') and len(tok) > 1:
            raise EncodeError(f'unknown tag {tok}')
        else:
            out.append(('char', tok))
    return out


def glyph_code(ch):
    """2-byte code stored in the glyph record. The renderer only uses the index, so new characters
    below U+8100 are stored as their big-endian code point (no SJIS code starts below 0x81) to
    keep the font readable; anything else must have a 2-byte Shift-JIS code."""
    if ord(ch) < 0x8100:
        return struct.pack('>H', ord(ch))
    try:
        b = ch.encode('shift_jis')
    except UnicodeEncodeError:
        raise EncodeError(f'character {ch!r} is above U+8100 and not in Shift-JIS')
    if len(b) != 2:
        raise EncodeError(f'character {ch!r} has no 2-byte Shift-JIS code')
    return b


# ---------------------------------------------------------------- font rebuild

def rebuild_font(glyph_bytes, tex_bytes, tables, ttfs, reuse, log):
    """tables: list of (strings_codes_or_None_per_string, tokens_per_string) for every bound table.
    Returns new glyph-table bytes, new texture bytes and {table_index: [codes per string]}."""
    glyphs = parse_glyphs(glyph_bytes)
    cell, tex_w = glyphs['cell'], glyphs['tex'][0]
    count = glyphs['count']
    recs = {}
    for i in range(count):
        idx, sj, adv, z = struct.unpack_from('<H2sHH', glyph_bytes, 16 + i * 8)
        recs[idx] = [sj, adv]
    char_to_glyph = {}
    for idx in sorted(glyphs['chars']):
        char_to_glyph.setdefault(glyphs['chars'][idx], idx)

    # glyphs still referenced by untranslated strings
    used = set(range(PROTECTED))
    for originals, tokens in tables:
        for orig, toks in zip(originals, tokens):
            if toks is None:
                used.update(c for c in orig if c < 0x8000)
            else:
                for kind, v in toks:
                    if kind == 'glyph':
                        used.add(v)
                    elif kind == 'char' and v in char_to_glyph:
                        used.add(char_to_glyph[v])

    # The original fonts only hold 2-byte SJIS glyphs, so ASCII and accented letters are all new.
    new_chars = []
    for _, tokens in tables:
        for toks in tokens:
            for kind, v in toks or ():
                if kind == 'char' and v not in char_to_glyph and v not in new_chars:
                    new_chars.append(v)

    free = [i for i in range(PROTECTED, count) if i not in used] if reuse else []
    slots = free[:len(new_chars)]
    slots += list(range(count, count + len(new_chars) - len(slots)))
    new_count = max(count, max(slots) + 1 if slots else 0)

    tex = read_texture(tex_bytes)
    old_pages = len(tex['pages'])
    renderer = GlyphRenderer(ttfs, cell, tex, count)
    missing = renderer.missing(new_chars)
    if missing:
        raise EncodeError(f'no --ttf has a glyph for {"".join(missing)!r}')
    clear = renderer.style['clear'] if renderer.style else renderer.ramp[0]
    per = (tex_w // cell) ** 2
    n_pages = -(-new_count // per)
    pages = [list(p) for p in tex['pages'][:n_pages]]
    while len(pages) < n_pages:
        pages.append([clear] * (256 * 256))
    blank = [clear] * (cell * cell)
    for ch, slot in zip(new_chars, slots):
        pixels, width = renderer.render(ch)
        put_cell(pages, slot, cell, tex_w, pixels)
        recs[slot] = [glyph_code(ch), width]
        char_to_glyph[ch] = slot
    for slot in range(count, new_count):
        if slot not in recs:
            put_cell(pages, slot, cell, tex_w, blank)
            recs[slot] = [b'\x81\x40', cell // 2]

    rest = new_count - (n_pages - 1) * per
    used_h = -(-rest // (tex_w // cell)) * cell
    if n_pages > old_pages:
        log(f'    AVISO: fonte cresceu de {old_pages} para {n_pages} páginas (risco de VRAM)')
    log(f'    glifos: {count} -> {new_count} ({len(new_chars)} novos, {len(free)} livres para reuso)')

    head = bytearray(glyph_bytes[:16])
    struct.pack_into('<H', head, 4, new_count)
    body = b''.join(struct.pack('<H2sHH', i, recs[i][0], recs[i][1], 0) for i in range(new_count))
    new_glyphs = bytes(head) + body

    encoded = []
    for originals, tokens in tables:
        strings = []
        for orig, toks in zip(originals, tokens):
            if toks is None:
                strings.append(orig)
                continue
            codes = [v if kind in ('code', 'glyph') else char_to_glyph[v] for kind, v in toks]
            strings.append(codes + [0x8000])
        encoded.append(strings)
    return new_glyphs, write_texture(tex, pages, used_h), encoded


def build_string_table(strings):
    n = len(strings)
    out = bytearray(struct.pack('<I', n))
    offs = []
    body = bytearray()
    for codes in strings:
        offs.append(4 + 4 * n + len(body))
        body += struct.pack(f'<{len(codes)}H', *codes)
    out += struct.pack(f'<{n}I', *offs) + body
    return bytes(out)


# ---------------------------------------------------------------- entry / DIG / ISO

def relayout_entry(raw, n_subs, replacements):
    """raw entry bytes + {sub_index: new bytes} -> new entry bytes (sector padded)."""
    recs = [list(struct.unpack_from('<3I', raw, k * 16)) for k in range(n_subs)]
    order = sorted(range(len(recs)), key=lambda k: recs[k][2])
    pos = 16 * len(recs)
    datas = {}
    for k in order:
        typ, size, off = recs[k]
        data = replacements.get(k, raw[off:off + size])
        align = 16
        while align < 128 and off % (align * 2) == 0:
            align *= 2
        pos = (pos + align - 1) & ~(align - 1)
        recs[k] = [typ, len(data), pos]
        datas[k] = data
        pos += len(data)
    out = bytearray((pos + SECTOR - 1) // SECTOR * SECTOR)
    for k, (typ, size, off) in enumerate(recs):
        struct.pack_into('<4I', out, k * 16, typ, size, off, 0)
        out[off:off + size] = datas[k]
    return bytes(out)


def rebuild_dig(dig_bytes, new_entries, log):
    d = bytearray(dig_bytes)
    end = (len(d) + SECTOR - 1) // SECTOR * SECTOR
    d += bytes(end - len(d))
    for e, raw in sorted(new_entries.items()):
        comp = compress(raw)
        comp_sec = (len(comp) + SECTOR - 1) // SECTOR
        start = len(d) // SECTOR
        d += comp + bytes(comp_sec * SECTOR - len(comp))
        _, _, subs, _ = struct.unpack_from('<4I', d, e * 16)
        struct.pack_into('<4I', d, e * 16, start, len(raw) // SECTOR, subs, comp_sec)
        log(f'  e{e:04d}: {len(raw)} bytes ({len(raw) // SECTOR} setores), comprimido {comp_sec} setores')
    return bytes(d)


def find_dir_record(iso, name):
    """Locate a root-directory record by ISO name (e.g. 'CDDATA.DIG;1'). Returns its byte offset."""
    root_lba, root_len = struct.unpack_from('<I', iso, 0x8000 + 156 + 2)[0], struct.unpack_from('<I', iso, 0x8000 + 156 + 10)[0]
    pos, end = root_lba * SECTOR, root_lba * SECTOR + root_len
    want = name.encode()
    while pos < end:
        ln = iso[pos]
        if ln == 0:
            pos = (pos // SECTOR + 1) * SECTOR
            continue
        nlen = iso[pos + 32]
        if iso[pos + 33:pos + 33 + nlen] == want:
            return pos
        pos += ln
    raise EncodeError(f'{name} not found in ISO root')


def patch_iso(src_iso, out_iso, new_digs, log):
    if os.path.abspath(src_iso) != os.path.abspath(out_iso):   # same path: patch in place
        shutil.copyfile(src_iso, out_iso)
    with open(out_iso, 'r+b') as f:
        iso = bytearray(f.read(0x8000 + 64 * SECTOR))
        f.seek(0, 2)
        size = f.tell()
        lba = (size + SECTOR - 1) // SECTOR
        f.write(bytes(lba * SECTOR - size))
        for name, data in new_digs.items():
            rec = find_dir_record(iso, f'{name}.DIG;1')
            f.seek(lba * SECTOR)
            f.write(data + bytes((-len(data)) % SECTOR))
            struct.pack_into('<I', iso, rec + 2, lba)
            struct.pack_into('>I', iso, rec + 6, lba)
            struct.pack_into('<I', iso, rec + 10, len(data))
            struct.pack_into('>I', iso, rec + 14, len(data))
            f.seek(rec)
            f.write(iso[rec:rec + 18])
            log(f'  {name}.DIG -> LBA {lba}, {len(data)} bytes')
            lba += (len(data) + SECTOR - 1) // SECTOR
        struct.pack_into('<I', iso, 0x8050, lba)
        struct.pack_into('>I', iso, 0x8054, lba)
        f.seek(0x8050)
        f.write(iso[0x8050:0x8058])
        f.truncate(lba * SECTOR)


# ---------------------------------------------------------------- driver

def res_path(dig_root, rid):
    """Resource ID -> (archive, entry, subfile path) using the extraction's index.tsv files."""
    e, typ = rid >> 16, rid & 0xffff
    arc = ARCS[typ >> 12]
    for row in open(os.path.join(dig_root, arc, 'index.tsv'), encoding='utf-8').read().splitlines()[1:]:
        f = row.split('\t')
        if int(f[0]) == e and int(f[6]) == typ:
            return arc, e, int(f[5]), os.path.join(dig_root, arc, f'e{e:04d}', f's{int(f[5]):02d}_t{typ}.bin')
    raise EncodeError(f'resource {rid:08x} not in index')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dig_root')
    ap.add_argument('iso_root')
    ap.add_argument('iso')
    ap.add_argument('tsv')
    ap.add_argument('out_dir')
    ap.add_argument('--lang', default='pt', help='TSV column holding the translation (default: pt)')
    ap.add_argument('--ttf', action='append',
                    help='font for new glyphs; repeat to build a fallback chain (default: Noto Sans Bold, Noto Sans CJK Black)')
    ap.add_argument('--no-reuse', action='store_true')
    a = ap.parse_args(argv)
    os.makedirs(a.out_dir, exist_ok=True)
    log_lines = []

    def log(msg):
        print(msg)
        log_lines.append(msg)

    ttfs = a.ttf or default_ttfs()
    log('fontes para letras novas: ' + ', '.join(ttfs))
    tables, font_of = read_tsv(a.tsv, a.lang)
    out_iso = os.path.join(a.out_dir, f'Bomberman Land 3 ({a.lang}).iso')
    skipped = run(a.dig_root, a.iso_root, a.iso, tables, font_of, out_iso, ttfs, not a.no_reuse, log,
                  dig_out=a.out_dir)
    open(os.path.join(a.out_dir, 'encode.log'), 'w', encoding='utf-8').write('\n'.join(log_lines) + '\n')
    return 1 if skipped else 0


def read_tsv(path, lang):
    """TSV -> ({string_res: {id: translation or None}}, {string_res: font_res})."""
    lines = open(path, encoding='utf-8').read().splitlines()
    head = lines[0].split('\t')
    col = {k: i for i, k in enumerate(head)}
    if lang not in col:
        raise EncodeError(f"TSV has no '{lang}' column")
    tables = defaultdict(dict)
    font_of = {}
    for line in lines[1:]:
        f = line.split('\t')
        f += [''] * (len(head) - len(f))
        sid = int(f[col['string_res']], 16)
        font_of[sid] = int(f[col['font_res']], 16)
        tables[sid][int(f[col['id']])] = f[col[lang]] or None
    return tables, font_of


def touched_fonts(tables, font_of):
    return sorted({font_of[s] for s, ids in tables.items() if any(ids.values())})


def run(dig_root, iso_root, iso, tables, font_of, out_iso, ttfs, reuse, log, progress=None, dig_out=None):
    """Write out_iso (and the new .DIG files to dig_out, if given); returns the string tables that
    could not be re-inserted.
    progress(done, total, stage) is called per font ('fontes'), per .DIG ('dig') and once for the ISO."""
    progress = progress or (lambda *_: None)
    fonts = touched_fonts(tables, font_of)
    if not fonts:
        log('nada para traduzir (coluna vazia)')
        return []
    replacements = defaultdict(dict)  # (arc, entry) -> {sub_index: bytes}
    skipped = []
    for n, fid in enumerate(fonts):
        progress(n, len(fonts), 'fontes')
        farc, fe, fk, fpath = res_path(dig_root, fid)
        glyph_bytes = open(fpath, 'rb').read()
        glyphs = parse_glyphs(glyph_bytes)
        tex_name = find_texture_in_dir(os.path.dirname(fpath), os.path.basename(fpath), glyphs)
        bound = sorted(s for s in tables if font_of[s] == fid)
        n_tr = sum(1 for s in bound for v in tables[s].values() if v)
        log(f'fonte {fid:08x} ({farc} e{fe:04d}): {len(bound)} tabelas, {n_tr} strings traduzidas')
        if not tex_name:
            skipped += bound
            log('    PULADA: textura desta fonte não identificada com segurança')
            continue
        tex_path = os.path.join(os.path.dirname(fpath), tex_name)
        work = []
        for sid in bound:
            spath = res_path(dig_root, sid)[3]
            originals = parse_strings(open(spath, 'rb').read())
            tokens = []
            for i in range(len(originals)):
                text = tables[sid].get(i)
                tokens.append(tokenize(text) if text else None)
            work.append((originals, tokens))
        try:
            new_glyphs, new_tex, encoded = rebuild_font(glyph_bytes, open(tex_path, 'rb').read(), work,
                                                        ttfs, reuse, log)
        except EncodeError as ex:
            skipped += bound
            log(f'    PULADA: {ex}')
            continue
        def replace(arc, e, k, path, data):
            # Untranslated tables re-encode to their original bytes; leaving them out keeps the
            # entries that only hold such tables (a shared font can be bound to dozens) untouched.
            if data != open(path, 'rb').read():
                replacements[arc, e][k] = data

        replace(farc, fe, fk, fpath, new_glyphs)
        replace(farc, fe, int(tex_name[1:].split('_')[0]), tex_path, new_tex)
        for sid, strings in zip(bound, encoded):
            sarc, se, sk, spath = res_path(dig_root, sid)
            replace(sarc, se, sk, spath, build_string_table(strings))

    by_arc = defaultdict(dict)
    for (arc, e), reps in replacements.items():
        raw = open(os.path.join(dig_root, arc, f'e{e:04d}.bin'), 'rb').read()
        with open(os.path.join(iso_root, f'{arc}.DIG'), 'rb') as fh:
            fh.seek(e * 16 + 8)
            n_subs, = struct.unpack('<I', fh.read(4))
        new = relayout_entry(raw, n_subs, reps)
        if len(new) > len(raw):
            log(f'  AVISO: {arc} e{e:04d} cresceu {len(raw)} -> {len(new)} bytes (memória da cena)')
        by_arc[arc][e] = new
    new_digs = {}
    for n, (arc, entries) in enumerate(by_arc.items()):
        progress(n, len(by_arc), 'dig')
        log(f'{arc}.DIG:')
        new_digs[arc] = rebuild_dig(open(os.path.join(iso_root, f'{arc}.DIG'), 'rb').read(), entries, log)
        if dig_out:
            open(os.path.join(dig_out, f'{arc}.DIG'), 'wb').write(new_digs[arc])
    progress(0, 1, 'iso')
    log('ISO:')
    patch_iso(iso, out_iso, new_digs, log)
    if skipped:
        log(f'tabelas não reinseridas: {", ".join(f"{s:08x}" for s in skipped)}')
    return skipped


if __name__ == '__main__':
    sys.exit(main())
