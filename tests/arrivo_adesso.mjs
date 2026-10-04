// tests/arrivo_adesso.mjs — nel pannello arrivi (Ordini) si scrive quanto e' arrivato ADESSO, non il totale (03-10).
//   node tests/arrivo_adesso.mjs   (Node 24 strippa i tipi TS all'import)
//
// Il campo chiedeva "Arrivati in totale" e mandava il numero cosi' com'era ad arrival_set: chi scriveva "10 arrivate
// oggi" su una riga con 20 gia' arrivate ne toglieva 10 dal magazzino (LEA BAG COCCO GREEN, 02-10), e su una riga con
// 10 gia' arrivate non caricava niente (COCCO BLACK, stesso giorno) con il toast "Arrivo salvato". Qui: la logica pura
// (pianoArrivo) e le cinture del pannello sul sorgente, perche' chi "semplifica" Ordini.tsx non riporti il totale.
// Dal 04-10 (write-api v27) anche il lato server: il blocco arrival_set e' ritagliato DAL SORGENTE che va in
// produzione ed eseguito contro un database finto in memoria, per provare `attesi` (il totale che il client aveva
// a schermo) e il compare-and-set dell'update. Nessuna rete.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pianoArrivo } from '../web/src/lib/helpers.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log(`  KO  ${name}  atteso ${e}, ottenuto ${g}`); }
};
const t = (name, c) => { if (c) { ok++; console.log('  ok  ' + name); } else { ko++; console.log('  KO  ' + name); } };

console.log("\n== modo 'adesso': il numero si SOMMA al gia' arrivato ==");
eq('COCCO GREEN 02-10: 20 gia arrivate, 10 adesso -> totale 30, +10', pianoArrivo('adesso', '10', 20), { ok: true, target: 30, delta: 10 });
eq('COCCO BLACK 02-10: 10 gia arrivate, 10 adesso -> totale 20, +10', pianoArrivo('adesso', '10', 10), { ok: true, target: 20, delta: 10 });
eq('primo arrivo: 0 gia arrivate, 8 adesso -> totale 8', pianoArrivo('adesso', '8', 0), { ok: true, target: 8, delta: 8 });
eq('spazi intorno al numero tollerati', pianoArrivo('adesso', ' 3 ', 5), { ok: true, target: 8, delta: 3 });
for (const [g, v] of [[0, '1'], [20, '10'], [7, '250']]) {
  const p = pianoArrivo('adesso', v, g);
  t(`in 'adesso' il delta e' sempre > 0 (gia ${g}, adesso ${v})`, p.ok && p.delta > 0 && p.target > g);
}

console.log("\n== modo 'adesso': input che non e' un arrivo -> rifiutato, mai un numero indovinato ==");
for (const v of ['', ' ', '0', '-3', '2.5', '2,5', 'abc', '1e2', '+4', '10000', '99999999999999999999']) {
  t(`'${v}' rifiutato`, pianoArrivo('adesso', v, 20).ok === false);
}

console.log("\n== modo 'totale' (correzione): il numero E' il totale, il delta puo' essere negativo o zero ==");
eq('correzione al ribasso: da 20 a 10 -> delta -10', pianoArrivo('totale', '10', 20), { ok: true, target: 10, delta: -10 });
eq('azzeramento prima di eliminare la riga: da 6 a 0', pianoArrivo('totale', '0', 6), { ok: true, target: 0, delta: -6 });
eq('totale invariato (solo costo o data): delta 0', pianoArrivo('totale', '10', 10), { ok: true, target: 10, delta: 0 });
eq('correzione al rialzo: da 3 a 5 -> delta +2', pianoArrivo('totale', '5', 3), { ok: true, target: 5, delta: 2 });
eq('9999 resta un numero accettato', pianoArrivo('adesso', '9999', 0), { ok: true, target: 9999, delta: 9999 });
for (const v of ['', '-1', '1.5', 'x', '10000']) t(`totale '${v}' rifiutato`, pianoArrivo('totale', v, 10).ok === false);

