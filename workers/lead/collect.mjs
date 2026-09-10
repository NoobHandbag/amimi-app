// Collector del modulo lead_* : per ogni account in stato `seed` (o quelli indicati) raccoglie
// sito, Instagram e Google Maps con screenshot, e scrive evidenze in lead_evidence + bucket lead-assets.
// ZERO modello: il giudizio (lead_scores) lo fa la sessione Claude Code leggendo le evidenze.
// Protocollo: Cowork12/projects/B2B_Prospecting_2026-09/PROTOCOLLO_Ricerca_Profilo.md (stadi C1-C3).
//
// Uso:  node collect.mjs [--limit N] [--id <uuid>] [--stato seed|enriched] [--only site,ig,maps] [--dry]
// Idempotente: ogni stage aggiunge evidenze nuove (append-only, con run_id); ri-lanciare un account
// non cancella nulla e la vista v_lead_dossier mostra sempre l'ultima evidenza per tipo.
import { chromium } from 'playwright';
import { supa, startRun, endRun, evidence, upload, num, sleep, UA, peerMatches, BAG_WORDS } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const LIMIT = Number(args.limit || 50);
const ONLY = (args.only ? String(args.only).split(',') : ['site', 'ig', 'maps', 'press']);
const STATO = args.stato || 'seed';
const DRY = !!args.dry;

const sb = await supa();
let q = sb.from('lead_accounts').select('*').order('created_at');
if (args.id) q = q.eq('id', args.id); else q = q.eq('stato_ricerca', STATO).limit(LIMIT);
const { data: accounts, error } = await q;
if (error) throw error;
console.log(`[collect] ${accounts.length} account, stage: ${ONLY.join('+')}${DRY ? ' (DRY: niente scritture)' : ''}`);
if (!accounts.length) process.exit(0);

const runId = DRY ? null : await startRun(sb, 'collect', accounts.length, `stage ${ONLY.join('+')}`);
const browser = await chromium.launch({ headless: true });
const log = [];
let nOk = 0, nErr = 0;

