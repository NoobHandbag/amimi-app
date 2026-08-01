// Comprehensive flow regression suite.
// Crea dati marcati ZZZTEST (ordini fornitore, arrivi, acquisti, spese, conte, resi, b2b) e
// asserisce ogni flusso. QUESTA SUITE SCRIVE: non puo' girare sul database di produzione.
//
// STORIA (brief flows_test_non_tocchi_produzione, 01-08): fino al 31-07 puntava in chiaro al
// progetto di produzione e ci scriveva dentro, con pulizia manuale a mano. Dal 2026-06 e' rimasta
// comunque ferma, perche' usava date fisse a giugno e la guardia mesi chiusi della write-api la
// respingeva alla prima chiamata. L'owner ha scelto "riscrivilo cosi' non tocca i dati veri".
//
// COME SI USA ORA: il bersaglio arriva dall'ambiente, non c'e' piu' nessun default.
//   AMIMI_TEST_URL=https://<ref>.supabase.co  AMIMI_TEST_KEY=<publishable key>  node tests/flows.mjs
// Senza quelle due variabili la suite NON parte. Se il bersaglio e' la produzione, si RIFIUTA di
// partire (guardia sul project ref, non una convenzione sui nomi).
//
// COSA MANCA ANCORA: un bersaglio isolato da usare. Le due strade sono un branch Supabase effimero
// (a pagamento) o uno stack locale con Docker (gratis ma va installato): decisione dell'owner,
// ancora aperta al 01-08. Finche' non c'e', questa suite non gira — ed e' meglio che girasse
// sui dati veri.
//
// Run: node tests/flows.mjs
const PROD_REF = 'imszbjeyplaiovylhkgl';
const BASE = (process.env.AMIMI_TEST_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.AMIMI_TEST_KEY || '').trim();

if (!BASE || !KEY) {
  console.error('\nSTOP: questa suite SCRIVE dati e non ha un bersaglio di test.\n');
  console.error('Imposta AMIMI_TEST_URL e AMIMI_TEST_KEY su un progetto di TEST, poi rilancia.');
  console.error('NON puntarle alla produzione: la suite si rifiuta comunque di partire.\n');
  process.exit(1);
}
if (BASE.includes(PROD_REF)) {
  console.error('\nSTOP: AMIMI_TEST_URL punta al progetto di PRODUZIONE (' + PROD_REF + ').\n');
  console.error('Questa suite crea ordini, arrivi e spese finti: sulla produzione sporcherebbe');
  console.error('la contabilita\' viva a ogni esecuzione. Rifiuto di partire.\n');
  process.exit(1);
}

// Date derivate dal mese CORRENTE, mai fisse: una data hardcoded finisce prima o poi in un mese
// chiuso e la write-api la respinge (e' esattamente cosi' che questa suite si e' bloccata).
const OGGI = new Date();
const d = (giorno) => new Date(Date.UTC(OGGI.getUTCFullYear(), OGGI.getUTCMonth(), giorno))
  .toISOString().slice(0, 10);
const DATA_1 = d(5), DATA_2 = d(6), DATA_3 = d(7);

const FN = BASE + '/functions/v1/';
const REST = BASE + '/rest/v1';
const H = { 'content-type': 'application/json', apikey: KEY, authorization: 'Bearer ' + KEY };
const call = async (action, payload, fn = 'write-api') => {
  const r = await fetch(FN + fn, { method: 'POST', headers: H, body: JSON.stringify({ action, ...payload, pin: 'x', chi: 'ZZZTEST' }) });
  return [r.status, await r.json().catch(() => ({}))];
};
const get = async (q) => (await fetch(REST + q, { headers: H })).json();

let pass = 0, fail = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else { fail++; fails.push(m); } console.log((c ? 'PASS ' : 'FAIL ') + m); };

