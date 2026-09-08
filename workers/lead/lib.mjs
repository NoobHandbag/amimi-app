// Libreria condivisa del collector lead_* (modulo ricerca negozi B2B).
// Chiave service_role: NON vive su disco. Viene letta a runtime dalla Management API di Supabase
// con SUPABASE_ACCESS_TOKEN (variabile utente Windows gia' usata dalla CLI), come fanno
// scripts/migrations-from-prod.mjs e schema-dump.mjs. Il collector scrive SOLO lead_* e il bucket lead-assets.
import { createClient } from '@supabase/supabase-js';

export const PROJECT_REF = 'imszbjeyplaiovylhkgl';
export const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
export const BUCKET = 'lead-assets';

export async function serviceKey() {
  const tok = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!tok) throw new Error('STOP: manca SUPABASE_ACCESS_TOKEN (variabile utente Windows, la stessa della CLI).');
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Management API ${r.status}: impossibile leggere le chiavi`);
  const keys = await r.json();
  const k = keys.find((x) => x.name === 'service_role')?.api_key;
  if (!k) throw new Error('service_role non trovata fra le api keys');
  return k;
}

export async function supa() {
  const key = await serviceKey();
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

export async function startRun(sb, fase, n_input, note) {
  const { data, error } = await sb.from('lead_runs').insert({ fase, n_input, note }).select('id').single();
  if (error) throw error;
  return data.id;
}
export async function endRun(sb, id, { n_ok, n_err, log }) {
  await sb.from('lead_runs').update({ ended_at: new Date().toISOString(), n_ok, n_err, log }).eq('id', id);
}

export async function evidence(sb, row) {
  const { error } = await sb.from('lead_evidence').insert(row);
  if (error) throw error;
}

export async function upload(sb, path, buffer, contentType = 'image/png') {
  const { error } = await sb.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) throw error;
  return path;
}

// numeri "9,427" / "9.427" / "1,2 mln" -> intero
export function num(s) {
  if (s == null) return null;
  const t = String(s).toLowerCase().replace(/\s/g, '');
  const m = t.match(/([\d.,]+)\s*(k|mila|mln|m)?/);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  if (/[.,]\d{3}$/.test(m[1])) v = parseFloat(m[1].replace(/[.,]/g, ''));
  if (m[2] === 'k' || m[2] === 'mila') v *= 1000;
  if (m[2] === 'mln' || m[2] === 'm') v *= 1e6;
  return Math.round(v);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const PEER_BRANDS = ['lisa corti', 'le orsine', 'mystylebag', 'my style bag', 'orciani', 'gianni chiarini', 'gum', 'la doublej', 'ladoublej', 'de siena', 'pelletteria marant', 'marant', 'euterpe', 'borse valentina', 'gamberini'];
export const BAG_WORDS = /\b(bag|bags|borsa|borse|borsetta|pochette|clutch|tote|shopper|secchiello|tracolla|handbag|zaino|backpack|purse)\b/i;
