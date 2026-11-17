// Every internal link and asset in a built site resolves, and every #fragment names an id on its page.
// Not published (Jekyll skips "_" folders). Run after a build:
//   ../claryo-mobile-flutter-supabase/scripts/serve_site.sh --build
//   SITE=~/.cache/claryo-site/_site node --test _tests/links.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SITE = (process.env.SITE || path.join(os.homedir(), '.cache/claryo-site/_site')).replace(/^~/, os.homedir());
const ORIGIN = 'https://claryoapp.com';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// The file a URL path serves, the way GitHub Pages resolves it.
function fileFor(urlPath) {
  const p = decodeURIComponent(urlPath);
  const candidates = p.endsWith('/') ? [p + 'index.html'] : [p, p + '.html', p + '/index.html'];
  return candidates.map((c) => path.join(SITE, c)).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
}

const ids = new Map();
function idsOf(file) {
  if (!ids.has(file)) {
    const html = fs.readFileSync(file, 'utf8');
    ids.set(file, new Set([...html.matchAll(/\b(?:id|name)="([^"]+)"/g)].map((m) => m[1])));
  }
  return ids.get(file);
}

test('the build exists', () => {
  assert.ok(fs.existsSync(path.join(SITE, 'index.html')), `no build at ${SITE}`);
});

const pages = fs.existsSync(SITE) ? walk(SITE).filter((f) => f.endsWith('.html')) : [];

for (const file of pages) {
  const rel = '/' + path.relative(SITE, file).split(path.sep).join('/');
  test(`links resolve on ${rel}`, () => {
    const html = fs.readFileSync(file, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')                       // commented-out markup (the store badges)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (s) =>   // keep a script's src, skip its body
        (s.match(/^<script\b[^>]*>/) || [''])[0]);
    const pageUrl = new URL(rel.replace(/index\.html$/, ''), ORIGIN);
    const broken = [];
    for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
      const raw = m[1].replace(/&amp;/g, '&');
      if (!raw || /^(mailto:|tel:|data:|javascript:)/.test(raw)) continue;
      const url = new URL(raw, pageUrl);
      if (url.origin !== ORIGIN) continue;                     // outside links are not checked here
      const target = fileFor(url.pathname);
      if (!target) { broken.push(`${raw} → ${url.pathname} (missing)`); continue; }
      const frag = url.hash.slice(1);
      if (frag && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(frag))) {
        broken.push(`${raw} → #${frag} (no such id)`);
      }
    }
    assert.deepEqual(broken, []);
  });
}
