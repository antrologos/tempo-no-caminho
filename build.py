#!/usr/bin/env python3
"""Monta o site em docs/: um index.html com o CSS, o JavaScript e a fonte embutidos,
mais o manifesto, o service worker e os ícones. Uso: python3 build.py"""
import base64, pathlib, shutil, sys

root = pathlib.Path(__file__).parent
src = root / 'src'
PARTS = ('app.1.js', 'app.1b.js', 'app.1c.js', 'app.1d.js', 'app.1e.js', 'app.2.js', 'app.3.js')

font = base64.b64encode((src / 'fonts' / 'overpass-latin-wght-normal.woff2').read_bytes()).decode()
css = (src / 'styles.css').read_text(encoding='utf-8').replace('__FONT__', font)
js = ''.join((src / f).read_text(encoding='utf-8') for f in PARTS)
assert '</script' not in js.lower(), 'o JavaScript não pode conter a marca de fechamento de script'
html = (src / 'template.html').read_text(encoding='utf-8').replace('/*__CSS__*/', css).replace('/*__JS__*/', js)

out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'docs'
out.mkdir(parents=True, exist_ok=True)
(out / 'index.html').write_text(html, encoding='utf-8')
for f in ('manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'):
    shutil.copy(src / f, out / f)
(out / '.nojekyll').write_text('', encoding='utf-8')
print(out, f'index.html {len(html.encode()) / 1024:.0f} kB')
