#!/usr/bin/env python3
"""Build dist/Intercompany_Detective.html: one self-contained file.

Usage:  python3 build.py [path/to/data.json]
Without an argument it uses data/data.json if present, else data/sample.json.
"""
import sys, pathlib

root = pathlib.Path(__file__).parent
arg = sys.argv[1] if len(sys.argv) > 1 else None
data = pathlib.Path(arg) if arg else (root / "data/data.json")
if not data.exists():
    data = root / "data/sample.json"

html = (root / "src/index.html").read_text(encoding="utf-8")
lib = (root / "vendor/jspdf.umd.min.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
html = html.replace("<!--VENDOR:jspdf-->", "<script>" + lib + "</script>")
html = html.replace("<!--DATA-->", data.read_text(encoding="utf-8").strip().replace("</", "<\\/"))

out = root / "dist"
out.mkdir(exist_ok=True)
(out / "Intercompany_Detective.html").write_text(html, encoding="utf-8")
print(f"Built dist/Intercompany_Detective.html from {data.name} ({len(html)/1e6:.1f} MB)")
