"""Per-scene font texture (a sibling subfile of each glyph table) and glyph rendering.

Texture file layout:
  u32 pages, u32 chunks, u64 0
  pages x GIF block (0x50 bytes; TEX0 at +0x40: psm 0x14 = PSMT4, 0x13 = PSMT8, tbw 4)
  pages x page record (20 bytes): u16 page_chunk, u16 0xffff, u32 -1, u16 clut_chunk, u16 0x0101,
                                  u32 0, u16 used_w, u16 used_h
  chunks x transfer (16 bytes): u32 0, u32 rel (from this record), u16 w32, u16 h32, u32 flag
  data, 0x40-aligned, in transfer order.
Pages may share CLUTs: one for all (chunks = pages + 1: page 0, CLUT, page 1, ...), one per page
(chunks = 2 * pages: page 0, CLUT 0, page 1, CLUT 1, ...) or anything in between; each page record
names its CLUT chunk, and a CLUT follows the first page that uses it.
Pages are 256x256 PSMT4 (CLUT 8x2 words, 16 colours) or PSMT8 (CLUT 16x16 words, 256 colours,
CSM1 order: bits 3 and 4 of the index swapped), uploaded as a w32 x h32 PSMCT32 rectangle; see
gsswizzle.py. Usually a white CLUT with an alpha ramp; some fonts are coloured with an outline.
Glyph i lives on page i // per_page at ((i % cols) * cell, (i % per_page) // cols * cell),
with cols = tex_w // cell (renderer @ 0x14d734).
"""
import os
import struct

from gsswizzle import psmct32_word_addr, psmt4_nibble_addr, psmt8_byte_addr

PAGE = 256
GIF_BLOCK = 0x50
HEADER_MAX = 0x800  # enough for the page records of 15 pages
GIF_TAG = bytes.fromhex('0480000000000010')  # first qword of every page's GIF block
PSMT4, PSMT8 = 0x14, 0x13

_MAPS = {}


def _file_map(psm, w32, h32):
    """For each pixel of a 256x256 page (row-major): index of its unit (nibble for PSMT4, byte for
    PSMT8) in a w32 x h32 PSMCT32 upload at (0, 0) of a 128-word-wide buffer, or -1 if not covered."""
    key = (psm, w32, h32)
    if key not in _MAPS:
        word_to_file = {}
        for y in range(h32):
            for x in range(w32):
                word_to_file[psmct32_word_addr(x, y, 2)] = y * w32 + x
        per_word, shift = (8, 3) if psm == PSMT4 else (4, 2)
        out = []
        for y in range(PAGE):
            for x in range(PAGE):
                a = psmt4_nibble_addr(x, y, 4) if psm == PSMT4 else psmt8_byte_addr(x, y, 4)
                w = word_to_file.get(a >> shift)
                out.append(-1 if w is None else w * per_word + (a & (per_word - 1)))
        _MAPS[key] = out
    return _MAPS[key]


def _unswizzle(raw, psm, w32, h32):
    m = _file_map(psm, w32, h32)
    if psm == PSMT4:
        return [0 if n < 0 else (raw[n >> 1] >> (4 * (n & 1))) & 15 for n in m]
    return [0 if n < 0 else raw[n] for n in m]


def _swizzle(pixels, psm, w32, h32):
    m = _file_map(psm, w32, h32)
    buf = bytearray(w32 * h32 * 4)
    for v, n in zip(pixels, m):
        if n < 0:
            continue
        if psm == PSMT4:
            buf[n >> 1] |= (v & 15) << (4 * (n & 1))
        else:
            buf[n] = v
    return bytes(buf)


def is_texture(d):
    if len(d) < 0x80:
        return False
    pages, chunks, pad = struct.unpack_from('<IIQ', d, 0)
    return (0 < pages < 16 and pages + 1 <= chunks <= 2 * pages and pad == 0 and d[0x10:0x18] == GIF_TAG
            and len(d) >= 0x10 + (GIF_BLOCK + 20) * pages)


def texture_shape(d):
    """(pages, tex_w, used height of the last page) from a texture header."""
    pages, = struct.unpack_from('<I', d, 0)
    rec = 0x10 + GIF_BLOCK * pages + 20 * (pages - 1)
    w, h = struct.unpack_from('<HH', d, rec + 16)
    return pages, w, h


