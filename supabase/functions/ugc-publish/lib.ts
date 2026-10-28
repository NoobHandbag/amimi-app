// ugc-publish/lib.ts — logica PURA del giro (nessuna rete, nessun DB): cosa pubblicare, aggiornare o togliere su Shopify
// e quali schede prodotto ricevono custom.modello. La edge (index.ts) legge, chiama questi piani e scrive.
// Provata offline da tests/ugc_publish_core.mjs (Node 24 importa il .ts togliendo i tipi).

export const TYPE = 'recensione_cliente';
export const HANDLE_PREFIX = 'recensione-';
const HANDLE_RE = /^recensione-(\d+)$/;

export type UgcRow = {
  id: number; kind: string; status: string; codice: string; rating: number | null; testo: string | null;
  firma: string | null; consenso_testo: string | null; created_at: string;
};
export type Existing = { id: string; handle: string; status: string; fields: Record<string, string | null> };
export type ShopProduct = { id: string; handle: string; status: string; modello: string | null };
export type Field = { key: string; value: string };

// 'LEA BAG' -> 'Lea Bag', 'LEA BAG X RITA' -> 'Lea Bag X Rita' (la stessa regola usata a mano il 28-10 sulle schede)
export const titleCase = (s: string | null | undefined) =>
  String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s\-'/(])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase());

// giorno di Roma di un istante (created_at e' timestamptz in UTC)
export const dayRome = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

// Pubblicabile = recensione approvata con stelle, testo e consenso. Una sola regola, usata per pubblicare e per togliere.
export const isPublishable = (r: UgcRow) =>
  r.kind === 'recensione' && r.status === 'approvata' && r.rating != null && r.rating >= 1 && r.rating <= 5
  && String(r.testo ?? '').trim() !== '' && String(r.consenso_testo ?? '').trim() !== '';

export const handleOf = (id: number) => `${HANDLE_PREFIX}${id}`;

// Id della recensione per una voce Shopify che il giro puo' toccare: handle recensione-<n> E id_sorgente = <n>.
// Tutto il resto (voci create a mano con altri handle, senza id_sorgente o con un id diverso) e' null = mai toccato.
export const ownedId = (e: Existing): number | null => {
  const m = HANDLE_RE.exec(e.handle);
  if (!m) return null;
  const src = String(e.fields.id_sorgente ?? '').trim();
  return src !== '' && src === m[1] ? Number(m[1]) : null;
};

// I campi PUBBLICI della voce. Privacy (vincolo del brief): solo testo, stelle, firma scelta dalla cliente, modello,
// borsa, data, id. Mai cliente, email, ordine o foto: questa funzione non li riceve nemmeno.
export const desiredFields = (r: UgcRow, productGid: string | null, modello: string): Field[] => {
  const f: Field[] = [
    { key: 'testo', value: String(r.testo ?? '').trim() },
    { key: 'stelle', value: String(r.rating) },
    { key: 'data', value: dayRome(r.created_at) },
    { key: 'id_sorgente', value: String(r.id) },
  ];
  const firma = String(r.firma ?? '').trim();
  if (firma) f.push({ key: 'firma', value: firma });          // vuota = campo omesso, il tema mostra "Cliente verificata"
  if (modello) f.push({ key: 'modello', value: modello });
  if (productGid) f.push({ key: 'borsa', value: productGid });  // borsa non trovata = campo omesso, si pubblica lo stesso
  return f;
};

export type Ctx = {
  handleByCodice: Map<string, string>;          // shopify_catalog: codice -> handle
  productByHandle: Map<string, ShopProduct>;    // prodotti Shopify letti in questo giro
  modelloByHandle: Map<string, string>;         // custom.modello effettivo dopo il giro (vedi planModello)
  modelByCodice: Map<string, string>;           // products.model in title case, per le borse senza scheda
};
export type Upsert = { handle: string; ugcId: number; create: boolean; fields: Field[]; changed: string[] };
export type Delete = { id: string; handle: string; ugcId: number };

