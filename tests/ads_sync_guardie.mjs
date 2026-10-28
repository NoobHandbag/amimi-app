// tests/ads_sync_guardie.mjs — guardie sul SORGENTE di ads-sync e delle migr 0128/0129 (audit gate 2026-09-18)
//   node tests/ads_sync_guardie.mjs
//
// Nate dal Gate 2 della feature Amimì Ads (revisore indipendente): A1 token solo in header + redazione di ogni
// messaggio loggato (health_log e' leggibile da anon), B3-B7 guasti dichiarati sull'edge, B1/B2/C2 sulle viste e
// sulla migrazione. A2 (letture fail-closed) vive in letture_controllate_guardie.mjs. Classe non collaudabile a
// runtime (compare solo quando Meta o PostgREST rispondono male): si legge il sorgente e si verifica che i fix ci
// siano ancora; dove la logica e' pura la si replica qui e la si prova (blocco PURE), controllando che il sorgente
// contenga la stessa identica riga.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SRC = read('supabase/functions/ads-sync/index.ts');
const M128 = read('supabase/migrations/0128_meta_ads_creative.sql');
const M129 = read('supabase/migrations/0129_v_ads_creative.sql');
// 0130 ridefinisce v_ads_creative_status con le soglie tarate sui dati reali: e' la definizione VIVA da controllare.
const M130 = read('supabase/migrations/0130_v_ads_creative_status_taratura.sql');
const M132 = read('supabase/migrations/0132_ads_creative_redesign.sql');
const M133 = read('supabase/migrations/0133_v_ads_creative_status_v2.sql');
const M134 = read('supabase/migrations/0134_ads_frame_url.sql');
const ADS = read('web/src/pages/Ads.tsx');
const noComments = (s) => s.replace(/\/\/[^\n]*/g, '');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

console.log('\n== A1: il token Meta non passa mai dalla querystring e ogni messaggio loggato e\' redatto ==');
{
  const codice = noComments(SRC).replace(/const redact_ = [^\n]*\n/, '');
  t('1  nessun access_token= costruito nel codice (fuori da redact_)', !/access_token=/.test(codice));
  t('2  token in header authorization Bearer', /authorization: `Bearer \$\{token\}`/.test(SRC));
  t('3  fail() redige il messaggio prima di health_log e della risposta', /const fail = async[\s\S]{0,200}redact_\(msg\)/.test(SRC));
  t('4  health() redige la label', /const health = async[\s\S]{0,400}label: redact_\(label\)\.slice\(0, 500\)/.test(SRC));
  // PURE: la redazione toglie davvero il token da un rigetto di fetch che cita l'URL intero
  const redact_ = (s) => String(s ?? '').replace(/access_token=[^&\s)]*/gi, 'access_token=***');
  const rigetto = 'error sending request for url (https://graph.facebook.com/v21.0/123/products?fields=retailer_id&access_token=EAAsegreto123ABC&limit=100): dns error';
  t('5  redact_ toglie il token (autocontrollo del rilevatore)', !redact_(rigetto).includes('EAAsegreto123ABC') && redact_(rigetto).includes('access_token=***'));
  t('5b la redact_ del sorgente e\' identica a quella provata qui', SRC.includes("replace(/access_token=[^&\\s)]*/gi, 'access_token=***')"));
}