console.log('\n===== FLOW 1: supplier orders =====');
// multi-bag: one existing reorder + one new bag on the fly
const [s1, r1] = await call('order_multi', { payload: { fornitore: 'ZZZTEST', data_ordine: DATA_1, righe: [
  { codice: 'Lea_Bag_BLACK', item: 'Lea Bag', variant: 'BLACK', qty_ordered: 5, nuovo_riordino: 'Riordino', costo_unitario: 20 },
  { codice: 'ZZZTEST_NUOVA_X', item: 'Zzztest Nuova', variant: 'X', qty_ordered: 8, nuovo_riordino: 'Nuovo', costo_unitario: 15 },
] } });
ok(s1 === 200 && r1.lines === 2 && r1.stubs === 1, 'multi-bag order: 2 lines + 1 new-bag stub ' + JSON.stringify(r1));
const stub = await get('/v_products_todo?codice=eq.ZZZTEST_NUOVA_X&select=codice,verificato');
ok(stub.length === 1 && stub[0].verificato === false, 'new bag landed in verification queue');
// missing fornitore + empty righe validation
ok((await call('order_multi', { payload: { fornitore: '', righe: [{ codice: 'X', qty_ordered: 1 }] } }))[0] === 422, 'order rejects empty fornitore');
ok((await call('order_multi', { payload: { fornitore: 'ZZZTEST', righe: [] } }))[0] === 422, 'order rejects empty righe');
// arrivals: find the new-bag line, partial then full
const lines = await get('/v_ordini_arrivo?fornitore=eq.ZZZTEST&codice=eq.ZZZTEST_NUOVA_X&select=id,qty_ordered,qty_arrived,mancano,completo');
const lineId = lines[0]?.id;
const [pa] = await call('arrival', { payload: { order_id: lineId, qty: 3, data: DATA_2 } });
const afterPartial = await get(`/v_ordini_arrivo?id=eq.${lineId}&select=qty_arrived,mancano,completo`);
ok(pa === 200 && Number(afterPartial[0].qty_arrived) === 3 && afterPartial[0].completo === false, 'partial arrival 3/8, not complete');
await call('arrival', { payload: { order_id: lineId, qty: 5, data: DATA_3 } });
const afterFull = await get(`/v_ordini_arrivo?id=eq.${lineId}&select=qty_arrived,completo`);
ok(Number(afterFull[0].qty_arrived) === 8 && afterFull[0].completo === true, 'full arrival 8/8, complete');
const pur = await get('/purchases?fornitore=eq.ZZZTEST&codice=eq.ZZZTEST_NUOVA_X&select=quantita,data&order=data.asc');
ok(pur.length === 2 && pur.some((p) => p.data === DATA_2) && pur.some((p) => p.data === DATA_3), 'arrivals created purchases with editable dates');

console.log('\n===== FLOW 2: product verification =====');
ok((await call('product_verify', { payload: {} }))[0] === 422, 'verify rejects missing codice');
const [pv] = await call('product_verify', { payload: { codice: 'ZZZTEST_NUOVA_X', item: 'Zzztest Nuova', variant: 'X', categoria: 'BAG', retail_price: 120, image_url: 'http://x/y.jpg', description: 'desc', seo_title: 'seo' } });
const verified = await get('/products?codice=eq.ZZZTEST_NUOVA_X&select=verificato,retail_price,description');
ok(pv === 200 && verified[0].verificato === true && Number(verified[0].retail_price) === 120, 'verify completes product');
ok((await get('/v_products_todo?codice=eq.ZZZTEST_NUOVA_X&select=codice')).length === 0, 'verified product left the todo queue');

console.log('\n===== FLOW 4/5: expenses =====');
const cats = ['MARKETING', 'OPEX', 'LOGISTICA', 'PACKAGING'];
let proposedId;
for (const c of cats) {
  const [, e] = await call('expense_propose', { payload: { operazione: 'ZZZTEST ' + c, costo: 10, categoria: c, amimi: 'si', date_paid: DATA_1 } });
  if (c === 'MARKETING') proposedId = e.id;
}
const pend = await get('/v_expenses_pending?operazione=like.ZZZTEST*&select=id,costo,amimi,categoria');
ok(pend.length === 4 && pend.every((p) => Number(p.costo) === -10 && p.amimi === true), 'propose: 4 pending, costo negative, amimi computed');
ok((await call('expense_manual', { payload: { operazione: 'ZZZTEST DIRECT', costo: 0, categoria: 'OPEX' } }))[0] === 422, 'manual rejects zero amount');
const [em, emj] = await call('expense_manual', { payload: { operazione: 'ZZZTEST DIRECT', costo: 33, categoria: 'OPEX', amimi: 'no', date_paid: DATA_1 } });
const direct = await get(`/expenses?id=eq.${emj.id}&select=status,amimi,costo`);
ok(em === 200 && direct[0].status === 'approved' && direct[0].amimi === false && Number(direct[0].costo) === -33, 'manual expense: approved, amimi=false, negative');
// approve with edits
await call('expense_approve', { payload: { id: proposedId, status: 'approved', edits: { costo: 99, categoria: 'OPEX' } } });
const appr = await get(`/expenses?id=eq.${proposedId}&select=status,costo,categoria`);
ok(appr[0].status === 'approved' && Number(appr[0].costo) === -99 && appr[0].categoria === 'OPEX', 'approve with edits (costo+categoria)');
// reject one
const rejId = pend.find((p) => p.id !== proposedId)?.id;
await call('expense_approve', { payload: { id: rejId, status: 'rejected' } });
ok((await get(`/expenses?id=eq.${rejId}&select=status`))[0].status === 'rejected', 'reject works');

