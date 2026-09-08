// Carica le valutazioni (stadio D, rubrica v1) scritte dalla sessione Claude Code in un file JSON:
// [{ account_id, criteri:{brand:{punti,peso,prova,evidence_id},...}, bonus:{...}, esclusione, motivazione, perche_no, gancio, gancio_evidence_id, modello }]
// Calcola totale (pesato sui criteri con punti non null), tier proposto, dati_incompleti; scrive lead_scores,
// aggiorna gancio e stato_ricerca='scored'. Idempotente: ogni run aggiunge una riga di score (storico), l'ultima vince nella vista.
// Uso: node judge_write.mjs scores_pilota.json
import { readFileSync } from 'node:fs';
import { supa, startRun, endRun } from './lib.mjs';

const PESI = { brand: 25, stile: 20, posto: 20, vitalita: 15, raggiungibilita: 10, digitale: 10 };
const file = process.argv[2]; if (!file) { console.error('uso: node judge_write.mjs <scores.json>'); process.exit(1); }
const rows = JSON.parse(readFileSync(file, 'utf8'));
const sb = await supa();
const runId = await startRun(sb, 'judge', rows.length, `rubrica v1 da ${file}`);
let ok = 0, err = 0; const log = [];
for (const r of rows) {
  try {
    // gli id evidenza possono essere abbreviati (8 char): si risolvono al full id
    const { data: evs } = await sb.from('lead_evidence').select('id').eq('account_id', r.account_id);
    const full = (x) => (!x ? null : (evs ?? []).find((e) => e.id.startsWith(x))?.id ?? x);
    const criteri = {}; let sumP = 0, sumW = 0, nulls = 0;
    for (const [k, w] of Object.entries(PESI)) {
      const c = r.criteri?.[k] ?? {}; const p = c.punti == null ? null : Number(c.punti);
      criteri[k] = { punti: p, peso: w, prova: c.prova ?? null, evidence_id: full(c.evidence_id) };
      if (p == null) nulls++; else { sumP += (p / 10) * w; sumW += w; }
    }
    const bonusTot = Math.min(10, Object.values(r.bonus ?? {}).reduce((s, v) => s + Number(v || 0), 0));
    const base = sumW ? (sumP / sumW) * 100 : null;
    const totale = r.esclusione ? 0 : base == null ? null : Math.min(100, Math.round((base + bonusTot) * 10) / 10);
    const tier = r.esclusione || totale == null ? null : totale >= 75 ? 'A' : totale >= 55 ? 'B' : 'C';
    const row = { account_id: r.account_id, run_id: runId, rubrica_version: 'v1', criteri, bonus: r.bonus ?? null, esclusione: r.esclusione ?? null, totale, tier_proposto: tier, dati_incompleti: nulls >= 3, motivazione: r.motivazione ?? null, perche_no: r.perche_no ?? null, modello: r.modello ?? 'claude-fable-5-1 (sessione Claude Code)' };
    const { error } = await sb.from('lead_scores').insert(row); if (error) throw error;
    const upd = { stato_ricerca: r.esclusione ? 'rejected' : 'scored', updated_at: new Date().toISOString() };
    if (r.esclusione) upd.rejected_motivo = `esclusione secca: ${r.esclusione}`;
    if (r.gancio && totale != null && totale >= 55) { upd.gancio = r.gancio; upd.gancio_evidence_id = full(r.gancio_evidence_id); }
    // non sovrascrivere una decisione umana gia' presa (reviewed/rejected da persona)
    const { data: cur } = await sb.from('lead_accounts').select('stato_ricerca,tier').eq('id', r.account_id).single();
    if (cur?.stato_ricerca === 'reviewed' || (cur?.stato_ricerca === 'rejected' && !r.esclusione)) { delete upd.stato_ricerca; delete upd.rejected_motivo; }
    const { error: e2 } = await sb.from('lead_accounts').update(upd).eq('id', r.account_id); if (e2) throw e2;
    ok++; log.push({ account_id: r.account_id, totale, tier, esclusione: r.esclusione ?? null }); console.log('ok', r.nome ?? r.account_id, totale, tier ?? r.esclusione);
  } catch (e) { err++; log.push({ account_id: r.account_id, err: e.message }); console.log('ERR', r.nome ?? r.account_id, e.message); }
}
await endRun(sb, runId, { n_ok: ok, n_err: err, log });
console.log(`judge: ok ${ok}, err ${err}`);
