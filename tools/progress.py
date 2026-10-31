"""Translation progress per language and per scene, from the translated TSV.

Every column after the ones textscan.py writes is a language (`pt`, `es`...). A string counts as
done when its cell is filled. Tables repeated across scenes (same string table content) are
counted once in the totals so shared item lists don't inflate the numbers.
The output holds only counts, never game text, so it can be shared freely.

Usage: progress.py TRANSLATED.tsv [--json OUT.json] [--langs pt,es,en]
--langs adds target languages that have no column yet (they count as 0%).
"""
import argparse
import json
import sys
import time
from collections import defaultdict

BASE_COLUMNS = ['archive', 'entry', 'file', 'id', 'string_res', 'font_res', 'method', 'margin', 'text']


def measure(tsv_path, extra_langs=()):
    lines = open(tsv_path, encoding='utf-8').read().splitlines()
    head = lines[0].split('\t')
    head += [l for l in extra_langs if l not in head]   # planned languages without a column yet
    langs = [c for c in head if c not in BASE_COLUMNS]
    col = {k: i for i, k in enumerate(head)}
    rows = [l.split('\t') + [''] * (len(head) - len(l.split('\t'))) for l in lines[1:]]

    # identical tables (same sequence of original texts) are one piece of work
    tables = defaultdict(list)
    for r in rows:
        tables[r[col['string_res']]].append(r)
    seen, unique_rows = set(), []
    for sid, table in tables.items():
        key = tuple(r[col['text']] for r in sorted(table, key=lambda r: int(r[col['id']])))
        if key not in seen:
            seen.add(key)
            unique_rows += table

    def tally(subset):
        total = len(subset)
        chars = sum(len(r[col['text']]) for r in subset)
        out = {'strings': total, 'chars': chars, 'langs': {}}
        for lang in langs:
            done = [r for r in subset if r[col[lang]]]
            out['langs'][lang] = {
                'done': len(done),
                'chars_done': sum(len(r[col['text']]) for r in done),
                'pct': round(100 * len(done) / total, 1) if total else 0.0,
            }
        return out

    scenes = defaultdict(list)
    for r in unique_rows:
        scenes[f"{r[col['archive']]}/{r[col['entry']]}"].append(r)
    return {
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'languages': langs,
        'total': tally(unique_rows),
        'scenes': [{'scene': k, **tally(v)} for k, v in sorted(scenes.items())],
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('tsv')
    ap.add_argument('--json')
    ap.add_argument('--langs', default='', help='comma-separated target languages to include even without a column')
    a = ap.parse_args(argv)
    data = measure(a.tsv, [l.strip() for l in a.langs.split(',') if l.strip()])
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
    t = data['total']
    print(f"{t['strings']} strings únicas, {len(data['scenes'])} cenas")
    for lang in data['languages']:
        s = t['langs'][lang]
        print(f"  {lang}: {s['done']}/{t['strings']} ({s['pct']}%)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
