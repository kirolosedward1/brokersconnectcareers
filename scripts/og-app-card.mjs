#!/usr/bin/env node
/**
 * Renders the social card for /app, public/brand/og-app.jpg (1200x630).
 *
 *   node scripts/og-app-card.mjs public/brand/og-app.jpg \
 *     "بروكرز كونكت، دلوقتي في جيبك" \
 *     "وظائف البيع والتسويق العقاري في كل مصر على موبايلك: الراتب والعمولة بالأرقام، ومصدر العملاء مذكور في كل إعلان، وتقديم بلمسة واحدة." \
 *     "بروكرز كونكت" \
 *     public/app-screenshots/screen-1.png
 *
 * The headline is appPage.hero.title and the blurb appPage.meta.description,
 * so the card says what the page says; the screenshot is the hero's. Run it
 * again when either changes, or when the stand-in screenshot is replaced by
 * the real capture.
 *
 * The same ground as scripts/og-card.mjs — the brand gradient with the
 * bloom — with a phone drawn in CSS at the end of the card, the way
 * src/components/get-app/phone-frame.tsx draws it on the page. In Chromium
 * through playwright-core (a devDependency; `PLAYWRIGHT_BROWSERS_PATH` or
 * `CHROMIUM_PATH` says where the browser is), because a browser shapes Arabic
 * and runs a wrapped paragraph right to left, which Satori does not. The face
 * is the site's own, IBM Plex Sans Arabic, from the app's font package
 * (mobile/node_modules after `pnpm install` there), or from the directory
 * PLEX_FONTS names.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, title, blurb, siteName, screenshot = 'public/app-screenshots/screen-1.png'] = process.argv.slice(2);
if (!out || !title || !blurb || !siteName) {
  console.error('usage: node scripts/og-app-card.mjs <out.jpg> <title> <blurb> <site name> [screenshot.png]');
  process.exit(1);
}

const FONTS =
  process.env.PLEX_FONTS || join(ROOT, 'mobile/node_modules/@expo-google-fonts/ibm-plex-sans-arabic');
if (!existsSync(FONTS)) {
  console.error(`IBM Plex Sans Arabic not found at ${FONTS}: run pnpm install in mobile/, or set PLEX_FONTS`);
  process.exit(1);
}
const face = (weight, file) =>
  `@font-face { font-family: Plex; font-weight: ${weight}; src: url(data:font/ttf;base64,${readFileSync(join(FONTS, file)).toString('base64')}) format('truetype'); }`;

const screen = `data:image/png;base64,${readFileSync(join(ROOT, screenshot)).toString('base64')}`;
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
${face(500, '500Medium/IBMPlexSansArabic_500Medium.ttf')}
${face(700, '700Bold/IBMPlexSansArabic_700Bold.ttf')}
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { position: relative; font-family: Plex; color: #fff;
  background:
    radial-gradient(circle 620px at 1020px 40px, rgba(255,255,255,.20), rgba(255,255,255,0)),
    radial-gradient(circle 420px at 180px 560px, rgba(92,225,230,.28), rgba(92,225,230,0)),
    linear-gradient(117.70deg, #1a3fd4, #0b8fc4); }
/* The words keep one right edge, 76px in, and stop short of the phone. */
.block { position: absolute; right: 76px; margin: 0; text-align: right; width: 700px; }
.title { top: 118px; font-size: 58px; font-weight: 700; line-height: 1.3; }
.blurb { top: 318px; font-size: 27px; font-weight: 500; line-height: 1.55; color: rgba(255,255,255,.88); }
.mark { position: absolute; right: 76px; top: 512px; width: 44px; height: 44px; border-radius: 14px;
  background: rgba(255,255,255,.22); border: 2px solid rgba(255,255,255,.55); }
.name { position: absolute; right: 142px; top: 516px; margin: 0; font-size: 33px; font-weight: 700; line-height: 48px; color: rgba(255,255,255,.95); }
/* The phone: the page's frame at 300px wide, rising from the foot of the card. */
.phone { position: absolute; left: 92px; top: 96px; width: 300px; aspect-ratio: 1179 / 2556;
  box-sizing: border-box; border-radius: 40px; padding: 8px; background: #1b1b1f;
  box-shadow: 0 30px 60px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.18); }
.screen { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 33px; background: #000; }
.screen img { display: block; width: 100%; height: 100%; object-fit: cover; }
.island { position: absolute; left: 50%; top: 7px; width: 87px; height: 22px; transform: translateX(-50%); border-radius: 999px; background: #000; }
.button { position: absolute; width: 3px; background: #2c2c31; }
</style></head><body>
<p class="block title">${escape(title)}</p>
<p class="block blurb">${escape(blurb)}</p>
<div class="mark"></div>
<p class="name">${escape(siteName)}</p>
<div class="phone">
  <span class="button" style="left:-3px;top:48px;height:13px;border-radius:2px 0 0 2px"></span>
  <span class="button" style="left:-3px;top:72px;height:25px;border-radius:2px 0 0 2px"></span>
  <span class="button" style="left:-3px;top:105px;height:25px;border-radius:2px 0 0 2px"></span>
  <span class="button" style="right:-3px;top:84px;height:39px;border-radius:0 2px 2px 0"></span>
  <div class="screen"><img src="${screen}" alt=""><span class="island"></span></div>
</div>
</body></html>`;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(ROOT, out), type: 'jpeg', quality: 90 });
} finally {
  await browser.close();
}
console.log(`wrote ${out}`);