async function ctxNew(mobile = false) {
  return browser.newContext({
    locale: 'it-IT', userAgent: UA, ignoreHTTPSErrors: true,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1,
  });
}
async function clickAny(page, labels) {
  for (const l of labels) { const b = page.getByRole('button', { name: l }).first(); if (await b.count()) { try { await b.click({ timeout: 2000 }); return l; } catch { /* next */ } } }
  return null;
}
async function saveShot(acc, tipo, buffer, payload, note) {
  if (DRY) { console.log(`   [dry] ${tipo} ${buffer ? buffer.length + 'B' : ''}`); return; }
  const path = buffer ? await upload(sb, `${acc.id}/${tipo}_${Date.now()}.png`, buffer) : null;
  await evidence(sb, { account_id: acc.id, run_id: runId, tipo, payload: payload ?? null, asset_path: path, raccolto_da: 'script', note: note ?? null });
}
async function saveEv(acc, tipo, payload, note) {
  if (DRY) { console.log(`   [dry] ${tipo}: ${JSON.stringify(payload).slice(0, 160)}`); return; }
  await evidence(sb, { account_id: acc.id, run_id: runId, tipo, payload, raccolto_da: 'script', note: note ?? null });
}
const norm = (u) => { if (!u) return null; u = u.trim(); if (!/^https?:\/\//i.test(u)) u = 'https://' + u; return u; };
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
// scarica un'immagine (CDN Instagram/Shopify/Google) e la carica nel bucket; null se fallisce
async function dlUpload(ctx, url, path, referer) {
  try {
    const r = await ctx.request.get(url, { headers: referer ? { referer } : {}, timeout: 20000 });
    if (!r.ok()) return null;
    const ct = r.headers()['content-type'] || 'image/jpeg';
    const ext = /webp/.test(ct) ? 'webp' : /png/.test(ct) ? 'png' : 'jpg';
    const full = `${path}.${ext}`;
    if (DRY) return full;
    await upload(sb, full, await r.body(), ct.split(';')[0]);
    return full;
  } catch { return null; }
}
const parseAltDate = (alt) => { const m = (alt || '').match(/on ([A-Z][a-z]+) (\d{1,2}), (\d{4})/); if (!m) return null; const mi = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(m[1].toLowerCase()); if (mi < 0) return null; return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`; };

// --------------------------------------------------------------------------- C1: sito
async function stageSite(acc) {
  const url = norm(acc.website);
  if (!url) { await saveEv(acc, 'site_meta', { errore: 'nessun sito in anagrafica' }); return 'no_site'; }
  const ctx = await ctxNew(false); const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2500);
    await clickAny(page, ['Accetta', 'Accetto', 'Accept', 'Accept all', 'Accetta tutti', 'OK', 'Ho capito', 'Rifiuta', 'Reject']);
    await page.waitForTimeout(800);
    const html = await page.content();
    const title = await page.title();
    const meta = await page.locator('meta[name="description"]').first().getAttribute('content').catch(() => null);
    const lang = await page.locator('html').getAttribute('lang').catch(() => null);
    const links = await page.locator('a[href]').evaluateAll((els) => els.map((e) => ({ t: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60), h: e.href })).filter((x) => x.h));
    const emails = [...new Set((html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|svg|webp|gif|css|js)$/i.test(e) && !/example|sentry|wixpress|schema\.org/.test(e)))];
    const phones = [...new Set((html.replace(/<[^>]+>/g, ' ').match(/(?:\+39|0039)?\s?0?\d{2,4}[\s./-]?\d{5,8}\b/g) || []).map((p) => p.trim()).filter((p) => p.replace(/\D/g, '').length >= 9 && p.replace(/\D/g, '').length <= 13))].slice(0, 6);
    const piva = (html.match(/(?:P\.?\s?IVA|VAT|Partita IVA)[^0-9]{0,20}(IT)?\s?(\d{11})/i) || [])[2] || null;
    const ig = links.find((l) => /instagram\.com\/[^/?]+/i.test(l.h))?.h.match(/instagram\.com\/([^/?#]+)/i)?.[1] || null;
    const fb = links.find((l) => /facebook\.com\//i.test(l.h))?.h || null;
    const ecommerce = /\/cart|\/checkout|add[-_ ]to[-_ ]cart|aggiungi al carrello|\/products?\//i.test(html);
    const platform = /cdn\.shopify\.com|Shopify\.theme/i.test(html) ? 'shopify' : /wp-content/i.test(html) ? (/woocommerce/i.test(html) ? 'woocommerce' : 'wordpress') : /squarespace/i.test(html) ? 'squarespace' : /wixstatic|wix\.com/i.test(html) ? 'wix' : null;
    const shotDesk = await page.screenshot({ fullPage: true }).catch(() => null);
    await saveShot(acc, 'screenshot_home', shotDesk, { url, title });
    await saveEv(acc, 'site_meta', { url, title, meta, lang, platform, ecommerce, emails, phones, piva, ig_from_site: ig, facebook: fb, n_links: links.length });

    // pagina brand / designer / marchi
    const brandLink = links.find((l) => /(^|\/)(brands?|designers?|marchi|i-nostri-brand|our-brands)(\/|$|\.|\?)/i.test(l.h) || /^(brand|brands|designers|marchi|i nostri brand)$/i.test(l.t));
    let brandsText = null, brandsSource = null;
    if (brandLink) {
      try { await page.goto(brandLink.h, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(1500);
        brandsText = (await page.locator('main, body').first().innerText()).replace(/\s+\n/g, '\n').slice(0, 4000); brandsSource = brandLink.h; } catch { /* ignora */ }
    }
    // Shopify: vendor = brand, prezzi = fascia
    let vendors = null, prices = null;
    if (platform === 'shopify') {
      try {
        const r = await ctx.request.get(new URL('/products.json?limit=250', url).toString());
        if (r.ok()) {
          const j = await r.json(); const ps = j.products || [];
          vendors = [...new Set(ps.map((p) => (p.vendor || '').trim()).filter(Boolean))];
          const all = ps.flatMap((p) => (p.variants || []).map((v) => parseFloat(v.price)).filter((x) => x > 0));
          const bags = ps.filter((p) => BAG_WORDS.test(`${p.title} ${p.product_type || ''} ${(p.tags || []).join(' ')}`)).flatMap((p) => (p.variants || []).map((v) => parseFloat(v.price)).filter((x) => x > 0));
          const stats = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return { n: s.length, min: s[0], mediana: s[Math.floor(s.length / 2)], max: s[s.length - 1] }; };
          prices = { n_prodotti: ps.length, tutti: stats(all), borse: stats(bags), fonte: 'products.json' };
          // foto prodotto: prima le borse, poi il resto, max 12, immagini a 400px
          const isBag = (p) => BAG_WORDS.test(`${p.title} ${p.product_type || ''} ${(p.tags || []).join(' ')}`);
          const pick = [...ps.filter(isBag), ...ps.filter((p) => !isBag(p))].filter((p) => p.images?.[0]?.src).slice(0, 12);
          const prods = [];
          for (const [i, p] of pick.entries()) {
            const src = p.images[0].src.replace(/(\.[a-z]+)(\?|$)/i, '_400x$1$2');
            const path = await dlUpload(ctx, src, `${acc.id}/product_${Date.now()}_${i}`);
            prods.push({ titolo: p.title, prezzo: parseFloat(p.variants?.[0]?.price) || null, vendor: p.vendor || null, tipo: p.product_type || null, borsa: isBag(p), url: new URL(`/products/${p.handle}`, url).toString(), asset_path: path });
          }
          if (prods.length) await saveEv(acc, 'site_products', { fonte: 'products.json', n: prods.length, n_borse: prods.filter((x) => x.borsa).length, prodotti: prods });
        }
      } catch { /* ignora */ }
    }
    const textForMatch = `${brandsText || ''} ${(vendors || []).join(' ')} ${html.replace(/<[^>]+>/g, ' ')}`.toLowerCase();
    const peer = peerMatches(textForMatch);
    await saveEv(acc, 'brands_carried', { fonte: brandsSource || (vendors ? 'shopify_vendors' : 'home_html'), lista_pagina: brandsText, vendors, peer_match: [...new Set(peer)] });
    if (prices) await saveEv(acc, 'price_band', prices);

    // about / chi siamo
    const about = links.find((l) => /(chi-siamo|about|la-boutique|storia|story|il-negozio|who-we-are|our-story)/i.test(l.h) || /^(chi siamo|about|about us|la boutique|storia|story)$/i.test(l.t));
    if (about) { try { await page.goto(about.h, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(1200);
      const t = (await page.locator('main, body').first().innerText()).replace(/\n{2,}/g, '\n').slice(0, 3000); await saveEv(acc, 'about_text', { url: about.h, testo: t }); } catch { /* ignora */ } }
    // contatti
    const contact = links.find((l) => /(contatti|contact|contacts|contattaci)/i.test(l.h) || /^(contatti|contact|contacts|contattaci)$/i.test(l.t));
    if (contact) { try { await page.goto(contact.h, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(1200);
      const h2 = await page.content(); const t = (await page.locator('main, body').first().innerText()).slice(0, 2500);
      const em2 = [...new Set((h2.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|svg|webp|gif|css|js)$/i.test(e)))];
      await saveEv(acc, 'contatti_trovati', { url: contact.h, emails: em2, testo: t }); } catch { /* ignora */ } }
    await page.close(); await ctx.close();
    // mobile above the fold
    const mctx = await ctxNew(true); const mp = await mctx.newPage();
    try { await mp.goto(url, { waitUntil: 'load', timeout: 45000 }); await mp.waitForTimeout(2000); await clickAny(mp, ['Accetta', 'Accetto', 'Accept', 'Accept all', 'OK', 'Rifiuta']);
      const shotMob = await mp.screenshot({ fullPage: false }); await saveShot(acc, 'screenshot_home_mobile', shotMob, { url }); } catch (e) { await saveEv(acc, 'errore', { stage: 'site_mobile', msg: e.message }); }
    await mctx.close();
    return 'ok';
  } catch (e) {
    await saveEv(acc, 'errore', { stage: 'site', url, msg: e.message.slice(0, 300) });
    await ctx.close().catch(() => {});
    return 'err';
  }
}

// --------------------------------------------------------------------------- C2: Instagram
async function stageIg(acc, siteIg) {
  const handle = (acc.ig_handle || siteIg || '').replace(/^@/, '').trim();
  if (!handle) { await saveEv(acc, 'ig_metrics', { errore: 'nessun handle Instagram (non in anagrafica e non dal sito)' }); return 'no_ig'; }
  const ctx = await ctxNew(false); const page = await ctx.newPage();
  try {
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500);
    await clickAny(page, ['Rifiuta i cookie facoltativi', 'Decline optional cookies', 'Rifiuta']);
    await page.waitForTimeout(2500);
    // il modale "Vedi foto, video..." oscura la griglia nello screenshot: si chiude con la X
    for (let i = 0; i < 2; i++) { const x = page.locator('[aria-label="Chiudi"], [aria-label="Close"]').first(); if (await x.count()) { await x.click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(800); } }
    const og = await page.locator('meta[property="og:description"]').getAttribute('content').catch(() => null);
    const title = await page.title();
    const header = await page.locator('header').innerText().catch(() => '');
    const m = og && og.match(/([\d.,]+\s*(?:k|mln|m)?)\s*follower[^,]*,\s*([\d.,]+\s*(?:k|mln|m)?)\s*(?:seguiti|following)[^,]*,\s*([\d.,]+\s*(?:k|mln|m)?)\s*post/i);
    const loginWall = /Accedi|Log in/i.test(await page.locator('body').innerText().catch(() => '')) && !m;
    const bio = header.split('\n').slice(2).join(' | ').slice(0, 600);
    const posts = await page.locator('main img').evaluateAll((els) => els.map((e) => ({ alt: (e.getAttribute('alt') || '').slice(0, 200), src: e.getAttribute('src') || '' })).filter((x) => x.src && !/profilo|profile/i.test(x.alt) && !/storia in evidenza|highlight/i.test(x.alt)).slice(0, 12));
    const shot = await page.screenshot({ fullPage: false }).catch(() => null);
    // feed: i primi 12 post (oltre serve il login), scaricati e caricati nel bucket
    const postLinks = await page.locator('main a[href*="/p/"], main a[href*="/reel/"]').evaluateAll((els) => els.map((a) => { const img = a.querySelector('img'); return { href: a.getAttribute('href'), src: img?.getAttribute('src') || '', alt: (img?.getAttribute('alt') || '').slice(0, 300) }; }).filter((p) => p.src)).catch(() => []);
    const igPosts = [];
    for (const [i, p] of postLinks.slice(0, 12).entries()) {
      const path = await dlUpload(ctx, p.src, `${acc.id}/igpost_${Date.now()}_${i}`, 'https://www.instagram.com/');
      igPosts.push({ i, url: p.href ? `https://www.instagram.com${p.href}` : null, alt: p.alt, data: parseAltDate(p.alt), reel: /\/reel\//.test(p.href || ''), asset_path: path });
    }
    const dates = igPosts.map((x) => x.data).filter(Boolean).sort();
    const cadenza = dates.length >= 2 ? { primo: dates[0], ultimo: dates[dates.length - 1], n: dates.length, giorni: Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000) } : null;
    if (igPosts.length) await saveEv(acc, 'ig_posts', { handle, n: igPosts.length, n_scaricati: igPosts.filter((x) => x.asset_path).length, cadenza, post: igPosts });
    const payload = { handle, url: `https://www.instagram.com/${handle}/`, title, follower: m ? num(m[1]) : null, seguiti: m ? num(m[2]) : null, post: m ? num(m[3]) : null, og, bio, login_wall: loginWall, n_post_visibili: posts.length, post_alt: posts.map((p) => p.alt).filter(Boolean).slice(0, 12) };
    if (!m && !/• Foto e video di Instagram|Instagram photos and videos/i.test(title)) payload.errore = 'profilo non trovato o non leggibile';
    await saveShot(acc, 'screenshot_ig', shot, { handle });
    await saveEv(acc, 'ig_metrics', payload);
    await ctx.close();
    return m ? 'ok' : 'partial';
  } catch (e) {
    await saveEv(acc, 'errore', { stage: 'ig', handle, msg: e.message.slice(0, 300) });
    await ctx.close().catch(() => {});
    return 'err';
  }
}

