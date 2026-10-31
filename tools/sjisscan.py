import os
import sys,re
# count runs of valid Shift-JIS double-byte chars (>=4 chars)
pat=re.compile(rb'(?:[\x81-\x9f\xe0-\xef][\x40-\x7e\x80-\xfc]|[\x20-\x7e]){6,}')
for fn in sys.argv[1:]:
    d=open(fn,'rb').read()
    hits=[]
    for m in pat.finditer(d):
        s=m.group()
        try: t=s.decode('shift_jis')
        except: continue
        if sum(1 for c in t if ord(c)>0x3000)>=3: hits.append((m.start(),t))
    print(f'== {fn}: {len(hits)} sjis strings')
    for o,t in hits[:int(os.environ.get("N","5")) if False else 6]: print(hex(o),t[:60])
