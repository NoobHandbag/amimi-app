// One-off UI/UX audit capture harness for the Amimì App (live PWA).
// Renders every screen at a true mobile viewport (390px) + a desktop pass,
// saves full-page screenshots + a machine-readable metrics dossier.
// Run from amimi-app/web:  node scripts/audit-capture.mjs
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://noobhandbag.github.io/amimi-app/';
const OUT = path.resolve('../audits/evidence');
const SHOTS = (vp) => path.join(OUT, vp);
const TEXT = path.join(OUT, 'text');
for (const d of [OUT, SHOTS('mobile'), SHOTS('desktop'), TEXT]) fs.mkdirSync(d, { recursive: true });

const settle = (page, ms = 1300) => page.waitForTimeout(ms);

// Per-screen DOM metrics, evaluated in the page.
const METRICS = () => ({
  // run in browser
  fn: () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const doc = document.documentElement;
    const overflowDoc = doc.scrollWidth - window.innerWidth;
    // elements that overflow horizontally beyond their box (excluding intentionally scrollable wrappers)
    const allow = ['tablewrap', 'subtabs', 'treemap', 'seg', 'filters', 'chips', 'kpirow', 'missrow', 'pillrow', 'esempi', 'catleg', 'barleg', 'supgrid'];
    const overflowEls = [];
    document.querySelectorAll('*').forEach((el) => {
      if (!vis(el)) return;
      const cls = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : String(el.className || '');
      if (allow.some((a) => cls.split(/\s+/).includes(a))) return;
      const over = el.scrollWidth - el.clientWidth;
      if (over > 2 && el.clientWidth > 0) overflowEls.push({ tag: el.tagName.toLowerCase(), cls: cls.slice(0, 60), over, cw: el.clientWidth, sw: el.scrollWidth });
    });
    // small tap targets
    const tap = [];
    document.querySelectorAll('button, a, input, select, [role=button], textarea').forEach((el) => {
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) tap.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), txt: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 24) });
    });
    // tiny text
    let tiny = 0;
    document.querySelectorAll('*').forEach((el) => {
      if (!el.childElementCount && el.textContent && el.textContent.trim() && vis(el)) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 11) tiny++;
      }
    });
    // broken / placeholder images
    const broken = [];
    document.querySelectorAll('img').forEach((im) => { if (im.complete && im.naturalWidth === 0) broken.push(im.currentSrc || im.src); });
    return {
      innerW: window.innerWidth, scrollW: doc.scrollWidth, overflowDoc,
      overflowEls: overflowEls.slice(0, 25), nOverflow: overflowEls.length,
      smallTaps: { count: tap.length, samples: tap.slice(0, 18) },
      tinyText: tiny, brokenImgs: broken.slice(0, 20), nBroken: broken.length,
      bodyTextLen: (document.body.innerText || '').length,
    };
  },
});

async function captureScreen(page, vp, name, nav, extra = {}) {
  const rec = { screen: name, vp, ok: true };
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app', { timeout: 20000 }).catch(() => {});
    await settle(page, 900);
    if (nav) await nav(page);
    await settle(page, extra.settle ?? 1500);
    const m = await page.evaluate(METRICS().fn);
    Object.assign(rec, m);
    const file = path.join(SHOTS(vp), `${name}.png`);
    await page.screenshot({ path: file, fullPage: extra.fullPage ?? true });
    rec.shot = file;
    if (vp === 'mobile') {
      const txt = await page.evaluate(() => document.body.innerText);
      fs.writeFileSync(path.join(TEXT, `${name}.txt`), txt);
    }
  } catch (e) {
    rec.ok = false; rec.error = String(e).slice(0, 300);
  }
  console.log(`[${vp}] ${name} ${rec.ok ? 'ok' : 'FAIL ' + rec.error}` + (rec.overflowDoc > 0 ? ` overflowDoc=${rec.overflowDoc}` : '') + (rec.smallTaps ? ` taps<40=${rec.smallTaps.count}` : ''));
  return rec;
}

// navigation helpers
const navTab = (label) => async (page) => { await page.locator('.bottomnav button', { hasText: label }).click(); };
const navTile = (label) => async (page) => { await page.locator('.hometile', { hasText: label }).first().click(); };
const navRegistra = (tileText) => async (page) => {
  await page.locator('.bottomnav button', { hasText: 'Registra' }).click();
  await page.waitForSelector('.tipi', { timeout: 8000 });
  await page.locator('.tipo', { hasText: tileText }).click();
};
const navInv = (segText) => async (page) => {
  await page.locator('.bottomnav button', { hasText: 'Magazzino' }).click();
  await page.waitForSelector('header .seg.wrap', { timeout: 8000 });
  await page.locator('header .seg.wrap button', { hasText: segText }).click();
};

