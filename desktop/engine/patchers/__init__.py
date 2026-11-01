"""Every game the desktop app can patch. Each module exposes ID, NAME, KIND, ACCEPT (file
extensions the player may pick), detect(path) and apply(src, tsv, lang, out, progress, log, fonts_dir).
The server's PATCHERS (web/server.js) names the same IDs."""
from . import bml3

ALL = {m.ID: m for m in (bml3,)}
