// Digest COMPATTO per il giudizio (stadio D): per ogni account (default enriched) stampa in testo
// solo i campi che servono alla rubrica + l'id evidenza abbreviato (8 char) da citare in prova.
// Molto piu' leggero di evidence.json (niente array `tutte`): la sessione Claude legge questo,
// poi apre a mano SOLO le immagini chiave (screenshot_ig, home_mobile, maps_photos) per lo stile.
// Uso: node judge_digest.mjs [--stato enriched] [--citta Milano] [--limit N] [--id uuid]
import { supa } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const sb = await supa();
let q = sb.from('lead_accounts').select('*').order('citta').order('created_at');
if (args.id) q = q.eq('id', args.id);
else { q = q.eq('stato_ricerca', args.stato || 'enriched'); if (args.citta) q = q.eq('citta', args.citta); if (args.limit) q = q.limit(Number(args.limit)); }
const { data: accounts, error } = await q; if (error) throw error;

const short = (s, n = 220) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n));
const eid = (id) => (id ? id.slice(0, 8) : '????????');
const j = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

console.log(`# JUDGE DIGEST — ${accounts.length} account (stato=${args.id ? 'id' : args.stato || 'enriched'}${args.citta ? ', ' + args.citta : ''})\n`);
for (const a of accounts) {
  const { data: ev } = await sb.from('lead_evidence').select('id,tipo,payload,asset_path,captured_at,note').eq('account_id', a.id).order('captured_at');
  const last = {}; for (const e of ev) last[e.tipo] = e; // ultima per tipo
  const P = (t) => last[t]?.payload || {};
  const E = (t) => eid(last[t]?.id);
  console.log(`### ${a.nome} [${a.citta || a.paese || '?'}]  id=${a.id}`);
  console.log(`tipo=${a.tipo} fonte=${a.fonte_seed} prio=${a.priorita_tipologia ?? ''} contattato_prima=${a.contattato_prima ?? false}${a.owner_note ? ' | note: ' + short(a.owner_note, 180) : ''}`);
  console.log(`website=${a.website || '-'} ig=${a.ig_handle ? '@' + a.ig_handle : '-'} tel=${a.telefono || '-'} place=${a.google_place_id || '-'}`);
  if (last.maps) { const m = P('maps'); console.log(`[maps ${E('maps')}] rating=${m.rating ?? '-'} rec=${m.recensioni ?? '-'} cat=${m.categoria ?? '-'} ind=${short(m.indirizzo, 60)} chiuso=${m.chiuso_definitivamente ?? false}${m.errore ? ' ERR:' + short(m.errore, 60) : ''}`); }
  if (last.site_meta) { const s = P('site_meta'); console.log(`[site_meta ${E('site_meta')}] platform=${s.platform ?? '-'} ecomm=${s.ecommerce ?? '-'} emails=${short(j(s.emails), 120)} piva=${s.piva ?? '-'}${s.errore ? ' ERR:' + short(s.errore, 60) : ''}`); }
  if (last.brands_carried) { const b = P('brands_carried'); console.log(`[brands_carried ${E('brands_carried')}] PEER=${short(j(b.peer_match), 120) || '(nessuno)'} vendors=${short(j(b.vendors), 240)} pagina=${short(b.lista_pagina, 220)}`); }
  if (last.price_band) { const p = P('price_band'); console.log(`[price_band ${E('price_band')}] borse=${j(p.borse)} tutti=${j(p.tutti)}`); }
  if (last.site_products) { const sp = P('site_products'); const sample = (sp.prodotti || []).slice(0, 6).map((x) => `${short(x.titolo, 30)}:${x.prezzo ?? '?'}${x.borsa ? '(borsa)' : ''}`).join(' | '); console.log(`[site_products ${E('site_products')}] n=${sp.n} n_borse=${sp.n_borse} ${short(sample, 300)}`); }
  if (last.about_text) console.log(`[about ${E('about_text')}] ${short(P('about_text').testo, 400)}`);
  if (last.ig_metrics) { const g = P('ig_metrics'); console.log(`[ig_metrics ${E('ig_metrics')}] follower=${g.follower ?? '-'} post=${g.post ?? '-'} login_wall=${g.login_wall ?? '-'} bio=${short(g.bio, 160)}${g.errore ? ' ERR:' + short(g.errore, 50) : ''}`); }
  if (last.ig_posts) { const ip = P('ig_posts'); console.log(`[ig_posts ${E('ig_posts')}] n=${ip.n} cadenza=${j(ip.cadenza)}`); }
  if (last.maps_reviews) { const r = P('maps_reviews'); console.log(`[maps_reviews ${E('maps_reviews')}] n=${r.n} es="${short(r.recensioni?.[0]?.testo, 120)}"`); }
  if (last.stampa) { const st = P('stampa'); console.log(`[stampa ${E('stampa')}] n=${st.n} domini=${short((st.risultati || []).map((x) => x.dominio).join(', '), 200)}`); }
  if (last.contatti_trovati) console.log(`[contatti ${E('contatti_trovati')}] emails=${short(j(P('contatti_trovati').emails), 160)}`);
  const errs = ev.filter((e) => e.tipo === 'errore').map((e) => short(e.payload?.stage + ':' + e.payload?.msg, 80));
  if (errs.length) console.log(`[errori] ${errs.join(' ; ')}`);
  const imgs = Object.values(last).filter((e) => e.asset_path && /screenshot_ig|home_mobile|maps_photos|screenshot_home$/.test(e.tipo)).map((e) => e.tipo);
  console.log(`immagini disponibili: ${imgs.join(', ') || '(nessuna)'}\n`);
}