const MOBILE_SCREENS = [
  ['home', null],
  ['cruscotto', navTile('Cruscotto finanze')],
  ['registra-hub', navTab('Registra')],
  ['registra-conta', navRegistra('Conta fisica')],
  ['registra-reso', navRegistra('Reso / Cambio')],
  ['registra-vendita', navRegistra('Regalo / Vendita')],
  ['registra-b2b', navRegistra('Movimento B2B')],
  ['registra-nuovo', navRegistra('Nuovo prodotto')],
  ['registra-spese', navRegistra('Spese')],
  ['registra-pulizia', navRegistra('Pulizia dati')],
  ['registra-pubblica', navRegistra('Pubblica su Shopify')],
  ['ordini-list', navTab('Ordini')],
  ['ordini-nuovo', async (page) => { await page.locator('.bottomnav button', { hasText: 'Ordini' }).click(); await page.locator('.bigadd').first().click(); }],
  ['ordini-fornitore', async (page) => { await page.locator('.bottomnav button', { hasText: 'Ordini' }).click(); await page.waitForSelector('.navcard', { timeout: 8000 }); await page.locator('.navcard').first().click(); }],
  ['inv-disponibilita', navTab('Magazzino')],
  ['inv-magazzino', navInv('Magazzino')],
  ['inv-riordino', navInv('Riordino')],
  ['inv-negozi', navInv('Nei negozi')],
  ['inv-shopify', navInv('Shopify')],
  ['inv-valore', navInv('Valore')],
  ['inv-drawer', async (page) => { await page.locator('.bottomnav button', { hasText: 'Magazzino' }).click(); await page.locator('header .seg.wrap button', { hasText: 'Magazzino' }).click(); await page.waitForSelector('.invtable tbody tr.clickrow', { timeout: 8000 }); await page.locator('.invtable tbody tr.clickrow').first().click(); }],
];

const DESKTOP_SCREENS = [
  ['home', null, { fullPage: false }],
  ['cruscotto', navTile('Cruscotto finanze'), { fullPage: false }],
  ['registra-hub', navTab('Registra'), { fullPage: false }],
  ['inv-magazzino', navInv('Magazzino'), { fullPage: false }],
  ['ordini-list', navTab('Ordini'), { fullPage: false }],
];

async function run() {
  const browser = await chromium.launch();
  const out = { base: BASE, capturedAt: new Date().toISOString(), screens: [], console: [], pageErrors: [], failedReq: [], perf: {}, resources: {} };

  // ---------- MOBILE ----------
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') out.console.push({ vp: 'mobile', type: m.type(), text: m.text().slice(0, 300) }); });
    page.on('pageerror', (e) => out.pageErrors.push({ vp: 'mobile', text: String(e).slice(0, 300) }));
    page.on('response', (r) => { if (r.status() >= 400) out.failedReq.push({ vp: 'mobile', status: r.status(), url: r.url().slice(0, 160) }); });

    // perf + resources on first cold load
    await page.goto(BASE, { waitUntil: 'load' });
    await settle(page, 1500);
    out.perf = await page.evaluate(() => { const t = performance.getEntriesByType('navigation')[0] || {}; return { domContentLoaded: Math.round(t.domContentLoadedEventEnd || 0), load: Math.round(t.loadEventEnd || 0), responseEnd: Math.round(t.responseEnd || 0) }; });
    out.resources = await page.evaluate(() => {
      const r = performance.getEntriesByType('resource');
      const sum = (f) => r.filter(f).reduce((s, x) => s + (x.transferSize || x.encodedBodySize || 0), 0);
      const js = sum((x) => x.name.endsWith('.js') || x.name.includes('.js?'));
      const css = sum((x) => x.name.endsWith('.css'));
      const img = sum((x) => /\.(png|jpe?g|webp|svg|gif)/.test(x.name));
      const supa = r.filter((x) => x.name.includes('supabase')).length;
      return { jsBytes: js, cssBytes: css, imgBytes: img, nRequests: r.length, nSupabaseCalls: supa, biggest: r.map((x) => ({ u: x.name.split('/').pop().slice(0, 40), b: Math.round(x.transferSize || x.encodedBodySize || 0) })).sort((a, b) => b.b - a.b).slice(0, 8) };
    });

    for (const [name, nav, extra] of MOBILE_SCREENS) out.screens.push(await captureScreen(page, 'mobile', name, nav, extra));

    // persona homes
    for (const [persona, who] of [['home-benedetta', 'Benedetta'], ['home-ginevra', 'Ginevra']]) {
      out.screens.push(await captureScreen(page, 'mobile', persona, async (p) => { await p.locator('.seg.wrap button', { hasText: who }).click(); }));
    }
    // reset persona to Ale
    await ctx.close();
  }

  // ---------- DESKTOP ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') out.console.push({ vp: 'desktop', type: m.type(), text: m.text().slice(0, 300) }); });
    for (const [name, nav, extra] of DESKTOP_SCREENS) out.screens.push(await captureScreen(page, 'desktop', name, nav, extra));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(out, null, 2));
  console.log('\nDONE. metrics.json written. screens:', out.screens.length, 'consoleMsgs:', out.console.length, 'pageErrors:', out.pageErrors.length, 'failedReq:', out.failedReq.length);
}
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
