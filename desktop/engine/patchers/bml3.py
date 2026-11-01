"""Bomberman Land 3 (PS2, Japan, SLPM-62643): translated TSV + player's disc -> translated ISO.

Same result as tools/encode.py, without the one-time 1.6 GB extraction: only the .DIG entries that
hold a touched font or a table bound to one are decompressed, into a temporary folder laid out like
dig_extract.py's output, and encode.run does the rest.
"""
import os
import shutil
import struct
import tempfile

import encode
from digcomp import decompress
from disc import SECTOR, DiscError, Image, raw_to_iso, resolve

ID = 'bml3'
NAME = 'Bomberman Land 3 (PS2, SLPM-62643)'
KIND = 'ps2-iso'
ACCEPT = ['iso', 'bin', 'cue']
SERIAL = 'SLPM_626.43'
# sizes of the untouched .DIG files; an already translated disc has rebuilt (larger) ones
ORIGINAL_DIGS = {'CDDATA': 145211392, 'CDDATA0': 34002944, 'CDDATA1': 41068544, 'CDDATA2': 216424448,
                 'CDDATA4': 65837056, 'CDDATA5': 837632}
OUT_NAME = 'Bomberman Land 3 ({lang}).iso'

# share of the bar per stage (start, end); the copy is longer for a BIN, which is converted
STAGES = {'copia': (0, 15), 'dig': (15, 25), 'cenas': (25, 45), 'fontes': (45, 88), 'recompacta': (88, 97), 'iso': (97, 100)}
LABELS = {'copia': 'Copiando o disco', 'dig': 'Lendo os arquivos do jogo', 'cenas': 'Abrindo as cenas',
          'fontes': 'Desenhando as fontes', 'recompacta': 'Recompactando', 'iso': 'Gravando o disco traduzido'}


def detect(path):
    """Raise DiscError unless path is an untouched copy of the game; returns a short description."""
    with Image(path) as img:
        try:
            cnf = img.read('SYSTEM.CNF').decode('ascii', 'replace')
        except DiscError:
            raise DiscError('não é um disco de PlayStation 2')
        if SERIAL not in cnf:
            raise DiscError('este não é o Bomberman Land 3 japonês (SLPM-62643)')
        files = img.listdir()
        for arc, size in ORIGINAL_DIGS.items():
            got = files.get(f'{arc}.DIG')
            if not got:
                raise DiscError(f'{arc}.DIG não está no disco')
            if got[1] != size:
                raise DiscError('este disco já foi modificado; use a cópia original do jogo')
    return NAME


def bundled_ttfs(fonts_dir):
    """Noto fonts shipped with the app (same look on every machine); None falls back to the system's."""
    chain = [['NotoSans-Bold.ttf'], ['NotoSansCJK-Black.ttc', 'NotoSansJP-Black.ttf', 'NotoSansJP-Black.otf']]
    found = []
    for slot in chain:
        hit = next((os.path.join(fonts_dir, n) for n in slot if os.path.isfile(os.path.join(fonts_dir, n))), None)
        if hit:
            found.append(hit)
    return found or None


def needed_entries(tables, font_of):
    """(archive, entry) of every touched font and of every table bound to one."""
    fonts = set(encode.touched_fonts(tables, font_of))
    rids = fonts | {s for s in tables if font_of[s] in fonts}
    return sorted({(encode.ARCS[(r & 0xffff) >> 12], r >> 16) for r in rids})


def unpack_entries(iso_root, dig_root, entries, step):
    """Write dig_root/ARC/eNNNN.bin, eNNNN/sMM_tTYPE.bin and index.tsv for the given entries only."""
    by_arc = {}
    for arc, e in entries:
        by_arc.setdefault(arc, []).append(e)
    done = 0
    for arc, es in by_arc.items():
        out = os.path.join(dig_root, arc)
        os.makedirs(out, exist_ok=True)
        rows = ['entry\tstart\tsize_sec\tsubs\tcomp_sec\tsub\ttype\tsize\toffset']
        with open(os.path.join(iso_root, f'{arc}.DIG'), 'rb') as fh:
            for e in es:
                fh.seek(e * 16)
                rec = struct.unpack('<4I', fh.read(16))
                start, size, subs, comp = rec
                fh.seek(start * SECTOR)
                data = decompress(fh.read(comp * SECTOR), size * SECTOR) if comp else fh.read(size * SECTOR)
                open(os.path.join(out, f'e{e:04d}.bin'), 'wb').write(data)
                sub_dir = os.path.join(out, f'e{e:04d}')
                os.makedirs(sub_dir, exist_ok=True)
                for k in range(subs):
                    typ, ln, off, _ = struct.unpack_from('<4I', data, k * 16)
                    open(os.path.join(sub_dir, f's{k:02d}_t{typ}.bin'), 'wb').write(data[off:off + ln])
                    rows.append('\t'.join(map(str, (e, *rec, k, typ, ln, off))))
                done += 1
                step(done, len(entries))
        open(os.path.join(out, 'index.tsv'), 'w', encoding='utf-8').write('\n'.join(rows) + '\n')


def apply(src, tsv, lang, out, progress, log, fonts_dir=None):
    """Build the translated ISO at `out`. progress(pct, label); log(text). Returns skipped tables."""
    def stage(name):
        a, b = STAGES[name]
        return lambda done, total: progress(a + (b - a) * done / max(total, 1), LABELS[name])

    detect(src)
    tables, font_of = encode.read_tsv(tsv, lang)
    entries = needed_entries(tables, font_of)
    if not entries:
        raise DiscError('ainda não há texto traduzido neste idioma')
    ttfs = (fonts_dir and bundled_ttfs(fonts_dir)) or encode.default_ttfs()
    log('fontes para letras novas: ' + ', '.join(os.path.basename(t) for t in ttfs))

    part = out + '.part'
    tmp = tempfile.mkdtemp(prefix='glifo-')
    try:
        image, raw = resolve(src)
        if raw:
            raw_to_iso(image, part, stage('copia'))
        else:
            copy_with_progress(image, part, stage('copia'))
        iso_root, dig_root = os.path.join(tmp, 'iso'), os.path.join(tmp, 'dig')
        os.makedirs(iso_root)
        arcs = sorted({arc for arc, _ in entries})
        with Image(part) as img:
            for n, arc in enumerate(arcs):
                a, b = STAGES['dig']
                img.extract(f'{arc}.DIG', os.path.join(iso_root, f'{arc}.DIG'),
                            lambda d, t: progress(a + (b - a) * (n + d / t) / len(arcs), LABELS['dig']))
        unpack_entries(iso_root, dig_root, entries, stage('cenas'))

        def on_encode(done, total, what):
            stage({'fontes': 'fontes', 'dig': 'recompacta', 'iso': 'iso'}[what])(done, total)

        skipped = encode.run(dig_root, iso_root, part, tables, font_of, part, ttfs, True, log, on_encode)
        progress(100, LABELS['iso'])
        os.replace(part, out)
        return skipped
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        if os.path.exists(part):
            os.remove(part)


def copy_with_progress(src, dst, step, chunk=16 << 20):
    total = os.path.getsize(src)
    done = 0
    with open(src, 'rb') as f, open(dst, 'wb') as o:
        while True:
            b = f.read(chunk)
            if not b:
                break
            o.write(b)
            done += len(b)
            step(done, total)