// --------------------------------------------------------------------------- C3: Google Maps
async function stageMaps(acc) {
  const query = `${acc.nome} ${acc.citta || ''}`.trim();
  if (!acc.citta && !acc.indirizzo) { await saveEv(acc, 'maps', { errore: 'nessuna citta\' o indirizzo: ricerca Maps non sensata', query }); return 'skip'; }
  // se il seed porta gia' il google_maps_url (fonte maps), si va DRITTI sulla scheda giusta:
  // evita il rischio di aprire un omonimo e prende il sito web che Google elenca per QUEL posto.
  const placeUrl = acc.google_maps_url && /\/maps\/place\//.test(acc.google_maps_url) ? acc.google_maps_url : null;
  const ctx = await ctxNew(false); const page = await ctx.newPage();
  try {
    await page.goto(placeUrl || `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=it`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await clickAny(page, ['Rifiuta tutto', 'Reject all']);
    await page.waitForTimeout(3500);
    // solo in ricerca (no place url): lista di risultati, apri il primo
    if (!placeUrl) { const feed = page.locator('div[role="feed"] a[href*="/maps/place/"]').first();
      if (await feed.count()) { await feed.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(3000); } }
    const main = await page.locator('div[role="main"]').first().innerText().catch(() => '');
    const lines = main.split('\n').map((s) => s.trim()).filter(Boolean);
    const rating = (main.match(/\n(\d[.,]\d)\n/) || [])[1] || null;
    const reviews = (main.match(/\((\d[\d.]*)\)/) || [])[1] || null;
    const address = lines.find((l) => /\d{5}\s+[A-Za-zÀ-ÿ' ]+/.test(l) && /,/.test(l)) || null;
    const phone = lines.find((l) => /^\+?\d[\d\s]{7,}$/.test(l)) || null;
    const hours = lines.find((l) => /^(Aperto|Chiuso|Apre|Chiude|Chiuso definitivamente|Chiuso temporaneamente)/i.test(l)) || null;
    const hasWord = (l) => /[A-Za-zÀ-ÿ]{3,}/.test(l);
    const nameLine = lines.find((l) => hasWord(l) && !/^Visualizza foto|^Risultati/i.test(l)) || null;
    const iRating = lines.findIndex((l) => l === rating);
    const category = (iRating > 0 ? (lines.slice(iRating + 1, iRating + 5).find((l) => hasWord(l) && !/^\(|^\d/.test(l) && l.length < 60) || null) : null)?.replace(/^[·\s]+|[·\s]+$/g, '') || null;
    const site = lines.find((l) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(l)) || null;
    const url = page.url();
    const placeId = (url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || [])[1] || null;
    const coords = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const shot = await page.screenshot({ fullPage: false }).catch(() => null);
    // recensioni (tab) e foto (tab), best effort
    try {
      const tab = page.getByRole('tab', { name: /Recensioni|Reviews/ }).first();
      if (await tab.count()) {
        await tab.click({ timeout: 3000 }); await page.waitForTimeout(3000);
        for (const b of await page.getByRole('button', { name: /^Altro$|^More$/ }).all()) { await b.click({ timeout: 800 }).catch(() => {}); }
        const revs = await page.locator('div[data-review-id]').evaluateAll((els) => { const seen = new Set(); const out = []; for (const e of els) { const id = e.getAttribute('data-review-id'); if (seen.has(id)) continue; seen.add(id); const stars = e.querySelector('[role="img"][aria-label*="stell"], [role="img"][aria-label*="star"]')?.getAttribute('aria-label') || null; const txt = e.innerText.replace(/\s+/g, ' ').trim(); if (txt.length > 20) out.push({ stelle: stars, testo: txt.slice(0, 500) }); } return out.slice(0, 6); }).catch(() => []);
        if (revs.length) await saveEv(acc, 'maps_reviews', { n: revs.length, recensioni: revs });
      }
      // foto: non e' un tab ma il bottone sull'immagine di testata ("Visualizza foto" / "Tutte le foto")
      await page.getByRole('tab', { name: /Panoramica|Overview/ }).first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(800);
      const fbtn = page.getByRole('button', { name: /Visualizza foto|Tutte le foto|Foto e video|See photos|All photos/ }).first();
      if (await fbtn.count()) { await fbtn.click({ timeout: 3000 }); await page.waitForTimeout(3500); const fshot = await page.screenshot({ fullPage: false }).catch(() => null); if (fshot) await saveShot(acc, 'screenshot_maps_photos', fshot, { query }); }
    } catch { /* best effort */ }
    // sito web elencato da Google per la scheda: e' l'aggancio che accende stageSite (e via sito, Instagram)
    // per gli account nati da Maps, che in anagrafica non hanno ne' website ne' ig_handle.
    const siteNorm = site && !/instagram|facebook|tripadvisor|tiktok|wa\.me|whatsapp|google\.|maps\./i.test(site) ? norm(site) : null;
    const payload = { query, nome_scheda: nameLine, rating: rating ? parseFloat(rating.replace(',', '.')) : null, recensioni: reviews ? num(reviews) : null, categoria: category, indirizzo: address, telefono: phone, orari: hours, sito: site, sito_persistito: siteNorm, place_id: placeId, url: url.slice(0, 500), lat: coords ? parseFloat(coords[1]) : null, lng: coords ? parseFloat(coords[2]) : null, chiuso_definitivamente: /Chiuso definitivamente/i.test(main) };
    if (!rating && !address) payload.errore = 'scheda non riconosciuta (nessun rating ne\' indirizzo nel pannello)';
    await saveShot(acc, 'screenshot_maps', shot, { query });
    await saveEv(acc, 'maps', payload);
    if (!DRY && !payload.errore) {
      const upd = {};
      if (placeId && !acc.google_place_id) upd.google_place_id = placeId;
      if (coords && acc.lat == null) { upd.lat = payload.lat; upd.lng = payload.lng; }
      if (!acc.google_maps_url) upd.google_maps_url = url.slice(0, 500);
      if (siteNorm && !acc.website) { upd.website = siteNorm; acc.website = siteNorm; } // acc.website in memoria: stageSite lo usa subito dopo
      if (phone && !acc.telefono) upd.telefono = phone;
      if (address && !acc.indirizzo) upd.indirizzo = address;
      if (Object.keys(upd).length) await sb.from('lead_accounts').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', acc.id);
    }
    await ctx.close();
    return payload.errore ? 'partial' : 'ok';
  } catch (e) {
    await saveEv(acc, 'errore', { stage: 'maps', query, msg: e.message.slice(0, 300) });
    await ctx.close().catch(() => {});
    return 'err';
  }
}

// --------------------------------------------------------------------------- C4: stampa e web (DuckDuckGo html, niente chiavi)
async function stagePress(acc) {
  const ctx = await ctxNew(false);
  try {
    const q = `"${acc.nome}" ${acc.citta || ''}`.trim();
    const r = await ctx.request.get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: { 'user-agent': UA }, timeout: 20000 });
    if (!r.ok()) { await saveEv(acc, 'stampa', { query: q, errore: `ddg ${r.status()}` }); await ctx.close(); return 'err'; }
    const h = await r.text();
    const own = domainOf(norm(acc.website) || '') || '___';
    const clean = (t) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
    const res = [...h.matchAll(/<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>(.*?)<\/a>/g)].map((m) => {
      const u = decodeURIComponent((m[1].match(/uddg=([^&]+)/) || [])[1] || m[1]);
      return { url: u, dominio: domainOf(u), titolo: clean(m[2]).slice(0, 120), snippet: clean(m[3]).slice(0, 220) };
    }).filter((x) => x.dominio && !/instagram\.com|facebook\.com|google\.|duckduckgo|tiktok\.com|linkedin\.com|pinterest/.test(x.dominio) && x.dominio !== own).slice(0, 8);
    await saveEv(acc, 'stampa', { query: q, n: res.length, risultati: res });
    await ctx.close();
    return res.length ? 'ok' : 'partial';
  } catch (e) { await saveEv(acc, 'errore', { stage: 'press', msg: e.message.slice(0, 300) }); await ctx.close().catch(() => {}); return 'err'; }
}

// --------------------------------------------------------------------------- loop
for (const acc of accounts) {
  const t0 = Date.now(); const res = {};
  console.log(`\n== ${acc.nome} (${acc.citta || acc.paese})`);
  try {
    // ordine: MAPS prima (per gli account nati da Maps trova e persiste il website), poi SITO
    // (che usa il website appena trovato e ne ricava l'handle Instagram), poi IG, poi press.
    if (ONLY.includes('maps')) { res.maps = await stageMaps(acc); console.log(`   maps: ${res.maps}`); }
    let siteIg = null;
    if (ONLY.includes('site')) { res.site = await stageSite(acc); console.log(`   site: ${res.site}`);
      if (!DRY) { const { data } = await sb.from('lead_evidence').select('payload').eq('account_id', acc.id).eq('tipo', 'site_meta').order('captured_at', { ascending: false }).limit(1); siteIg = data?.[0]?.payload?.ig_from_site || null; } }
    if (ONLY.includes('ig')) { res.ig = await stageIg(acc, siteIg); console.log(`   ig: ${res.ig}`); await sleep(15000 + Math.random() * 10000); }
    if (ONLY.includes('press')) { res.press = await stagePress(acc); console.log(`   press: ${res.press}`); }
    const anyOk = Object.values(res).some((v) => v === 'ok' || v === 'partial');
    if (!DRY && anyOk && acc.stato_ricerca === 'seed') await sb.from('lead_accounts').update({ stato_ricerca: 'enriched', updated_at: new Date().toISOString() }).eq('id', acc.id);
    if (!DRY && siteIg && !acc.ig_handle) await sb.from('lead_accounts').update({ ig_handle: siteIg }).eq('id', acc.id);
    anyOk ? nOk++ : nErr++;
  } catch (e) { nErr++; res.fatal = e.message; console.log('   FATAL', e.message); }
  res.ms = Date.now() - t0; log.push({ id: acc.id, nome: acc.nome, ...res });
  console.log(`   ${Math.round(res.ms / 1000)}s`);
}
await browser.close();
if (!DRY) await endRun(sb, runId, { n_ok: nOk, n_err: nErr, log });
console.log(`\n[collect] fine: ok ${nOk}, err ${nErr}, run ${runId}`);
