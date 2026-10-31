"""Tiny PS2 ELF helper: load segments, vaddr<->offset, disassemble, find xrefs (lui/addiu pairs)."""
import struct, sys, capstone

class Elf:
    def __init__(self, path):
        self.d = open(path, 'rb').read()
        e_phoff, = struct.unpack_from('<I', self.d, 0x1c)
        e_phentsize, e_phnum = struct.unpack_from('<HH', self.d, 0x2a)
        self.entry, = struct.unpack_from('<I', self.d, 0x18)
        self.segs = []
        for i in range(e_phnum):
            t, off, va, pa, fsz, msz, fl, al = struct.unpack_from('<8I', self.d, e_phoff + i * e_phentsize)
            if t == 1:
                self.segs.append((va, off, fsz))
        self.md = capstone.Cs(capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS64 + capstone.CS_MODE_LITTLE_ENDIAN)
        self.md.skipdata = True

    def off(self, va):
        for s, o, n in self.segs:
            if s <= va < s + n:
                return o + va - s

    def va(self, off):
        for s, o, n in self.segs:
            if o <= off < o + n:
                return s + off - o

    def dis(self, va, n=64):
        o = self.off(va)
        out = []
        for ins in self.md.disasm(self.d[o:o + n * 4], va):
            out.append(f'{ins.address:08x}: {ins.mnemonic:8} {ins.op_str}')
        return '\n'.join(out)

    def xrefs(self, target):
        """Find lui/addiu|ori|lw pairs building `target` within a short window."""
        hi = (target + 0x8000) >> 16
        res = []
        for s, o, n in self.segs:
            for i in range(0, n - 4, 4):
                w, = struct.unpack_from('<I', self.d, o + i)
                if w >> 26 == 0x0f and (w & 0xffff) in (hi, target >> 16):
                    rt = (w >> 16) & 31
                    for j in range(1, 12):
                        if i + j * 4 >= n: break
                        w2, = struct.unpack_from('<I', self.d, o + i + j * 4)
                        if ((w2 >> 21) & 31) == rt and ((w2 >> 26) in (0x09, 0x0d, 0x23, 0x21, 0x25, 0x24, 0x20)):
                            lo = w2 & 0xffff
                            v = ((w & 0xffff) << 16) + (lo - 0x10000 if (lo & 0x8000 and w2 >> 26 != 0x0d) else lo)
                            if v & 0xffffffff == target:
                                res.append(s + i)
                                break
        return res

    def fstart(self, va):
        """Walk back to the nearest `addiu sp,sp,-N` prologue."""
        while True:
            w, = struct.unpack_from('<I', self.d, self.off(va))
            if w >> 16 == 0x27bd and (w & 0x8000):
                return va
            va -= 4

    def calls_to(self, target):
        jal = 0x0c000000 | ((target >> 2) & 0x3ffffff)
        p = struct.pack('<I', jal)
        res, i = [], -1
        while (i := self.d.find(p, i + 1)) != -1:
            if i % 4 == 0:
                res.append(self.va(i))
        return res


if __name__ == '__main__':
    e = Elf(sys.argv[1])
    a = int(sys.argv[2], 16)
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 64
    print(e.dis(a, n))