console.log('\n== cinture del pannello sul sorgente (web/src/pages/Ordini.tsx, web/src/lib/api.ts) ==');
{
  const ORD = read('web/src/pages/Ordini.tsx');
  const API = read('web/src/lib/api.ts');
  t("il campo non chiede piu' 'Arrivati in totale'", !/Arrivati in totale/.test(ORD));
  t("l'etichetta di default e' 'Arrivati adesso'", /'Arrivati adesso'/.test(ORD));
  t("una riga aperta parte in modo 'adesso'", /const modoBase: ModoArrivo = done \? 'totale' : 'adesso';/.test(ORD) && /useState<ModoArrivo>\(modoBase\)/.test(ORD));
  t('al server va il target calcolato da pianoArrivo, non il campo', /setArrival\(l\.id, target, /.test(ORD) && !/setArrival\(l\.id, Number\(n\)/.test(ORD));
  t('il totale a schermo va al server come `attesi`', /setArrival\(l\.id, target, gia, /.test(ORD));
  t('setArrival mette `attesi` nel payload di arrival_set', /writeApi\('arrival_set', \{ order_id: orderId, qty, attesi, data,/.test(API));
  t('una correzione al ribasso chiede conferma', /modo === 'totale' && delta < 0\s*\n\s*&& !window\.confirm\(/.test(ORD));
  t("un 'adesso' che supera l'ordinato chiede conferma", /modo === 'adesso' && ordinati != null && target > ordinati\s*\n\s*&& !window\.confirm\(/.test(ORD));
}

console.log('\n== write-api arrival_set: `attesi` e compare-and-set (blocco ritagliato dal sorgente, DB finto) ==');
{
  const SRC = read('supabase/functions/write-api/index.ts');
  const BEGIN = "  // --- FLOW 1b: SET the arrived total", END = '  // --- NEW (feedback 06-07 item 10): delete a supplier-order line ---';
  const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
  if (a < 0 || b < 0 || b < a) { console.error('blocco arrival_set non trovato in write-api/index.ts'); process.exit(1); }
  const TMP = `${ROOT}tests/_arrival_set.${process.pid}.tmp.ts`;
  writeFileSync(TMP, `import { num, isoDate, cnorm } from '../supabase/functions/write-api/lib.ts';
export async function run(ctx: any): Promise<any> {
  const { action, payload, sb, json, today, force, chi, closedDate, closedErr, arriviOggiAltrove, dupErr, retryOnce, logp } = ctx;
${SRC.slice(a, b)}
  return json({ fallthrough: true }, 599);
}
`, 'utf8');
  let run;
  try { ({ run } = await import(pathToFileURL(TMP).href)); }
  finally { try { unlinkSync(TMP); } catch { /* niente */ } }

  // Database finto: una riga ordine, gli acquisti, e un query builder con le sole catene che il blocco usa.
  // `dopoLettura` gira subito dopo la SELECT della riga: e' "l'altro telefono" che scrive nel mezzo.
  const mondo = ({ arrivati = 20, ordinati = 40, wip = false, dopoLettura = null, acquistoFallisce = false } = {}) => {
    const st = { ordine: { id: 'o1', codice: 'LEA_BAG_COCCO_GREEN', item: 'Lea Bag', variant: 'COCCO GREEN', fornitore: 'Francesco (pelle)', qty_ordered: ordinati, qty_arrived: arrivati, wip, costo_unitario: 20, data_ultimo_arrivo: '2026-09-21' }, acquisti: [], log: [], update: 0 };
    const exec = (q) => {
      const riga = st.ordine;
      const combacia = q.filtri.every(([c, v]) => (c === 'id' ? riga.id === v : Number(riga[c]) === Number(v)));
      if (q.tbl === 'supplier_orders' && q.op === 'select') {
        const out = { data: combacia ? { ...riga } : null, error: null };
        if (dopoLettura) dopoLettura(st);
        return out;
      }
      if (q.tbl === 'supplier_orders' && q.op === 'update') {
        if (combacia) { Object.assign(riga, q.body); st.update++; }
        return { data: q.ritorna ? (combacia ? [{ id: riga.id }] : []) : null, error: null };
      }
      if (q.tbl === 'purchases' && q.op === 'insert') {
        if (acquistoFallisce) return { data: null, error: { message: 'insert rifiutato' } };
        st.acquisti.push(q.body);
        return { data: { id: 'p' + st.acquisti.length }, error: null };
      }
      throw new Error(`query non prevista dal DB finto: ${q.tbl}.${q.op}`);
    };
    const sb = { from: (tbl) => {
      const q = { tbl, op: 'select', filtri: [], body: null, ritorna: false };
      const k = {
        select() { if (q.op !== 'select') q.ritorna = true; return k; },
        update(body) { q.op = 'update'; q.body = body; return k; },
        insert(body) { q.op = 'insert'; q.body = body; return k; },
        eq(c, v) { q.filtri.push([c, v]); return k; },
        single() { return k; }, maybeSingle() { return k; },
        then(res, rej) { return Promise.resolve().then(() => exec(q)).then(res, rej); },
      };
      return k;
    } };
    const ctx = (payload, extra = {}) => ({
      action: 'arrival_set', payload: { order_id: 'o1', data: '2026-10-04', ...payload }, sb, today: '2026-10-04', force: false, chi: 'Test',
      json: (body, status = 200) => ({ status, body }),
      closedDate: async () => false, closedErr: () => ({ status: 409, body: { closed_month: true } }),
      arriviOggiAltrove: async () => [], dupErr: () => ({ status: 409, body: { duplicato_possibile: true } }),
      retryOnce: async (fn) => await fn(), logp: async (...args) => { st.log.push(args); }, ...extra,
    });
    return { st, ctx };
  };
  const scritto = (st) => ({ arrivati: st.ordine.qty_arrived, update: st.update, acquisti: st.acquisti.map((p) => p.quantita), log: st.log.length });

  { // il caso normale del pannello: 20 a schermo, 20 a DB, 10 adesso -> totale 30
    const { st, ctx } = mondo();
    const r = await run(ctx({ qty: 30, attesi: 20 }));
    eq('attesi = totale a DB: salva, +10 a magazzino', [r.status, r.body.ok, scritto(st)], [200, true, { arrivati: 30, update: 1, acquisti: [10], log: 1 }]);
    t('change_log porta `attesi`', st.log[0]?.[3]?.attesi === 20 && st.log[0]?.[3]?.delta === 10);
  }
  { // schermata vecchia: il client vedeva 10 e manda 10 + 10 = 20, a DB sono gia' 20
    const { st, ctx } = mondo();
    const r = await run(ctx({ qty: 20, attesi: 10 }));
    eq('attesi diverso dal DB: 409 riga_cambiata con il totale vero, zero scritture', [r.status, r.body.riga_cambiata, r.body.arrived, scritto(st)], [409, true, 20, { arrivati: 20, update: 0, acquisti: [], log: 0 }]);
  }
  { // due telefoni nello stesso secondo: letta a 20, l'altro salva 30 prima dell'update di questo
    const { st, ctx } = mondo({ dopoLettura: (s) => { s.ordine.qty_arrived = 30; } });
    const r = await run(ctx({ qty: 30, attesi: 20 }));
    eq("un'altra scrittura fra lettura e update: 409, la riga resta com'e', nessun acquisto", [r.status, r.body.riga_cambiata, scritto(st)], [409, true, { arrivati: 30, update: 0, acquisti: [], log: 0 }]);
  }
  { // chi non manda attesi (PWA non ancora aggiornata, Cowork) passa come nella v26
    const { st, ctx } = mondo();
    const r = await run(ctx({ qty: 30 }));
    eq('senza attesi: comportamento v26 (salva, +10)', [r.status, scritto(st)], [200, { arrivati: 30, update: 1, acquisti: [10], log: 1 }]);
    t('senza attesi il change_log non porta la chiave', !('attesi' in (st.log[0]?.[3] ?? {})));
  }
  for (const v of [null, '']) {
    const { st, ctx } = mondo();
    const r = await run(ctx({ qty: 30, attesi: v }));
    eq(`attesi ${JSON.stringify(v)} = assente`, [r.status, scritto(st).acquisti], [200, [10]]);
  }
  for (const v of ['abc', -1, 1.5, '2,5', [], {}, true]) {
    const { st, ctx } = mondo();
    const r = await run(ctx({ qty: 30, attesi: v }));
    eq(`attesi ${JSON.stringify(v)} non valido: 422, zero scritture`, [r.status, scritto(st)], [422, { arrivati: 20, update: 0, acquisti: [], log: 0 }]);
  }
  { // correzione al ribasso dal modo "Correggi il totale"
    const { st, ctx } = mondo();
    const r = await run(ctx({ qty: 10, attesi: 20 }));
    eq('correzione con attesi giusto: da 20 a 10, acquisto -10', [r.status, scritto(st)], [200, { arrivati: 10, update: 1, acquisti: [-10], log: 1 }]);
  }
  { // solo costo: totale invariato
    const { st, ctx } = mondo();
    const r = await run(ctx({ qty: 20, attesi: 20, costo_unitario: 22 }));
    eq('totale invariato con attesi giusto: nessun acquisto, costo aggiornato', [r.status, scritto(st).acquisti, st.ordine.costo_unitario], [200, [], 22]);
  }
  { // l'acquisto non entra: la riga torna com'era (fix f del 31-07, da non rompere)
    const { st, ctx } = mondo({ acquistoFallisce: true });
    const r = await run(ctx({ qty: 30, attesi: 20 }));
    eq("acquisto fallito: 400 e riga riportata a 20", [r.status, st.ordine.qty_arrived, st.ordine.data_ultimo_arrivo, st.log.length], [400, 20, '2026-09-21', 0]);
  }
  { // la riga cambiata si dice PRIMA delle altre guardie: su un numero superato non ha senso chiedere conferme
    const { st, ctx } = mondo();
    const r = await run(ctx({ qty: 20, attesi: 10 }, { closedDate: async () => true, arriviOggiAltrove: async () => [{ pezzi: 10 }] }));
    eq('riga_cambiata vince su mese chiuso e doppio arrivo', [r.status, r.body.riga_cambiata === true, r.body.closed_month ?? null, scritto(st).update], [409, true, null, 0]);
  }
  { // riga WIP: il primo arrivo la risolve, anche con attesi
    const { st, ctx } = mondo({ arrivati: 0, ordinati: null, wip: true });
    const r = await run(ctx({ qty: 8, attesi: 0 }));
    eq('WIP con attesi 0: ordinato = 8, wip risolta, +8', [r.status, st.ordine.qty_ordered, st.ordine.wip, scritto(st).acquisti], [200, 8, false, [8]]);
  }
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exitCode = ko ? 1 : 0;   // non process.exit(): su Windows (Node 24) ogni tanto chiude con "Assertion failed ... UV_HANDLE_CLOSING"
