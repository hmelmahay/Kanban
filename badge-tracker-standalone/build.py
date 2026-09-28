#!/usr/bin/env python3
"""Build "Badge Tracker.html", the shareable single-file Badge Tracker, from the site's page.

Takes badges.html, drops the parts marked site-only (nav, sign-in, Supabase), inlines style.css,
badges.css and badges.js, and adds local-storage.js so entries are saved in the browser.
Re-run after changing the tracker:  python3 badge-tracker-standalone/build.py
"""
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = HERE / 'Badge Tracker.html'


def read(path):
    return path.read_text(encoding='utf-8')


def replace_once(html, old, new):
    assert html.count(old) == 1, f'expected exactly one {old!r} in badges.html'
    return html.replace(old, new)


html = read(ROOT / 'badges.html')
html, blocks = re.subn(r'[ \t]*<!-- site-only\b.*?<!-- /site-only -->[ \t]*\n', '', html, flags=re.S)
assert blocks == 4, f'expected 4 site-only blocks in badges.html, found {blocks}'
html = re.sub(r'<title>[^<]*</title>', '<title>Badge Tracker</title>', html, count=1)
for css in ('style.css', 'badges.css'):
    html = replace_once(html, f'<link rel="stylesheet" href="{css}" />', f'<style>\n{read(ROOT / css)}</style>')
html = replace_once(html, '<script src="badges.js"></script>',
                    f'<script>\n{read(ROOT / "badges.js")}</script>\n'
                    f'  <script>\n{read(HERE / "local-storage.js")}</script>')

# Nothing personal or site-specific may ship in the shared file.
for leak in ('supabase.co', 'sb_publishable', 'vercel.app', 'claude.ai', 'drive.google', 'Center of Excellence', '<script src='):
    assert leak not in html, f'{leak!r} would end up in the shared file'

OUT.write_text(html, encoding='utf-8')
print(f'Wrote {OUT.relative_to(ROOT)} ({len(html):,} bytes)')
