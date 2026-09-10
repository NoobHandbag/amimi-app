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

// Brand affini (piano cap. 3.1). Match a PAROLA INTERA (regex), mai substring: 'gum' e 'marant' da soli
// pescavano dentro qualsiasi parola (gum -> argument, Isabel Marant e' luxury, non e' Pelletteria Marant).
export const PEER_BRANDS = ['lisa corti', 'le orsine', 'mystylebag', 'my style bag', 'my style bags', 'orciani', 'gianni chiarini', 'gum by gianni chiarini', 'gum design', 'la doublej', 'ladoublej', 'de siena', 'pelletteria marant', 'euterpe studio', 'borse valentina', 'gamberini'];
// I nomi in PEER_BRANDS sono solo lettere e spazi: nessun escape necessario.
export const peerMatches = (text) => { const t = (text || '').toLowerCase(); return PEER_BRANDS.filter((b) => new RegExp('(^|[^a-z0-9])' + b + '([^a-z0-9]|$)').test(t)); };
export const BAG_WORDS = /\b(bag|bags|borsa|borse|borsetta|pochette|clutch|tote|shopper|secchiello|tracolla|handbag|zaino|backpack|purse)\b/i;

// Catene e monomarca da scartare in fase di seed (mai target: fast fashion, monomarca, franchising).
// Match a PAROLA/FRASE contenuta nel nome normalizzato. Tenere qui la lista, non spargerla negli script.
export const CHAIN_DENYLIST = [
  // fast fashion / abbigliamento catena
  'zara', 'ovs', 'h&m', 'h & m', 'mango', 'stradivarius', 'bershka', 'pull&bear', 'pull & bear', 'benetton',
  'united colors', 'terranova', 'ter333', 'calliope', 'primark', 'uniqlo', 'kiabi', 'cisalfa', 'motivi',
  'cos', 'arket', 'other stories', 'weekday', 'massimo dutti', 'oysho', 'zara home',
  'oviesse', 'piazza italia', 'tally weijl', 'jysk', 'tezenis', 'intimissimi', 'calzedonia', 'yamamay',
  // monomarca borse / pelletteria (concorrenti o monomarca)
  'coccinelle', 'furla', 'carpisa', 'gabs', 'tuscany leather', 'the bridge', 'piquadro', 'braccialini',
  'louis vuitton', 'gucci', 'prada', 'fendi', 'bottega veneta', 'longchamp', 'michael kors', 'liu jo', 'liu.jo',
  'twinset', 'twin-set', 'pinko', 'guess', 'tods', "tod's", 'hogan', 'valextra',
  // monomarca abbigliamento donna a insegna singola (NON marchi che compaiono nei nomi dei multimarca:
  // niente 'max mara'/'iblues'/'kontatto' che sono spesso brand a scaffale di boutique vere)
  'elena miro', 'luisa spagnoli', 'marella', 'marina rinaldi', 'nau', 'original marines', 'sisley',
  // gioielli / cosmetica / ottica catena
  'pandora', 'swarovski', 'stroili', 'morellato', 'kiko', 'sephora', 'douglas', 'the body shop', 'lush', 'rituals',
  'grandvision', 'salmoiraghi', 'vistasi', 'optissimo',
  // scarpe / sport catena
  'geox', 'bata', 'scarpe&scarpe', 'scarpe & scarpe', 'nike store', 'adidas', 'foot locker', 'decathlon',
  'cisalfa sport', 'snipes', 'aw lab', 'footlocker', 'primadonna',
  // department / grande distribuzione / non-retail-moda
  'rinascente', 'coin', 'upim', 'ikea', 'unieuro', 'mediaworld', 'euronics', 'leroy merlin',
  'farmacia', 'pharmacy', 'supermercato', 'esselunga', 'carrefour', 'conad', 'lidl', 'eurospin',
  'tabaccheria', 'edicola', 'ottica', 'parafarmacia',
];
export const normName = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// match SOLO a parola/frase intera (bordo di parola via spazi), mai substring nuda: 'cos' non deve
// pescare 'Cose', 'zara' non deve pescare 'Zarabetti'. Le voci multi-parola diventano sequenze di token.
export const isChain = (name) => { const n = ` ${normName(name)} `; return CHAIN_DENYLIST.some((c) => n.includes(` ${normName(c)} `)); };
// hint di tipologia dalla query Maps
export const TYPE_BY_QUERY = { 'concept store': 'concept_store', 'boutique donna': 'boutique', 'boutique accessori': 'boutique', 'negozio borse artigianali': 'boutique', 'bijoux e accessori': 'boutique', 'negozio regali design': 'negozio_regalo' };
