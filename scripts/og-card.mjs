#!/usr/bin/env node
/**
 * Renders the social card, public/brand/og.jpg (1200x630).
 *
 *   node scripts/og-card.mjs public/brand/og.jpg \
 *     "سوق الوظائف المتخصص في العقارات المصرية" \
 *     "مصدر العملاء مذكور في كل إعلان، والراتب والعمولة بالأرقام لما الشركة تعلنهم." \
 *     "بروكرز كونكت"
 *
 * The tagline is meta.tagline; the blurb is the second half of
 * meta.defaultDescription, so a change to what the site claims about its
 * listings is a change to this image too — it is the line a shared link shows.
 *
 * In Chromium, through Playwright (a local or global install: `npm i -g
 * playwright && npx playwright install chromium`), because a browser shapes
 * Arabic and runs a wrapped paragraph right to left. Satori, behind next/og,
 * shapes the letters but reverses the words on a wrapped line and puts
 * trailing punctuation on the wrong side. The face is the site's own, IBM Plex
 * Sans Arabic, from the app's font package (mobile/node_modules, after
 * `pnpm install` there).
 *
 * The layout is the one scripts/og-card.swift drew with CoreText, which this
 * replaces: the brand gradient with a bloom in the top corner, the tagline
 * over the blurb on one right edge, and the mark beside the name at the foot.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, tagline, blurb, siteName] = process.argv.slice(2);
if (!out || !tagline || !blurb || !siteName) {
  console.error('usage: node scripts/og-card.mjs <out.jpg> <tagline> <blurb> <site name>');
  process.exit(1);
}

function playwright() {
  for (const base of [`${ROOT}/`, `${execSync('npm root -g').toString().trim()}/`]) {
    try {
      return createRequire(base)('playwright');
    } catch {
      /* try the next place */
    }
  }
  console.error('Playwright is not installed: npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}

const FONTS = join(ROOT, 'mobile/node_modules/@expo-google-fonts/ibm-plex-sans-arabic');
const face = (weight, file) =>
  `@font-face { font-family: Plex; font-weight: ${weight}; src: url(data:font/ttf;base64,${readFileSync(join(FONTS, file)).toString('base64')}) format('truetype'); }`;

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
${face(500, '500Medium/IBMPlexSansArabic_500Medium.ttf')}
${face(700, '700Bold/IBMPlexSansArabic_700Bold.ttf')}
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
/* The site's two brand stops along the diagonal, and a soft white bloom where
   the hero has one. 117.7deg points the gradient corner to corner. */
body { position: relative; font-family: Plex; color: #fff;
  background:
    radial-gradient(circle 620px at 1020px 40px, rgba(255,255,255,.20), rgba(255,255,255,0)),
    linear-gradient(117.70deg, #1a3fd4, #0b8fc4); }
/* One right edge for every block, 76px in. */
.block { position: absolute; right: 76px; margin: 0; text-align: right; }
.tagline { bottom: 300px; width: 1048px; font-size: 56px; font-weight: 700; line-height: 1.3; }
.blurb { top: 352px; width: 988px; font-size: 31px; font-weight: 500; line-height: 1.5; color: rgba(255,255,255,.88); }
.mark { position: absolute; right: 76px; top: 512px; width: 44px; height: 44px; border-radius: 14px;
  background: rgba(255,255,255,.22); border: 2px solid rgba(255,255,255,.55); }
.name { position: absolute; right: 142px; top: 516px; margin: 0; font-size: 33px; font-weight: 700; line-height: 48px; color: rgba(255,255,255,.95); }
</style></head><body>
<p class="block tagline">${escape(tagline)}</p>
<p class="block blurb">${escape(blurb)}</p>
<div class="mark"></div>
<p class="name">${escape(siteName)}</p>
</body></html>`;

const { chromium } = playwright();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: 'jpeg', quality: 90 });
} finally {
  await browser.close();
}
console.log(`wrote ${out}`);
