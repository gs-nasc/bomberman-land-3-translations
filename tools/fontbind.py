"""Decide which glyph table (font) each string table is drawn with.

What the executable tells us (SLPM_626.43):
  * getResource(id) @ 0x144900: id = (entry << 16) | subfile_type; the top nibble of subfile_type
    is the DIG file index (0=CDDATA, 1=CDDATA0, 2=CDDATA1, 3=CDDATA2, 4=CDDATA4, 5=CDDATA5).
  * resolveGroup(g) @ 0x144f10: group table @ 0x2bb280 = 1033 x {u32 ptr, u32 count}; each group
    lists the same resource for every scene that has it and returns the first one whose entry is
    loaded. Groups 1010/1013 (field dialogue) pair with font groups 1012/1015, column by column,
    and the font is always in the same DIG entry as the strings.
  * The other tables are bound ad hoc by each module/overlay. For those every fitting font is
    ranked by a character-bigram model trained on the ELF-bound dialogue plus MSG.MGC, with
    bonuses for a font in the same entry and for an exact fit (count == highest index + 1).

Output of `bind()`: {string_id: (font_id, method, margin)} where method is 'elf', 'local' (picked
font is in the same entry) or 'lm' (picked from another entry); margin is the score gap to the best
font that decodes the table differently (higher = safer; None for 'elf').
"""
import collections
import math
import os
import struct

from textscan import parse_glyphs, parse_strings

ARCS = ['CDDATA', 'CDDATA0', 'CDDATA1', 'CDDATA2', 'CDDATA4', 'CDDATA5']
GROUP_TABLE = 0x2bb280
GROUP_COUNT = 1033
DIALOGUE_GROUPS = ((1010, 1012), (1013, 1015))
LOCAL_BONUS = 1.0
EXACT_FIT_BONUS = 4.0


class ElfImage:
    def __init__(self, path):
        self.d = open(path, 'rb').read()
        phoff, = struct.unpack_from('<I', self.d, 0x1c)
        phentsize, phnum = struct.unpack_from('<HH', self.d, 0x2a)
        self.segs = []
        for i in range(phnum):
            t, off, va, _, fsz = struct.unpack_from('<5I', self.d, phoff + i * phentsize)
            if t == 1 and fsz:
                self.segs.append((va, off, fsz))

    def words(self, va, n):
        for s, o, size in self.segs:
            if s <= va < s + size:
                return struct.unpack_from(f'<{n}I', self.d, o + va - s)
        raise ValueError(hex(va))


def load_resources(dig_root):
    """Map resource ID -> (kind, path) for every small subfile ('font', 'str' or 'other')."""
    res = {}
    for arc in ARCS:
        for row in open(os.path.join(dig_root, arc, 'index.tsv')).read().splitlines()[1:]:
            e, _, _, _, _, k, t, size, _ = map(int, row.split('\t'))
            if size > 200000:
                continue
            p = os.path.join(dig_root, arc, f'e{e:04d}', f's{k:02d}_t{t}.bin')
            d = open(p, 'rb').read()
            kind = 'font' if parse_glyphs(d) else 'str' if parse_strings(d) else 'other'
            res[(e << 16) | t] = (kind, p)
    return res


def groups(elf):
    out = []
    for g in range(GROUP_COUNT):
        ptr, n = elf.words(GROUP_TABLE + g * 8, 2)
        out.append(elf.words(ptr, n) if n else ())
    return out


def _codes(path):
    return [c for t in parse_strings(open(path, 'rb').read()) for c in t]


def _chars(codes, glyphs):
    """Decoded characters, with '\\n' standing in for any control code."""
    return [glyphs['chars'].get(c, '?') if c < 0x8000 else '\n' for c in codes]


class Bigram:
    def __init__(self, texts):
        self.uni = collections.Counter()
        self.bi = collections.Counter()
        for t in texts:
            for a, b in zip('\n' + t, t):
                self.uni[a] += 1
                self.bi[a, b] += 1
        self.total = sum(self.uni.values())
        self.vocab = len(self.uni) + 1

    def logp(self, chars):
        lp, prev = 0.0, '\n'
        for c in chars:
            p_uni = (self.uni[c] + 0.1) / (self.total + 0.1 * self.vocab)
            p_bi = (self.bi[prev, c] + 1.0 * p_uni) / (self.uni[prev] + 1.0)
            lp += math.log(p_bi)
            prev = c
        return lp / max(1, len(chars))


def bind(dig_root, elf_path, msg_path=None):
    res = load_resources(dig_root)
    fonts = {r: parse_glyphs(open(p, 'rb').read()) for r, (k, p) in res.items() if k == 'font'}
    strings = [r for r, (k, _) in res.items() if k == 'str']
    g = groups(ElfImage(elf_path))

    result = {}
    for sg, fg in DIALOGUE_GROUPS:
        for s, f in zip(g[sg], g[fg]):
            result[s] = (f, 'elf', None)

    corpus = [''.join(_chars(_codes(res[s][1]), fonts[f])) for s, (f, _, _) in result.items()]
    if msg_path:
        for line in open(msg_path, 'rb').read().decode('shift_jis', 'replace').splitlines():
            corpus.append(line.split('\t', 1)[-1].replace('\\n', '\n'))
    model = Bigram(corpus)

    for s in strings:
        if s in result:
            continue
        codes = _codes(res[s][1])
        top = max((c for c in codes if c < 0x8000), default=-1)
        if top < 0:
            continue
        # Priors from the ELF-bound pairs: the font sits in the string table's own entry, and a
        # font generated for a table usually ends exactly at its highest glyph (count == top + 1).
        # Both are added to the bigram score so that garbage from a wrong local font still loses.
        def rank(f):
            return (model.logp(_chars(codes, fonts[f]))
                    + (LOCAL_BONUS if f >> 16 == s >> 16 else 0)
                    + (EXACT_FIT_BONUS if fonts[f]['count'] == top + 1 else 0))
        ranked = sorted(((rank(f), f) for f in fonts if fonts[f]['count'] > top), reverse=True)
        if not ranked:
            continue
        # Many scenes ship identical fonts: compare against the best font that reads differently.
        best_text = _chars(codes, fonts[ranked[0][1]])
        rival = next((sc for sc, f in ranked[1:] if _chars(codes, fonts[f]) != best_text), None)
        margin = ranked[0][0] - rival if rival is not None else 99.0
        method = 'local' if ranked[0][1] >> 16 == s >> 16 else 'lm'
        result[s] = (ranked[0][1], method, round(margin, 2))
    return res, fonts, result
