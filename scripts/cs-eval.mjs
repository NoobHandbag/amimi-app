// cs-eval — harness di valutazione bozze CS (brief 2026-07-29).
// Per ogni conversation_id chiama cs-assist: context -> case_data (solo Reso/Cambio/Indirizzo) -> draft,
// e scrive un .json completo + un .md anonimizzato leggibile da chi non e' tecnico.
//
// USO:
//   CS_EVAL_TOKEN=<access token utente @amimi.it> node scripts/cs-eval.mjs --ids id1,id2,...
//   CS_EVAL_TOKEN=... node scripts/cs-eval.mjs --file ids.txt [--model gemini-flash-latest] \
//       [--out "../Cowork12/projects/Servizio_Clienti_2026-06"] [--pause 2000] [--label baseline_gemini]
//
// AUTH (non negoziabile, audit 24-07): SOLO access token utente Supabase di un utente @amimi.it,
// ottenuto al momento dall'owner (validita' ~1h) e passato via variabile d'ambiente CS_EVAL_TOKEN.
// Lo script NON accetta PIN, NON usa percorsi anonimi, NON scrive mai il token su file.
// Come lo ottiene l'owner (dalla sessione loggata dell'app, console del browser):
//   (await window.__sb?.auth.getSession())?.data.session.access_token   // o equivalente
// oppure password-grant manuale via curl (mai dentro questo script).
//
// Igiene dati: ogni draft e' chiamato con source:'eval' -> cs_drafts.source='eval' (migr 0080).
// Query per isolare/contare le righe di eval:  select * from cs_drafts where source = 'eval';
//
// Rate limit: chiamate SEQUENZIALI con pausa (default 1500ms). Su HTTP 429 lo script SI FERMA
// e riporta quante conversazioni ha completato: mai proseguire falsando il set.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FN = 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/';
const REST = 'https://imszbjeyplaiovylhkgl.supabase.co/rest/v1';
const ANON = 'sb_publishable_DP66FFObEGagJknhGOz8xw_8KO8WIgD';
const CASE_CATS = new Set(['Reso e rimborso', 'Cambio e prodotto errato', 'Modifica / correzione indirizzo']);