console.log('\n== B3/B4/B5/B6: guasti dichiarati, mai silenziosi ==');
{
  // v1.4 (28-10): la severity finale pesa anche winErr (finestre 14g); regex aggiornata di proposito, B3 resta dentro
  t('6  B3 errore upsert creative contato e pesa sulla severity', /if \(error\) creativeErr\+\+; else creativeRows/.test(SRC) && /const sev = dailyErr \|\| mapErr \|\| creativeErr \|\| winErr \|\| freqErr \? 'warn' : 'ok'/.test(SRC));
  t('6b B3 zero ad letti = non "tutto ok"', /if \(!anag\.length\) creativeErr\+\+/.test(SRC));
  // 28-10 (Gate 2 del giro v1.4): una freq7 fallita scriveva il warn e poi l'ok finale lo sovrascriveva (health su day,k)
  t('6c freq7 fallita contata (upsert ed eccezione) e pesa sulla severity e sul conteggio finale', (SRC.match(/freqErr\+\+/g) || []).length === 2 && /winErr \+ freqErr, sev as/.test(SRC) && /freq7 \$\{freqErr\}/.test(SRC));
  t('7  B4 health legge il nodo singolo (metaGetOne_) e fallisce se non vede l\'account', /const acct = await metaGetOne_\(/.test(SRC) && /if \(!acct\?\.name\) return fail\('health'/.test(SRC));
  t('8  B5 troncamento a maxPages dichiarato come errore', /throw new Error\(`troncato a \$\{maxPages\} pagine/.test(SRC));
  t('9  B6 dedup daily prima dell\'upsert', /new Map\(rows\.map\(\(r\) => \[r\.ad_id, r\]\)\)/.test(SRC) && /upsert\(dedup, \{ onConflict: 'date,ad_id' \}\)/.test(SRC));
  t('9b B6 dedup set-map prima dell\'upsert', /new Map\(rows\.map\(\(r\) => \[`\$\{r\.product_set_id\}\|\$\{r\.retailer_id\}`, r\]\)\)/.test(SRC) && /upsert\(dedupMap, \{ onConflict: 'product_set_id,retailer_id' \}\)/.test(SRC));
  t('10 C6 backfill a blocchi di max 30 giorni', /Math\.min\(30, Math\.max\(1, Number\(body\.days\)/.test(SRC) && /next_offset/.test(SRC));
  t('10b v1.1 risoluzione primaria via shopify_stock.variant_id, con lettura controllata', /const byVariant = variantMap\.get\(retailer\)/.test(SRC) && /from\('shopify_stock'\)\.select\('variant_id, codice'\)/.test(SRC) && /if \(skErr\) return fail\('shopify_stock'/.test(SRC));
}

console.log('\n== B7: date di Roma con Intl, mai il trucco toLocaleString ==');
{
  t('11 Intl en-CA Europe/Rome nel sorgente', /Intl\.DateTimeFormat\('en-CA', \{ timeZone: 'Europe\/Rome' \}\)/.test(SRC));
  t('12 nessun round-trip toLocaleString', !/toLocaleString\(/.test(SRC));
  // PURE: replica della logica romeDate_ e caso del cambio ora (28-03-2027 e' un giorno di 23 ore a Roma)
  const todayRome_ = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(now);
  const romeDate_ = (offsetDays, now) => new Date(Date.parse(todayRome_(now) + 'T00:00:00Z') - offsetDays * 86400000).toISOString().slice(0, 10);
  const now = new Date('2027-03-28T23:30:00Z'); // 29-03 01:30 a Roma, subito dopo il cambio ora
  const giorni = [1, 2, 3, 4].map((i) => romeDate_(i, now));
  t('13 il backfill non salta il giorno del cambio ora', giorni.includes('2027-03-28') && giorni.includes('2027-03-27'), giorni.join(','));
  t('13b nessun giorno duplicato', new Set(giorni).size === giorni.length, giorni.join(','));
  t('13c ieri visto da Roma alle 00:30 e\' davvero ieri (non l\'altro ieri)', romeDate_(1, new Date('2027-03-28T22:30:00Z')) === '2027-03-28');
  t('13d la logica PURE e\' identica al sorgente', SRC.includes("new Date(Date.parse(todayRome_(now) + 'T00:00:00Z') - offsetDays * 86400000).toISOString().slice(0, 10)"));
}

console.log('\n== B1/B2/C2: viste e migrazione ==');
{
  t('14 B1 la media della frequency giornaliera ha il suo nome (niente freq_7 che sembra a 7 giorni)', /freq_media_giornaliera_7/.test(M129) && !/\bfreq_7\b/.test(M129));
  t('14b B1 soglie tarate sui dati reali (max media 7g osservato 1,74): alta >= 1,7, mai >= 3', /freq_media_giornaliera_7,0\) >= 1\.7/.test(M130) && !/freq_media_giornaliera_7,0\) >= [23]/.test(M130) && /freq_media_giornaliera_7/.test(M130));
  t('15 B2 "set scoperto" gated sulla copertura (>=3 risolti e >= meta\' del set) nella definizione viva', /prodotti_risolti,0\) >= 3/.test(M130) && /0\.5 \* nullif\(prodotti_nel_set,0\)/.test(M130));
  t('15b B2 il messaggio dice risolti/nel_set', /prodotti_risolti \|\| '\/' \|\| prodotti_nel_set/.test(M130));
  t('16 C2 vincoli unici verificati dopo il create', /meta_ads_creative_daily_uk/.test(M128) && /meta_product_set_map_uk/.test(M128) && /raise exception/.test(M128));
  t('17 tabelle base senza grant anon (letture solo via viste)', !/grant select[^\n]*(meta_ads_creative_daily|meta_ad_creative|meta_product_set_map)[^\n]*anon/.test(M128));
  t('18 C7 as_of esposto dalle finestre', /r\.d as as_of/.test(M129) && /w\.as_of/.test(M129));
}

console.log('\n== redesign 0132: freq7 vera (punto 6), asset image_url, viste per modello ==');
{
  t('19 punto 6: freq7 chiamata al 7d e upsert su ad_id', /fields=ad_id,frequency,reach,impressions/.test(SRC) && /from\('meta_ad_freq7'\)\.upsert\(dedup, \{ onConflict: 'ad_id' \}\)/.test(SRC));
  t('19b freq7 secondaria: gate su backfill, errore upsert e eccezione in warn, mai fail', /!isBackfill \|\| startOffset === 0/.test(SRC) && /freq7 upsert FALLITO/.test(SRC) && /freq7 FALLITA/.test(SRC) && !/return fail\('freq/.test(SRC));
  t('19c 0132: adset_name in CODA a v_ads_creative_windows (create or replace append-only)', /as giorni_attivi_90,\s*(--[^\n]*\n\s*)?max\(d\.adset_name\) as adset_name/.test(M132) && !/as campaign_name,\s*max\(d\.adset_name\)/.test(M132));
  t('20 asset: image_url richiesto nella creative e salvato', /object_type,thumbnail_url,image_url,/.test(SRC) && /image_url: c\.image_url \?\? null/.test(SRC));
  t('21 0132: meta_ad_freq7 con RLS e senza grant anon (letture solo via viste)', /create table if not exists meta_ad_freq7/.test(M132) && /alter table meta_ad_freq7 enable row level security/.test(M132) && !/grant select[^\n]*meta_ad_freq7[^\n]*anon/.test(M132));
  t('22 0132: viste per modello con grant anon', /create or replace view v_ads_set_modelli/.test(M132) && /create or replace view v_ads_catalogo_modelli/.test(M132) && /grant select on v_ads_catalogo_modelli to anon/.test(M132));
  t('23 0133: status v2 su freq_7g reale, drop+create e regrant anon', /drop view if exists v_ads_creative_status/.test(M133) && /fq\.freq_7d as freq_7g/.test(M133) && /freq_7g >= 2\.5/.test(M133) && /grant select on v_ads_creative_status to anon/.test(M133));
  t('23b 0133: la fatica ha il fallback sulla media giornaliera per gli ad senza delivery 7d', /freq_7g is null and coalesce\(freq_media_giornaliera_7,0\) >= 1\.7/.test(M133));
}

console.log('\n== frame video lato server (owner 2026-09-20): fotogramma grande per i video ==');
{
  const src = noComments(SRC);
  t('24 edge: chiede il poster del video (video_data) e gli asset_feed videos', /video_data\{video_id,image_url\}/.test(src) && /asset_feed_spec\{videos\{video_id,thumbnail_url\}\}/.test(src));
  t('25 edge: frame_url dal poster e risoluzione dal nodo video col thumbnail piu\' grande', /frame_url: poster/.test(src) && /\/\$\{it\.videoId\}\?fields=picture,thumbnails\{uri,width,height,is_preferred\}/.test(src) && /is_preferred && t\.uri/.test(src));
  t('26 edge: fotogramma opzionale (try/catch, cap 20), non pesa sulla severity', /framesTried >= 20/.test(src) && /fotogramma opzionale/.test(SRC));
  t('27 0134: colonna frame_url + vista che la espone + regrant anon', /alter table meta_ad_creative add column if not exists frame_url text/.test(M134) && /drop view if exists v_ads_creative_status/.test(M134) && /c\.object_type, c\.thumbnail_url, c\.image_url, c\.frame_url,/.test(M134) && /grant select on v_ads_creative_status to anon/.test(M134));
  t('28 frontend: usa frame_url con fallback image_url poi thumbnail 64px', /img=\{r\.frame_url \?\? r\.image_url\}/.test(ADS) && /frame_url: r\.frame_url/.test(ADS));
}

console.log('\n== v1.4 (2026-10-28): colonne video sul daily e reach deduplicata sulle finestre 14g ==');
{
  const src = noComments(SRC);
  const flat = (s) => s.replace(/\)\s*\n\s*\./g, ').');
  t('29 insights: chiede video_thruplay_watched_actions', /const insightFields = \[[^\]]*'video_thruplay_watched_actions'[^\]]*\]\.join\(','\)/.test(SRC));
  t('30 daily: video_3s_views da actions video_view e thruplays da video_thruplay_watched_actions',
    /const thru = parseActions_\(r\.video_thruplay_watched_actions\)/.test(src) && /video_3s_views: a\['video_view'\] \|\| 0/.test(src) && /thruplays: thru\['video_view'\] \|\| 0/.test(src));
  // PURE: parseActions_ tiene i tipi non mappati col loro nome (video_view non e' in ACTION_MAP)
  const mapBlock = (SRC.match(/const ACTION_MAP[\s\S]*?\n\};/) ?? [''])[0];
  t('30b video_view NON e\' in ACTION_MAP (verrebbe rinominato)', mapBlock.length > 0 && !/video_view/.test(mapBlock));
  t('30c la riga di parseActions_ che tiene i tipi non mappati e\' identica a quella provata qui', SRC.includes("const mapped = ACTION_MAP[it.action_type ?? ''] ?? it.action_type ?? '';"));
  const parse = (arr) => { const out = {}; if (!Array.isArray(arr)) return out; for (const it of arr) { const mapped = ({ purchase: 'purchases' })[it.action_type ?? ''] ?? it.action_type ?? ''; if (!mapped) continue; const v = Number(it.value) || 0; if (!(mapped in out) || v > out[mapped]) out[mapped] = v; } return out; };
  const a = parse([{ action_type: 'video_view', value: '120' }, { action_type: 'purchase', value: '2' }]);
  t('30d PURE: video_view letto da actions, foto senza campo = 0', a['video_view'] === 120 && a['purchases'] === 2 && ((parse(undefined)['video_view'] || 0) === 0));

  const GATE = 'if (!isBackfill || startOffset === 0) {';
  const gates = SRC.split(GATE).length - 1;
  const iGate2 = SRC.indexOf(GATE, SRC.indexOf(GATE) + 1);
  const iWin = SRC.indexOf("from('meta_ads_window_reach')");
  const iAnag = SRC.indexOf('// ---- anagrafica creative');
  t('31 finestre gated come freq7 (giro corrente o primo blocco di backfill, non ogni blocco)', gates === 2 && iGate2 > SRC.indexOf("from('meta_ad_freq7')") && iWin > iGate2 && iWin < iAnag && SRC.split("from('meta_ads_window_reach')").length === 2, `gate ${gates}`);
  const winBlock = iGate2 > 0 && iAnag > iGate2 ? SRC.slice(iGate2, iAnag) : '';
  t('32 upsert idempotente su level,object_id,window_key, dedup prima (B6)', /upsert\(dedup, \{ onConflict: 'level,object_id,window_key' \}\)/.test(winBlock) && /new Map\(wrows\.map\(\(r\) => \[`\$\{r\.level\}\|\$\{r\.object_id\}\|\$\{r\.window_key\}`, r\]\)\)/.test(winBlock));
  t('33 errore di upsert destrutturato e trasformato in warn, mai fail', /const \{ error \} = await sb\.from\('meta_ads_window_reach'\)\.upsert\([^\n]*\n\s*if \(error\) \{ winErr\+\+;/.test(winBlock) && /if \(winErr\) await health\([^\n]*'warn'\)/.test(winBlock) && /catch \(e\) \{\s*winErr\+\+;/.test(winBlock) && !/return fail\(|return json\(/.test(winBlock));
  t('33b l\'errore delle finestre resta nella label finale (health upsert su day,k: il warn intermedio verrebbe sovrascritto)', /\$\{winRows\} finestre 14g/.test(SRC) && /finestre \$\{winErr\}/.test(SRC) && /dailyErr \+ mapErr \+ creativeErr \+ winErr/.test(SRC));
  t('34 quattro livelli e due finestre (cur14 = romeDate_(14..1), prev14 = romeDate_(28..15))',
    winBlock.includes("['account', 'campaign', 'adset', 'ad']") && winBlock.includes("{ key: 'cur14', since: romeDate_(14, now), until: romeDate_(1, now) }") && winBlock.includes("{ key: 'prev14', since: romeDate_(28, now), until: romeDate_(15, now) }") && /level === 'account' \? AD_ACCOUNT : String\(r\[`\$\{level\}_id`\] \?\? ''\)/.test(winBlock));
  t('34b per livello si chiede solo il suo id con reach/frequency/impressions/spend', winBlock.includes("const campi = (level === 'account' ? '' : `${level}_id,`) + 'reach,frequency,impressions,spend';") && /insights\?level=\$\{level\}&time_range=\$\{trw\}&fields=\$\{campi\}&limit=200/.test(winBlock));
  // PURE: finestre contigue di 14 giorni l'una, anche a cavallo del cambio ora (fine ottobre)
  const todayRome_ = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(now);
  const romeDate_ = (offsetDays, now) => new Date(Date.parse(todayRome_(now) + 'T00:00:00Z') - offsetDays * 86400000).toISOString().slice(0, 10);
  const now = new Date('2026-10-28T05:07:00Z');
  const giorni = (s, u) => Math.round((Date.parse(u) - Date.parse(s)) / 86400000) + 1;
  const c14 = [romeDate_(14, now), romeDate_(1, now)], p14 = [romeDate_(28, now), romeDate_(15, now)];
  t('34c PURE: cur14 e prev14 di 14 giorni, contigue, cur14 finisce ieri', giorni(...c14) === 14 && giorni(...p14) === 14 && giorni(p14[1], c14[0]) === 2 && c14[1] === '2026-10-27', `${c14} ${p14}`);

  const lette = [...flat(src).matchAll(/\.from\('([^']+)'\)\.select\(/g)].map((m) => m[1]).sort();
  t('35 nessuna nuova lettura di tabella: solo app_config, product_aliases, products, shopify_stock', JSON.stringify([...new Set(lette)]) === JSON.stringify(['app_config', 'product_aliases', 'products', 'shopify_stock']), lette.join(','));
  const scritte = [...new Set([...flat(src).matchAll(/\.from\('([^']+)'\)\.upsert\(/g)].map((m) => m[1]))];
  const testata = SRC.split('\n').slice(0, 4).join('\n');
  t('36 la testata del file nomina ogni tabella scritta (niente piu\' "scrive SOLO" falso)', scritte.length >= 6 && scritte.every((tb) => testata.includes(tb)), scritte.filter((tb) => !testata.includes(tb)).join(','));
}

console.log('\n== Gate 2 del giro v1.4 (28-10): un orologio per giro, cause degli errori nella label ==');
{
  // C2: ogni romeDate_ leggeva un orologio suo; un giro a cavallo della mezzanotte di Roma calcolava i daily su D e
  // freq7/finestre su D+1. Nel giro (Deno.serve) nessuna chiamata di data senza `now`, commenti esclusi.
  const serve = noComments(SRC.slice(SRC.indexOf('Deno.serve(')));
  const chiamate = [...serve.matchAll(/\b(romeDate_|todayRome_)\(([^()]*)\)/g)];
  const senzaNow = chiamate.filter((m) => !/(^|, )now$/.test(m[2].trim())).map((m) => m[0]);
  t('37 C2 un solo orologio: const now = new Date() subito dopo il body, ogni romeDate_ del giro lo riceve',
    /const body = await req\.json\(\)[^\n]*\n\s*const now = new Date\(\);/.test(SRC) && chiamate.length >= 7 && senzaNow.length === 0, senzaNow.join(' ') || `chiamate ${chiamate.length}`);

  // C3/X7: health_log e' un upsert su (day,k), resta solo l'ultima label: le cause vanno in quella
  const righe = SRC.split('\n');
  const finale = righe.find((l) => l.includes('await health(`pull ')) ?? '';
  t('38 C3 freqWarn tenuto come winWarn (upsert ed eccezione) e nella label finale, tagliato a 150',
    /freqErr\+\+; freqWarn = `upsert: \$\{error\.message\}`/.test(SRC) && /freqErr\+\+; freqWarn = `insights: \$\{\(e as Error\)\.message\}`/.test(SRC)
    && /freqWarn \? ` \(freq7 \$\{freqWarn\.slice\(0, 150\)\}\)`/.test(SRC) && /winWarn \? ` \(finestre \$\{winWarn\.slice\(0, 150\)\}\)`/.test(SRC) && /freq7 \$\{freqErr\}` \+ cause_\(\)/.test(finale));
  const ritorni = ['anagrafica creative FALLITA', 'product_set map FALLITA'].map((k) => {
    const i = righe.findIndex((l) => l.includes(k) && l.includes('await health('));
    return i < 0 ? ['', ''] : [righe[i], righe[i + 1] ?? ''];
  });
  t('38b C3 i due ritorni anticipati portano winErr e freqErr (e le cause) nella label e nel JSON',
    ritorni.every(([h, j]) => /\$\{winErr\}/.test(h) && /\$\{freqErr\}/.test(h) && /` \+ cause_\(\), 1 \+ [^\n]*winErr \+ freqErr, 'warn'\);/.test(h) && /return json\(\{[^}]*\bwinErr, freqErr\b/.test(j)),
    ritorni.map(([h]) => h.trim().slice(0, 60)).join(' | '));
  t('39 X7 la prima causa di upsert del daily resta (redatta) e va nella label finale',
    /if \(error\) \{ dailyErr\+\+; if \(!dailyWarn\) dailyWarn = redact_\(error\.message\); \}/.test(SRC) && /dailyWarn \? ` \(daily: \$\{dailyWarn\.slice\(0, 150\)\}\)`/.test(SRC) && /cause_\(\)/.test(finale));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
