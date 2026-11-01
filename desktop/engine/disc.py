"""Disc images: raw BIN/CUE -> plain ISO (2048-byte sectors) and an ISO 9660 reader.

Only what the patchers need: files in the root directory (or one level of subdirectories) by name.
"""
import os
import re
import struct

SECTOR = 2048
RAW = 2352
SYNC = b'\x00' + b'\xff' * 10 + b'\x00'


class DiscError(Exception):
    pass


def bin_of_cue(cue):
    """First data track file named by a .cue sheet."""
    text = open(cue, encoding='utf-8', errors='replace').read()
    m = re.search(r'^\s*FILE\s+"([^"]+)"', text, re.M) or re.search(r'^\s*FILE\s+(\S+)', text, re.M)
    if not m:
        raise DiscError('o arquivo .cue não aponta para nenhum .bin')
    path = os.path.join(os.path.dirname(cue), m.group(1))
    if not os.path.isfile(path):
        raise DiscError(f'o .cue aponta para "{m.group(1)}", que não está na mesma pasta')
    return path


def is_raw(path):
    """True for a 2352-byte-sector image (BIN), False for a plain ISO."""
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        head = f.read(16)
    return size % RAW == 0 and head[:12] == SYNC


def data_offset(path):
    """Byte offset of the user data in a raw sector: 16 for mode 1, 24 for mode 2 form 1."""
    with open(path, 'rb') as f:
        return 16 if f.read(16)[15] == 1 else 24


def raw_to_iso(src, dst, progress=None):
    """Copy the 2048-byte user data of every sector of a raw image."""
    off = data_offset(src)
    total = os.path.getsize(src) // RAW
    batch = 512
    with open(src, 'rb') as f, open(dst, 'wb') as o:
        done = 0
        while True:
            chunk = f.read(RAW * batch)
            if not chunk:
                break
            n = len(chunk) // RAW
            o.write(b''.join(chunk[i * RAW + off:i * RAW + off + SECTOR] for i in range(n)))
            done += n
            if progress:
                progress(done, total)


def resolve(path):
    """User's pick (.iso, .bin or .cue) -> (image path, is_raw)."""
    if path.lower().endswith('.cue'):
        path = bin_of_cue(path)
    if not os.path.isfile(path):
        raise DiscError('arquivo não encontrado')
    return path, is_raw(path)


class Image:
    """Read-only ISO 9660 view of a plain or raw image (no conversion needed to read files)."""

    def __init__(self, path):
        self.path, raw = resolve(path)
        self.f = open(self.path, 'rb')
        self.sector, self.offset = (RAW, data_offset(self.path)) if raw else (SECTOR, 0)
        pvd = self.read_sectors(16, 1)
        if pvd[1:6] != b'CD001':
            raise DiscError('não é uma imagem de disco válida (ISO 9660)')
        self.root = struct.unpack_from('<I', pvd, 156 + 2)[0], struct.unpack_from('<I', pvd, 156 + 10)[0]

    def close(self):
        self.f.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def read_sectors(self, lba, count):
        if self.sector == SECTOR:
            self.f.seek(lba * SECTOR)
            return self.f.read(count * SECTOR)
        out = bytearray()
        self.f.seek(lba * RAW)
        for _ in range(count):
            s = self.f.read(RAW)
            out += s[self.offset:self.offset + SECTOR]
        return bytes(out)

    def listdir(self, extent=None):
        """{NAME: (lba, size, is_dir)} of a directory (root by default); ';1' is stripped."""
        lba, size = extent or self.root
        d = self.read_sectors(lba, -(-size // SECTOR))
        out, pos = {}, 0
        while pos < size:
            ln = d[pos]
            if ln == 0:
                pos = (pos // SECTOR + 1) * SECTOR
                continue
            nlen = d[pos + 32]
            name = d[pos + 33:pos + 33 + nlen]
            if name not in (b'\x00', b'\x01'):
                out[name.decode('ascii', 'replace').split(';')[0].upper()] = (
                    struct.unpack_from('<I', d, pos + 2)[0], struct.unpack_from('<I', d, pos + 10)[0], bool(d[pos + 25] & 2))
            pos += ln
        return out

    def stat(self, name):
        """(lba, size) of a file by path such as 'SYSTEM.CNF' or 'MENU/X.BIN'."""
        extent = None
        parts = name.upper().split('/')
        for i, part in enumerate(parts):
            entry = self.listdir(extent).get(part)
            if not entry:
                raise DiscError(f'{name} não está no disco')
            extent = entry[:2]
        return extent

    def read(self, name):
        lba, size = self.stat(name)
        return self.read_sectors(lba, -(-size // SECTOR))[:size]

    def extract(self, name, dst, progress=None):
        lba, size = self.stat(name)
        step = 4096
        with open(dst, 'wb') as o:
            n = -(-size // SECTOR)
            for i in range(0, n, step):
                o.write(self.read_sectors(lba + i, min(step, n - i)))
                if progress:
                    progress(min(i + step, n), n)
            o.truncate(size)