// --- args ---
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
}
const token = (process.env.CS_EVAL_TOKEN || '').trim();
if (!token) {
  console.error('ERRORE: manca CS_EVAL_TOKEN (access token utente @amimi.it). Nessuna chiamata eseguita.');
  console.error('Uso: CS_EVAL_TOKEN=... node scripts/cs-eval.mjs --ids id1,id2 | --file ids.txt [--model m] [--out dir] [--pause ms] [--label nome]');
  process.exit(1);
}
let ids = [];
if (args.ids) ids = String(args.ids).split(',').map((s) => s.trim()).filter(Boolean);
else if (args.file) ids = readFileSync(String(args.file), 'utf-8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
if (!ids.length) { console.error('ERRORE: nessun conversation_id (--ids o --file).'); process.exit(1); }
const CAP = 25;   // cap prudenziale: un run di benchmark sta in 15-20
if (ids.length > CAP) { console.error(`ERRORE: ${ids.length} id superano il cap di ${CAP}.`); process.exit(1); }
const model = args.model ? String(args.model) : null;
const pause = Number(args.pause) || 1500;
const outDir = String(args.out || defaultOut());
const label = String(args.label || (model ? model.replace(/[^a-z0-9]+/gi, '_') : 'default'));
const today = new Date().toISOString().slice(0, 10);

function defaultOut() {
  const guess = join(process.cwd(), '..', 'Cowork12', 'projects', 'Servizio_Clienti_2026-06');
  return existsSync(guess) ? guess : process.cwd();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function edge(action, body) {
  const t0 = Date.now();
  const r = await fetch(FN + 'cs-assist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, authorization: 'Bearer ' + token },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ms: Date.now() - t0, ...((r.status === 429) ? { rate_limited: true } : {}), data: j };
}
async function rest(q) {
  const r = await fetch(REST + q, { headers: { apikey: ANON, authorization: 'Bearer ' + ANON } });
  return r.json();
}

// --- anonimizzazione per il .md (il .json di lavoro tiene i dati pieni e NON va committato) ---
const anonName = (n) => {
  const p = String(n || '').trim().split(/\s+/);
  if (!p[0]) return 'cliente';
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0];
};
const anonEmail = (e) => {
  const s = String(e || '');
  const at = s.indexOf('@');
  return at > 0 ? s[0] + '***' + s.slice(at) : s;
};
const anonText = (t, name, email) => {
  let out = String(t || '');
  if (email) out = out.split(email).join(anonEmail(email));
  if (name && String(name).trim().split(/\s+/).length > 1) out = out.split(String(name).trim()).join(anonName(name));
  return out;
};

// --- run ---
const results = [];
let stopped = null;
console.log(`cs-eval: ${ids.length} conversazioni, modello ${model ?? 'default del server'}, out: ${outDir}`);

for (const [i, id] of ids.entries()) {
  const rec = { conversation_id: id, model_richiesto: model, errori: [] };
  // meta dalla tabella (categoria/lingua/urgenza non sono nella risposta di context)
  const conv = (await rest(`/cs_conversations?id=eq.${id}&select=id,canale,categoria,categoria_source,urgente,urgenza_motivo,lingua,customer_name,customer_email,subject`))[0];
  if (!conv) { rec.errori.push('conversazione inesistente'); results.push(rec); continue; }
  Object.assign(rec, {
    canale: conv.canale, categoria: conv.categoria, categoria_source: conv.categoria_source,
    urgente: conv.urgente, urgenza_motivo: conv.urgenza_motivo, lingua: conv.lingua,
    customer_name: conv.customer_name, customer_email: conv.customer_email, subject: conv.subject,
  });

  const ctx = await edge('context', { conversation_id: id });
  rec.context_ms = ctx.ms;
  if (ctx.rate_limited) { stopped = `429 su context di ${id}`; break; }
  if (ctx.status !== 200) rec.errori.push(`context ${ctx.status}: ${JSON.stringify(ctx.data).slice(0, 200)}`);
  else { rec.gaps = ctx.data.gaps ?? []; rec.fonti = ctx.data.fonti ?? []; rec.dati = ctx.data.dati ?? null; rec.storia = ctx.data.storia ?? null; }

  if (CASE_CATS.has(String(conv.categoria ?? ''))) {
    const cd = await edge('case_data', { conversation_id: id });
    rec.case_ms = cd.ms;
    if (cd.rate_limited) { stopped = `429 su case_data di ${id}`; break; }
    if (cd.status !== 200) rec.errori.push(`case_data ${cd.status}`);
    else rec.caso = { verificato: cd.data.verificato, reso: cd.data.reso, indirizzo: cd.data.indirizzo };
  }

  const dr = await edge('draft', { conversation_id: id, source: 'eval', ...(model ? { model_override: model } : {}) });
  rec.draft_ms = dr.ms;
  if (dr.rate_limited) { stopped = `429 su draft di ${id}`; break; }
  if (dr.status !== 200 || !dr.data.ok) rec.errori.push(`draft ${dr.status}: ${JSON.stringify(dr.data).slice(0, 250)}`);
  else {
    rec.options = dr.data.options ?? [];
    rec.draft_id = dr.data.draft_id ?? null;
    if (rec.draft_id) {
      const drow = (await rest(`/cs_drafts?id=eq.${rec.draft_id}&select=model,source`))[0];
      rec.model_registrato = drow?.model ?? null;
      rec.draft_source = drow?.source ?? null;
    }
  }
  results.push(rec);
  console.log(`[${i + 1}/${ids.length}] ${id.slice(0, 8)} ${conv.categoria ?? '?'} -> ${rec.errori.length ? 'ERR ' + rec.errori[0] : 'ok (' + (rec.options?.length ?? 0) + ' bozze, ' + rec.draft_ms + 'ms)'}`);
  if (i < ids.length - 1) await sleep(pause);
}

// --- output ---
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const base = `EVAL_bozze_${label}_${today}`;
const jsonPath = join(outDir, base + '.json');
writeFileSync(jsonPath, JSON.stringify({ run: { data: today, modello: model ?? 'default', n_richieste: ids.length, n_completate: results.length, interrotto: stopped }, conversazioni: results }, null, 2), 'utf-8');

const md = [];
md.push(`# Eval bozze CS - ${label} - ${today}`);
md.push('');
md.push(`Modello: ${model ?? 'default del server'} · Conversazioni completate: ${results.length}/${ids.length}${stopped ? ` · INTERROTTO: ${stopped}` : ''}`);
md.push('');
for (const r of results) {
  const nome = anonName(r.customer_name);
  md.push(`## ${nome} (${anonEmail(r.customer_email)}) - ${r.categoria ?? 'senza categoria'}`);
  md.push('');
  md.push(`- conversation_id: \`${r.conversation_id}\` · canale: ${r.canale ?? '?'} · lingua: ${r.lingua ?? 'it'} · categoria_source: ${r.categoria_source ?? 'n/d'}`);
  md.push(`- urgente: ${r.urgente ? 'SI (' + (r.urgenza_motivo ?? '?') + ')' : 'no'} · modello registrato: ${r.model_registrato ?? 'n/d'} · source bozza: ${r.draft_source ?? 'n/d'}`);
  md.push(`- tempi: context ${r.context_ms ?? '-'}ms${r.case_ms ? ` · caso ${r.case_ms}ms` : ''} · draft ${r.draft_ms ?? '-'}ms`);
  if (r.gaps?.length) md.push(`- GAP segnalati: ${r.gaps.join(' · ')}`);
  if (r.fonti?.length) md.push(`- fonti: ${r.fonti.map((f) => anonText(f, r.customer_name, r.customer_email)).join(' · ')}`);
  if (r.caso) md.push(`- caso: ${JSON.stringify(r.caso.reso?.verdetto ?? r.caso.indirizzo?.caso ?? 'n/d')} (verificato: ${r.caso.verificato})`);
  if (r.errori?.length) md.push(`- ERRORI: ${r.errori.join(' | ')}`);
  md.push('');
  for (const o of r.options ?? []) {
    md.push(`### Bozza "${o.tono}"${o.da_verificare ? ` · [DA VERIFICARE] x${o.da_verificare}` : ''}${o.non_grounded?.length ? ` · non grounded: ${o.non_grounded.join(', ')}` : ''}`);
    md.push('');
    md.push('> ' + anonText(o.testo, r.customer_name, r.customer_email).split('\n').join('\n> '));
    md.push('');
  }
}
const mdPath = join(outDir, base + '.md');
writeFileSync(mdPath, md.join('\n'), 'utf-8');

console.log(`\nScritti:\n  ${jsonPath}  (COMPLETO, non committare nel repo)\n  ${mdPath}  (anonimizzato, condivisibile)`);
if (stopped) { console.error(`\nRUN INTERROTTO: ${stopped}. Completate ${results.length}/${ids.length}.`); process.exit(2); }