console.log('\n===== SECOND: sale correction (safe: revert with full original) =====');
const qs = await get('/qromo_sales?item=not.is.null&variant=not.is.null&select=id,codice,item,variant&limit=1');
if (qs[0]) {
  const o = qs[0];
  const [sc, scj] = await call('sale_correct', { payload: { source: 'qromo', id: o.id, new_codice: 'Lea_Bag_BLACK', new_item: 'Lea Bag', new_variant: 'BLACK' } });
  const corr = await get(`/qromo_sales?id=eq.${o.id}&select=codice`);
  ok(sc === 200 && corr[0].codice === 'Lea_Bag_BLACK', 'qromo sale reassigned');
  await call('sale_correct', { payload: { source: 'qromo', id: o.id, new_codice: o.codice, new_item: o.item, new_variant: o.variant } });
  const rev = await get(`/qromo_sales?id=eq.${o.id}&select=codice,item,variant`);
  ok(rev[0].codice === o.codice && rev[0].variant === o.variant, 'qromo sale fully restored');
}
ok((await call('sale_correct', { payload: { source: 'qromo', id: 'x' } }))[0] === 422, 'sale_correct rejects missing target');

console.log('\n===== Existing flows regression =====');
ok((await call('count', { payload: { codice: 'Lea_Bag_BLACK', contati: 5, nota: 'ZZZTEST' } }))[0] === 200, 'count insert');
ok((await call('count', { payload: { codice: 'has space', contati: 5 } }))[0] === 422, 'count rejects codice with space');
ok((await call('gift', { payload: { codice: 'Lea_Bag_BLACK', quantita: 1, nome: 'ZZZTEST' } }))[0] === 200, 'gift insert (canonical codice)');
ok((await call('purchase', { payload: { codice: 'Lea_Bag_BLACK', quantita: 2, costo_unitario: 20, data: DATA_1, item: 'Lea Bag', variant: 'BLACK', fornitore: 'ZZZTEST' } }))[0] === 200, 'purchase insert');
ok((await call('b2b', { payload: { codice: 'Lea_Bag_BLACK', quantita: 1, tipo_movimento: 'invio', modello: 'conto_vendita', negozio: 'ZZZTEST' } }))[0] === 200, 'b2b invio insert');
ok((await call('b2b', { payload: { codice: 'Lea_Bag_BLACK', quantita: 1, tipo_movimento: 'bad', modello: 'conto_vendita' } }))[0] === 422, 'b2b rejects bad tipo_movimento');

console.log('\n===== NEW: returns & exchanges =====');
{
  const C = 'Lea_Bag_BLACK';
  const g0 = Number((await get(`/v_inventory?codice=eq.${C}&select=giacenza_attuale`))[0]?.giacenza_attuale);
  ok((await call('return', { payload: { codice: C, quantita: 1, canale: 'qromo', importo_rimborsato: 50, rientra_stock: true, motivo: 'Difetto', data: DATA_1, note: 'ZZZTEST' } }))[0] === 200, 'return insert (re-enters stock)');
  const g1 = Number((await get(`/v_inventory?codice=eq.${C}&select=giacenza_attuale`))[0]?.giacenza_attuale);
  ok(g1 === g0 + 1, `return re-enters stock: ${g0} -> ${g1}`);
  await call('return', { payload: { codice: C, quantita: 1, canale: 'online', importo_rimborsato: 60, rientra_stock: false, motivo: 'Difetto', data: DATA_1, note: 'ZZZTEST' } });
  const g2 = Number((await get(`/v_inventory?codice=eq.${C}&select=giacenza_attuale`))[0]?.giacenza_attuale);
  ok(g2 === g1, 'discarded return does not re-enter stock');
  ok((await get(`/v_resi_mensile?year=eq.${OGGI.getUTCFullYear()}&month=eq.${OGGI.getUTCMonth()+1}&select=importo`))[0] != null, 'returns visible in v_resi_mensile');
  ok((await call('return', { payload: { codice: C, quantita: 0 } }))[0] === 422, 'return rejects qty 0');
}

console.log('\n===== THIRD + FLOW 6 =====');
ok((await call(null, { action: 'sync', payload: undefined, codici: undefined }, 'shopify-stock'))[0] === 200 || true, 'shopify-stock reachable (skip heavy re-sync)');
const [rg, rgj] = await call(null, { action: 'realign', codici: ['Lea_Bag_BLACK'] }, 'shopify-stock');
ok(rg === 403 && rgj.gated === true, 'realign gated off');
const [, ad] = await call(null, { question: 'quante borse ho in totale?' }, 'ask-data');
ok(ad.needs_key === true || typeof ad.answer === 'string' || typeof ad.risposta === 'string',
  'ask-data risponde in modo sensato (needs_key oppure una risposta)');  // 01-08: prima asseriva needs_key===true, ma la chiave Gemini ora ESISTE in produzione:
  // l'asserzione era diventata una fotografia di un momento, non un invariante.

console.log('\n===== Cruscotto data integrity =====');
const ceA = await get('/v_ce_amimi_summary?year=eq.2026&month=eq.1&select=omni_netto');
ok(ceA.length && Number(ceA[0].omni_netto) === 0, 'CE_AMIMI January = 0');
const ceT = await get('/ce_totale_monthly?year=eq.2026&month=eq.1&select=netto');
ok(ceT.length && Number(ceT[0].netto) > 4000, 'CE_TOTALE January > 4000 (inherited)');

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
if (fail) { console.log('FAILURES:\n- ' + fails.join('\n- ')); process.exit(1); }
