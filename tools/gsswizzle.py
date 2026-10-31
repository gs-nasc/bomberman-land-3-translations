"""PS2 GS memory layout helpers for the font textures.

The font texture pages are PSMT4 256x256, but the file holds each page as a linear 128x64
PSMCT32 image (the game uploads 4bpp data as 32bpp). So a pixel goes:
  PSMT4 (x, y) -> GS nibble address -> GS word -> PSMCT32 (x32, y32) -> file word y32*128 + x32
Inside a word the nibbles are little-endian (low nibble = lower GS nibble address).
"""

BLOCK32 = [
    [0, 1, 4, 5, 16, 17, 20, 21],
    [2, 3, 6, 7, 18, 19, 22, 23],
    [8, 9, 12, 13, 24, 25, 28, 29],
    [10, 11, 14, 15, 26, 27, 30, 31],
]
COLUMN32 = [
    [0, 1, 4, 5, 8, 9, 12, 13],
    [2, 3, 6, 7, 10, 11, 14, 15],
]
BLOCK4 = [
    [0, 2, 8, 10],
    [1, 3, 9, 11],
    [4, 6, 12, 14],
    [5, 7, 13, 15],
    [16, 18, 24, 26],
    [17, 19, 25, 27],
    [20, 22, 28, 30],
    [21, 23, 29, 31],
]
_COL4_ROW0 = [0, 8, 32, 40, 64, 72, 96, 104, 2, 10, 34, 42, 66, 74, 98, 106,
              4, 12, 36, 44, 68, 76, 100, 108, 6, 14, 38, 46, 70, 78, 102, 110]
_COL4_ROW1 = [v + 16 for v in _COL4_ROW0]


def _swap_halves(row):
    """Swap the two 4-entry halves of every 8-entry group."""
    return [row[(i ^ 4)] for i in range(len(row))]


def _column4():
    even = [_COL4_ROW0, _COL4_ROW1, [v + 1 for v in _swap_halves(_COL4_ROW0)], [v + 1 for v in _swap_halves(_COL4_ROW1)]]
    odd = [_swap_halves(_COL4_ROW0), _swap_halves(_COL4_ROW1), [v + 1 for v in _COL4_ROW0], [v + 1 for v in _COL4_ROW1]]
    table = []
    for c in range(4):
        rows = even if c % 2 == 0 else odd
        table += [[v + 128 * c for v in r] for r in rows]
    return table


COLUMN4 = _column4()  # 16 rows (4 columns x 4 rows) of 32 nibble offsets within a 256-byte block


def psmt4_nibble_addr(x, y, tbw):
    """Nibble address of PSMT4 pixel (x, y) for a buffer `tbw` 64-pixel units wide (base 0)."""
    pages_wide = tbw // 2
    page = (y // 128) * pages_wide + x // 128
    block = BLOCK4[(y % 128) // 16][(x % 128) // 32]
    return page * 16384 + block * 512 + COLUMN4[y % 16][x % 32]


_COL8_ROW0 = [0, 4, 16, 20, 32, 36, 48, 52, 2, 6, 18, 22, 34, 38, 50, 54]
_COL8_ROW1 = [v + 8 for v in _COL8_ROW0]


def _swap8(row):
    return [row[i ^ 4] for i in range(len(row))]


def _column8():
    even = [_COL8_ROW0, _COL8_ROW1, [v + 1 for v in _swap8(_COL8_ROW0)], [v + 1 for v in _swap8(_COL8_ROW1)]]
    odd = [_swap8(_COL8_ROW0), _swap8(_COL8_ROW1), [v + 1 for v in _COL8_ROW0], [v + 1 for v in _COL8_ROW1]]
    table = []
    for c in range(4):
        rows = even if c % 2 == 0 else odd
        table += [[v + 64 * c for v in r] for r in rows]
    return table


COLUMN8 = _column8()  # 16 rows of 16 byte offsets within a 256-byte block


def psmt8_byte_addr(x, y, tbw):
    """Byte address of PSMT8 pixel (x, y); page 128x64, blocks 16x16 laid out like PSMCT32."""
    page = (y // 64) * (tbw // 2) + x // 128
    block = BLOCK32[(y % 64) // 16][(x % 128) // 16]
    return page * 8192 + block * 256 + COLUMN8[y % 16][x % 16]


def psmct32_word_addr(x, y, bw):
    """Word address of PSMCT32 pixel (x, y) for a buffer `bw` 64-pixel units wide (base 0)."""
    page = (y // 32) * bw + x // 64
    block = BLOCK32[(y % 32) // 8][(x % 64) // 8]
    return page * 2048 + block * 64 + ((y % 8) // 2) * 16 + COLUMN32[y % 2][x % 8]


def _file_nibble_map(width, height):
    """For every PSMT4 pixel (row-major), the nibble index in the file."""
    w32 = width // 2                      # 256x256 4bpp page == 128x64 32bpp upload
    h32 = width * height // 8 // w32
    word_to_file = {}
    for y in range(h32):
        for x in range(w32):
            word_to_file[psmct32_word_addr(x, y, w32 // 64)] = y * w32 + x
    tbw = width // 64
    out = []
    for y in range(height):
        for x in range(width):
            a = psmt4_nibble_addr(x, y, tbw)
            out.append(word_to_file[a >> 3] * 8 + (a & 7))
    return out


_MAPS = {}


def _map(width, height):
    if (width, height) not in _MAPS:
        _MAPS[width, height] = _file_nibble_map(width, height)
    return _MAPS[width, height]


def unswizzle4(data, width=256, height=256):
    """File bytes of one page -> list of 4-bit pixel values in row-major order."""
    return [(data[n >> 1] >> (4 * (n & 1))) & 15 for n in _map(width, height)]


def swizzle4(pixels, width=256, height=256):
    """Inverse of unswizzle4."""
    buf = bytearray(width * height // 2)
    for v, n in zip(pixels, _map(width, height)):
        buf[n >> 1] |= (v & 15) << (4 * (n & 1))
    return bytes(buf)
