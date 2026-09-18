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
  t('6  B3 errore upsert creative contato e pesa sulla severity', /if \(error\) creativeErr\+\+; else creativeRows/.test(SRC) && /const sev = dailyErr \|\| mapErr \|\| creativeErr \? 'warn' : 'ok'/.test(SRC));
  t('6b B3 zero ad letti = non "tutto ok"', /if \(!anag\.length\) creativeErr\+\+/.test(SRC));
  t('7  B4 health legge il nodo singolo (metaGetOne_) e fallisce se non vede l\'account', /const acct = await metaGetOne_\(/.test(SRC) && /if \(!acct\?\.name\) return fail\('health'/.test(SRC));
  t('8  B5 troncamento a maxPages dichiarato come errore', /throw new Error\(`troncato a \$\{maxPages\} pagine/.test(SRC));
  t('9  B6 dedup daily prima dell\'upsert', /new Map\(rows\.map\(\(r\) => \[r\.ad_id, r\]\)\)/.test(SRC) && /upsert\(dedup, \{ onConflict: 'date,ad_id' \}\)/.test(SRC));
  t('9b B6 dedup set-map prima dell\'upsert', /new Map\(rows\.map\(\(r\) => \[`\$\{r\.product_set_id\}\|\$\{r\.retailer_id\}`, r\]\)\)/.test(SRC) && /upsert\(dedupMap, \{ onConflict: 'product_set_id,retailer_id' \}\)/.test(SRC));
  t('10 C6 backfill a blocchi di max 30 giorni', /Math\.min\(30, Math\.max\(1, Number\(body\.days\)/.test(SRC) && /next_offset/.test(SRC));
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
  t('14b B1 soglie raggiungibili sulla media giornaliera (< 2,0, max osservato)', /freq_media_giornaliera_7,0\) >= 1\.8/.test(M129) && !/freq_media_giornaliera_7,0\) >= 3/.test(M129));
  t('15 B2 "set scoperto" gated sulla copertura (>=3 risolti e >= meta\' del set)', /prodotti_risolti,0\) >= 3/.test(M129) && /0\.5 \* nullif\(prodotti_nel_set,0\)/.test(M129));
  t('15b B2 il messaggio dice risolti/nel_set', /prodotti_risolti \|\| '\/' \|\| prodotti_nel_set/.test(M129));
  t('16 C2 vincoli unici verificati dopo il create', /meta_ads_creative_daily_uk/.test(M128) && /meta_product_set_map_uk/.test(M128) && /raise exception/.test(M128));
  t('17 tabelle base senza grant anon (letture solo via viste)', !/grant select[^\n]*(meta_ads_creative_daily|meta_ad_creative|meta_product_set_map)[^\n]*anon/.test(M128));
  t('18 C7 as_of esposto dalle finestre', /r\.d as as_of/.test(M129) && /w\.as_of/.test(M129));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