def expected_shape(glyphs):
    cell = glyphs['cell']
    tex_w = glyphs['tex'][0]
    cols = tex_w // cell
    per = cols * (glyphs['tex'][1] // cell)
    pages = -(-glyphs['count'] // per)
    rest = glyphs['count'] - (pages - 1) * per
    return pages, tex_w, -(-rest // cols) * cell


def read_texture(d):
    pages, chunks = struct.unpack_from('<II', d, 0)
    rec_at = 0x10 + GIF_BLOCK * pages
    xfer_at = rec_at + 20 * pages
    xfers = []
    for i in range(chunks):
        a = xfer_at + 16 * i
        _, rel, w32, h32, flag = struct.unpack_from('<IIHHI', d, a)
        xfers.append((a + rel, w32, h32, flag))
    out = {'pages': [], 'cluts': [], 'clut_of_page': [], 'used': []}
    clut_ids = []
    for k in range(pages):
        tex0, = struct.unpack_from('<Q', d, 0x10 + GIF_BLOCK * k + 0x40)
        psm = (tex0 >> 20) & 0x3f
        pc, _, _, cc, _, _, w, h = struct.unpack_from('<HHIHHIHH', d, rec_at + 20 * k)
        at, w32, h32, flag = xfers[pc]
        out['pages'].append(_unswizzle(d[at:at + w32 * h32 * 4], psm, w32, h32))
        cat, cw, ch, cflag = xfers[cc]
        if cc not in clut_ids:
            clut_ids.append(cc)
            out['cluts'].append(d[cat:cat + cw * ch * 4])
        out['clut_of_page'].append(clut_ids.index(cc))
        out['used'].append((w, h))
        if k == 0:
            out.update(psm=psm, gif=d[0x10:0x10 + GIF_BLOCK], page_dims=(w32, h32, flag),
                       clut_dims=(cw, ch, cflag), tex_w=w)
    return out


def write_texture(tex, pages, used_h_last):
    """Rebuild a texture with the original's format (psm, CLUT assignment, upload rectangle of
    page 0) for `pages` (lists of 256x256 indices). Every page is written at page 0's size; pages
    beyond the original count reuse the last page's CLUT."""
    n = len(pages)
    clut_of = [tex['clut_of_page'][min(k, len(tex['clut_of_page']) - 1)] for k in range(n)]
    order = []  # (kind, page or clut) in chunk order; a CLUT follows the first page using it
    for k in range(n):
        order.append(('page', k))
        if ('clut', clut_of[k]) not in order:
            order.append(('clut', clut_of[k]))
    chunks = len(order)
    tex_w = tex['tex_w']
    head = bytearray(struct.pack('<IIQ', n, chunks, 0))
    head += tex['gif'] * n
    for k in range(n):
        pc = order.index(('page', k))
        cc = order.index(('clut', clut_of[k]))
        h = used_h_last if k == n - 1 else tex_w
        head += struct.pack('<HHIHHIHH', pc, 0xffff, 0xffffffff, cc, 0x0101, 0, tex_w, h)
    xfer_at = len(head)
    head += bytes(16 * chunks)
    data_at = (len(head) + 0x3f) & ~0x3f
    head += bytes(data_at - len(head))
    w32, h32, flag = tex['page_dims']
    cw, ch, cflag = tex['clut_dims']
    blobs = []
    pos = data_at
    for i, (kind, k) in enumerate(order):
        if kind == 'page':
            blob, dims = _swizzle(pages[k], tex['psm'], w32, h32), (w32, h32, flag)
        else:
            blob, dims = tex['cluts'][k], (cw, ch, cflag)
        struct.pack_into('<IIHHI', head, xfer_at + 16 * i, 0, pos - (xfer_at + 16 * i), *dims)
        blobs.append(blob)
        pos += len(blob)
    return bytes(head) + b''.join(blobs)


# ---------------------------------------------------------------- palette

def palette(tex, page=0):
    """Logical CLUT of a page: list of (r, g, b, a) indexed by pixel value."""
    raw = tex['cluts'][tex['clut_of_page'][page]]
    words = struct.unpack(f'<{len(raw) // 4}I', raw)
    if tex['psm'] == PSMT8:
        words = [words[(i & 0xe7) | ((i & 0x08) << 1) | ((i & 0x10) >> 1)] for i in range(256)]
    return [(w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, w >> 24) for w in words[:16 if tex['psm'] == PSMT4 else 256]]


def opaque(tex, page=0, threshold=0x10):
    return {i for i, c in enumerate(palette(tex, page)) if c[3] > threshold}


# ---------------------------------------------------------------- cells

def cell_origin(i, cell, tex_w):
    cols = tex_w // cell
    per = cols * (tex_w // cell)
    return i // per, (i % cols) * cell, (i % per) // cols * cell


def get_cell(pages, i, cell, tex_w):
    p, x0, y0 = cell_origin(i, cell, tex_w)
    px = pages[p]
    return [px[(y0 + y) * PAGE + x0 + x] for y in range(cell) for x in range(cell)]


def put_cell(pages, i, cell, tex_w, pixels):
    p, x0, y0 = cell_origin(i, cell, tex_w)
    while len(pages) <= p:
        pages.append([0] * (PAGE * PAGE))
    px = pages[p]
    for y in range(cell):
        for x in range(cell):
            px[(y0 + y) * PAGE + x0 + x] = pixels[y * cell + x]


def occupied_cells(tex, cell, max_cells):
    """Indices of cells holding any visible pixel."""
    vis = [opaque(tex, k) for k in range(len(tex['pages']))]
    out = set()
    for i in range(max_cells):
        p = cell_origin(i, cell, tex['tex_w'])[0]
        if p >= len(tex['pages']):
            break
        if any(v in vis[p] for v in get_cell(tex['pages'], i, cell, tex['tex_w'])):
            out.add(i)
    return out


def validate(tex, glyphs):
    """A texture belongs to a glyph table when every visible cell is a glyph index (< count).
    Returns (ok, n_visible_cells, n_visible_beyond_count)."""
    tex_w = glyphs['tex'][0]
    per = (tex_w // glyphs['cell']) ** 2
    if tex['tex_w'] != tex_w:
        return False, 0, 0
    cells = occupied_cells(tex, glyphs['cell'], len(tex['pages']) * per)
    beyond = sum(1 for i in cells if i >= glyphs['count'])
    blank_ok = glyphs['count'] - len([i for i in cells if i < glyphs['count']])
    return beyond == 0 and blank_ok <= max(3, glyphs['count'] // 50), len(cells), beyond


def find_texture_in_dir(entry_dir, glyph_name, glyphs):
    """The texture of a glyph table: the nearest subfile of the same entry with the right page count
    and width whose visible cells are exactly the glyph indices (see validate). None if absent."""
    names = sorted((f for f in os.listdir(entry_dir) if f.endswith('.bin')),
                   key=lambda f: int(f[1:].split('_')[0]))
    k = names.index(glyph_name)
    pages, tex_w, used_h = expected_shape(glyphs)
    for i in sorted(range(len(names)), key=lambda i: (abs(i - k), i > k)):
        path = os.path.join(entry_dir, names[i])
        with open(path, 'rb') as fh:
            head = fh.read(HEADER_MAX)
        if not is_texture(head):
            continue
        tp, tw, th = texture_shape(head)
        if tp != pages or tw != tex_w or th < used_h:
            continue
        if validate(read_texture(open(path, 'rb').read()), glyphs)[0]:
            return names[i]
    return None


# ---------------------------------------------------------------- new glyphs

class GlyphRenderer:
    """Draws new glyphs (Latin, accents) into a cell using the texture's own palette.

    'ramp' fonts (one colour, alpha rising with the index) get the antialiased alpha directly.
    Coloured fonts copy the style of the existing glyphs, told apart by brightness: per-row fill
    index (bright, keeps gradients), a 1px opaque outline (dark), a 1px soft edge (dark,
    semi-transparent) and the transparent index; the letter is drawn 1px smaller per side (the soft
    edge may be clipped by the cell on the tallest glyphs, which keeps the letters readable)."""

    # Tallest accented capitals plus the deepest descenders must fit in the cell.
    EXTENT = 'ÁÉÍÓÚÂÊÔÃÕÀÇgjpqy'
    OUTLINE = 1  # pixels per side reserved for the outline in coloured fonts

    def __init__(self, font_path, cell, tex=None, n_existing=0):
        self.cell = cell
        self.font_path = font_path
        self.style = None
        self.ramp = list(range(16))
        if tex is not None:
            self._learn(tex, n_existing)
        self._fit(self.OUTLINE if self.style else 0)

    def _fit(self, margin):
        from PIL import ImageFont
        cell = self.cell
        size = cell
        while True:
            self.font = ImageFont.truetype(self.font_path, size=size, index=0)
            _, top, _, bottom = self.font.getbbox(self.EXTENT)
            if bottom - top <= cell - 1 - 2 * margin or size <= 6:
                break
            size -= 1
        self.margin = margin
        self.y = (cell - (bottom - top)) // 2 - top

    def _learn(self, tex, n_existing):
        pal = palette(tex)
        visible = [i for i, c in enumerate(pal) if c[3] > 0x10]
        if len({pal[i][:3] for i in visible}) <= 1:
            # ramp: pick, for 16 alpha levels, the index with the nearest alpha
            self.ramp = [min(range(len(pal)), key=lambda i: abs(pal[i][3] - lvl * 0x80 // 15)) for lvl in range(16)]
            return
        from collections import Counter

        def lum(i):
            r, g, b, _ = pal[i]
            return (3 * r + 6 * g + b) / 10
        lums = [lum(i) for i in visible]
        mid = (min(lums) + max(lums)) / 2
        full = max(pal[i][3] for i in visible)
        cell, tex_w = self.cell, tex['tex_w']
        rows = [Counter() for _ in range(cell)]
        outline, soft, clear = Counter(), Counter(), Counter()
        for i in range(min(n_existing, 200)):
            if cell_origin(i, cell, tex_w)[0] >= len(tex['pages']):
                break
            px = get_cell(tex['pages'], i, cell, tex_w)
            for y in range(cell):
                for x in range(cell):
                    v = px[y * cell + x]
                    a = pal[v][3]
                    if a <= 0x10:
                        clear[v] += 1
                    elif lum(v) >= mid:
                        rows[y][v] += 1
                    elif a >= full:
                        outline[v] += 1
                    else:
                        soft[v] += 1
        fill = [r.most_common(1)[0][0] if r else None for r in rows]
        for y in range(cell):  # rows never filled in the samples borrow the nearest filled row
            if fill[y] is None:
                fill[y] = fill[min((abs(y - z), z) for z in range(cell) if fill[z] is not None)[1]]
        outline_i = outline.most_common(1)[0][0]
        self.style = {'fill': fill, 'outline': outline_i,
                      'soft': soft.most_common(1)[0][0] if soft else outline_i,
                      'clear': clear.most_common(1)[0][0]}

    def render(self, ch):
        from PIL import Image, ImageDraw
        cell, m = self.cell, self.margin
        img = Image.new('L', (cell, cell), 0)
        if ch.strip():
            left, _, right, _ = self.font.getbbox(ch)
            ImageDraw.Draw(img).text((1 + m - left, self.y), ch, fill=255, font=self.font)
            width = min(cell, right - left + 2 + 2 * m)
        else:
            width = max(3, cell // 3)
        alpha = list(img.getdata())
        if self.style is None:
            return [self.ramp[a * 15 // 255] for a in alpha], width
        s = self.style
        solid = [a >= 128 for a in alpha]

        def near(y, x, r):
            return any(solid[yy * cell + xx] for yy in range(max(0, y - r), min(cell, y + r + 1))
                       for xx in range(max(0, x - r), min(cell, x + r + 1)))
        out = []
        for y in range(cell):
            for x in range(cell):
                if solid[y * cell + x]:
                    out.append(s['fill'][y])
                elif near(y, x, 1):
                    out.append(s['outline'])
                elif near(y, x, 2):
                    out.append(s['soft'])
                else:
                    out.append(s['clear'])
        return out, width
