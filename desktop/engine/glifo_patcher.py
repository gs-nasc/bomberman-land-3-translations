"""Glifo desktop engine: the app runs this (as a bundled .exe) to check a disc and build the
translated one. Every answer is JSON on stdout, one object per line.

  glifo_patcher.py patchers
      [{"id", "name", "kind", "accept"}]
  glifo_patcher.py detect --patcher ID FILE
      {"ok": true, "name"} | {"ok": false, "message"}
  glifo_patcher.py cleanup
      {"ok": true}   (removes the temporary files of runs that were killed)
  glifo_patcher.py apply --patcher ID --input FILE --lang LANG --output OUT (--tsv PATH | --url URL)
      {"event": "progress", "pct", "label"}  {"event": "log", "text"}
      {"event": "done", "output", "skipped"} | {"event": "error", "message"}
"""
import argparse
import json
import shutil
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [HERE, os.path.join(HERE, '..', '..', 'tools')]   # tools/ when run from the repo

import patchers                      # noqa: E402
from disc import DiscError           # noqa: E402

VERSION = '0.1.0'
OUT = sys.stdout


def emit(obj):
    OUT.write(json.dumps(obj, ensure_ascii=False) + '\n')
    OUT.flush()


def download(url, dst):
    req = urllib.request.Request(url, headers={'User-Agent': f'Glifo-App/{VERSION}'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(dst, 'wb') as f:
            f.write(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get('error')
        except Exception:
            msg = None
        raise DiscError(msg or f'o servidor respondeu {e.code}')
    except urllib.error.URLError as e:
        raise DiscError(f'sem conexão com o servidor ({e.reason})')


def alive(pid):
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    import ctypes
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x1000, False, pid)        # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    k32.GetExitCodeProcess(h, ctypes.byref(code))
    k32.CloseHandle(h)
    return code.value == 259                        # STILL_ACTIVE


def clean_stale_temp():
    """Temporary folders of runs whose process is gone: cancel kills the engine before it can clean
    up (the app then runs `cleanup`), and so does turning the machine off."""
    root = tempfile.gettempdir()
    for name in os.listdir(root):
        p = os.path.join(root, name)
        if not name.startswith('glifo-') or not os.path.isdir(p):
            continue
        try:
            pid = int(open(os.path.join(p, 'pid')).read())
        except (OSError, ValueError):
            pid = None
        if (pid and not alive(pid)) or (not pid and time.time() - os.path.getmtime(p) > 3600):
            shutil.rmtree(p, ignore_errors=True)


def cmd_apply(a, p):
    clean_stale_temp()
    run_dir = tempfile.mkdtemp(prefix='glifo-')
    open(os.path.join(run_dir, 'pid'), 'w').write(str(os.getpid()))
    tempfile.tempdir = run_dir          # every temporary file of this run (download, scenes) goes here
    try:
        apply_in(a, p)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)


def apply_in(a, p):
    tsv = a.tsv
    if not tsv:
        emit({'event': 'progress', 'pct': 0, 'label': 'Baixando a tradução'})
        tsv = os.path.join(tempfile.gettempdir(), 'traducao.tsv')
        download(a.url, tsv)
    last = [-1.0]

    def progress(pct, label):
        pct = round(pct, 1)
        if pct != last[0]:
            last[0] = pct
            emit({'event': 'progress', 'pct': pct, 'label': label})

    skipped = p.apply(a.input, tsv, a.lang, a.output, progress, lambda t: emit({'event': 'log', 'text': t}),
                      fonts_dir=os.path.join(HERE, 'fonts'))
    emit({'event': 'done', 'output': a.output, 'skipped': len(skipped)})


def main(argv=None):
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument('--version', action='version', version=VERSION)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('patchers')
    d = sub.add_parser('detect')
    d.add_argument('--patcher', required=True)
    d.add_argument('file')
    x = sub.add_parser('apply')
    x.add_argument('--patcher', required=True)
    x.add_argument('--input', required=True)
    x.add_argument('--lang', required=True)
    x.add_argument('--output', required=True)
    sub.add_parser('cleanup')       # after a cancel: see clean_stale_temp
    src = x.add_mutually_exclusive_group(required=True)
    src.add_argument('--tsv')
    src.add_argument('--url')
    a = ap.parse_args(argv)
    OUT.reconfigure(encoding="utf-8")   # a pipe on Windows defaults to the ANSI code page
    # stray prints of the game tools must not break the JSON stream
    sys.stdout = sys.stderr

    if a.cmd == 'cleanup':
        clean_stale_temp()
        emit({'ok': True})
        return 0
    if a.cmd == 'patchers':
        emit([{'id': m.ID, 'name': m.NAME, 'kind': m.KIND, 'accept': m.ACCEPT} for m in patchers.ALL.values()])
        return 0
    p = patchers.ALL.get(a.patcher)
    if not p:
        msg = 'este jogo precisa de uma versão mais nova do aplicativo'
        emit({'ok': False, 'message': msg} if a.cmd == 'detect' else {'event': 'error', 'message': msg})
        return 2
    if a.cmd == 'detect':
        try:
            emit({'ok': True, 'name': p.detect(a.file)})
        except (DiscError, OSError) as e:
            emit({'ok': False, 'message': str(e)})
        return 0
    try:
        cmd_apply(a, p)
        return 0
    except Exception as e:  # anything else is reported to the app instead of a traceback
        import traceback
        traceback.print_exc()
        emit({'event': 'error', 'message': str(e) or type(e).__name__})
        return 1


if __name__ == '__main__':
    sys.exit(main())