export function planReviews(rows: UgcRow[], existing: Existing[], ctx: Ctx) {
  const pubs = rows.filter(isPublishable);
  const pubIds = new Set(pubs.map((r) => r.id));
  const byHandle = new Map(existing.map((e) => [e.handle, e]));
  const upserts: Upsert[] = [];
  const blocked: string[] = [];
  let unchanged = 0;
  for (const r of pubs) {
    const h = ctx.handleByCodice.get(r.codice) ?? '';
    const p = h ? ctx.productByHandle.get(h) : undefined;
    // il modello della recensione = il custom.modello della scheda della borsa (cosi' la scheda la mostra sempre);
    // senza scheda, il modello del gestionale in title case
    const modello = (p && ctx.modelloByHandle.get(p.handle)) || ctx.modelByCodice.get(r.codice) || '';
    const fields = desiredFields(r, p?.id ?? null, modello);
    const e = byHandle.get(handleOf(r.id));
    if (e && ownedId(e) === null) { blocked.push(e.handle); continue; }    // handle giusto ma id_sorgente assente o diverso: mai toccata
    if (!e) { upserts.push({ handle: handleOf(r.id), ugcId: r.id, create: true, fields, changed: fields.map((x) => x.key) }); continue; }
    const changed = fields.filter((x) => (e.fields[x.key] ?? null) !== x.value).map((x) => x.key);
    if (changed.length) upserts.push({ handle: e.handle, ugcId: r.id, create: false, fields, changed });
    else unchanged++;
  }
  const deletes: Delete[] = [];
  let foreign = 0;
  for (const e of existing) {
    const id = ownedId(e);
    if (id === null) { foreign++; continue; }
    if (!pubIds.has(id)) deletes.push({ id: e.id, handle: e.handle, ugcId: id });
  }
  return { publishable: pubs.length, upserts, deletes, unchanged, foreign, blocked };
}

// custom.modello sulle schede: per ogni prodotto Shopify con handle nel catalogo (ACTIVE e DRAFT) e modello nel gestionale.
// Vuoto = si scrive. Gia' uguale = niente. DIVERSO = NON si sovrascrive e si segnala: il valore sulla scheda puo' essere
// una correzione fatta a mano dal team (il 28-10 tre refusi del gestionale corretti solo su Shopify), come la Bozza
// delle recensioni. modelloByHandle = il valore che la scheda avra' dopo il giro, usato anche per le recensioni.
export function planModello(products: ShopProduct[], modelByHandle: Map<string, string>) {
  const sets: Array<{ ownerId: string; handle: string; value: string }> = [];
  const divergent: Array<{ handle: string; shopify: string; gestionale: string }> = [];
  const modelloByHandle = new Map<string, string>();
  let same = 0;
  for (const p of products) {
    if (p.status === 'ARCHIVED') continue;
    const want = modelByHandle.get(p.handle);
    const cur = String(p.modello ?? '').trim();
    if (cur) modelloByHandle.set(p.handle, cur);
    if (!want) continue;
    if (!cur) { sets.push({ ownerId: p.id, handle: p.handle, value: want }); modelloByHandle.set(p.handle, want); }
    else if (cur === want) same++;
    else divergent.push({ handle: p.handle, shopify: cur, gestionale: want });
  }
  return { sets, divergent, same, modelloByHandle };
}

export const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

// scope richiesti: write_* implica read_* per Shopify
export const REQUIRED_SCOPES = ['write_metaobjects', 'write_products'];
export const missingScopes = (have: string[]) => REQUIRED_SCOPES.filter((s) => !have.includes(s));

// Freno sulle rimozioni: una lettura del gestionale che torna vuota o monca non deve svuotare il sito.
export const MAX_DELETE_RUN = 5;
export const deleteGuard = (publishable: number, existingOwned: number, deletes: number) => {
  if (deletes === 0) return null;
  if (publishable === 0 && existingOwned > 0) return 'nessuna recensione pubblicabile letta dal gestionale ma voci sul sito: rimozioni sospese';
  if (deletes > MAX_DELETE_RUN) return `${deletes} rimozioni in un giro (tetto ${MAX_DELETE_RUN}): sospese, controllare a mano`;
  return null;
};
