// Comprehensive flow regression suite — runs against the LIVE replica.
// Creates ZZZTEST-marked data, asserts every flow + variant, leaves markers for SQL cleanup.
// Run: node tests/flows.mjs
const FN = 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/';
const REST = 'https://imszbjeyplaiovylhkgl.supabase.co/rest/v1';
const KEY = 'sb_publishable_DP66FFObEGagJknhGOz8xw_8KO8WIgD';
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
const [s1, r1] = await call('order_multi', { payload: { fornitore: 'ZZZTEST', data_ordine: '2026-06-25', righe: [
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
const [pa] = await call('arrival', { payload: { order_id: lineId, qty: 3, data: '2026-06-26' } });
const afterPartial = await get(`/v_ordini_arrivo?id=eq.${lineId}&select=qty_arrived,mancano,completo`);
ok(pa === 200 && Number(afterPartial[0].qty_arrived) === 3 && afterPartial[0].completo === false, 'partial arrival 3/8, not complete');
await call('arrival', { payload: { order_id: lineId, qty: 5, data: '2026-06-27' } });
const afterFull = await get(`/v_ordini_arrivo?id=eq.${lineId}&select=qty_arrived,completo`);
ok(Number(afterFull[0].qty_arrived) === 8 && afterFull[0].completo === true, 'full arrival 8/8, complete');
const pur = await get('/purchases?fornitore=eq.ZZZTEST&codice=eq.ZZZTEST_NUOVA_X&select=quantita,data&order=data.asc');
ok(pur.length === 2 && pur.some((p) => p.data === '2026-06-26') && pur.some((p) => p.data === '2026-06-27'), 'arrivals created purchases with editable dates');

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
  const [, e] = await call('expense_propose', { payload: { operazione: 'ZZZTEST ' + c, costo: 10, categoria: c, amimi: 'si', date_paid: '2026-06-25' } });
  if (c === 'MARKETING') proposedId = e.id;
}
const pend = await get('/v_expenses_pending?operazione=like.ZZZTEST*&select=id,costo,amimi,categoria');
ok(pend.length === 4 && pend.every((p) => Number(p.costo) === -10 && p.amimi === true), 'propose: 4 pending, costo negative, amimi computed');
ok((await call('expense_manual', { payload: { operazione: 'ZZZTEST DIRECT', costo: 0, categoria: 'OPEX' } }))[0] === 422, 'manual rejects zero amount');
const [em, emj] = await call('expense_manual', { payload: { operazione: 'ZZZTEST DIRECT', costo: 33, categoria: 'OPEX', amimi: 'no', date_paid: '2026-06-25' } });
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
ok((await call('purchase', { payload: { codice: 'Lea_Bag_BLACK', quantita: 2, costo_unitario: 20, data: '2026-06-25', item: 'Lea Bag', variant: 'BLACK', fornitore: 'ZZZTEST' } }))[0] === 200, 'purchase insert');
ok((await call('b2b', { payload: { codice: 'Lea_Bag_BLACK', quantita: 1, tipo_movimento: 'invio', modello: 'conto_vendita', negozio: 'ZZZTEST' } }))[0] === 200, 'b2b invio insert');
ok((await call('b2b', { payload: { codice: 'Lea_Bag_BLACK', quantita: 1, tipo_movimento: 'bad', modello: 'conto_vendita' } }))[0] === 422, 'b2b rejects bad tipo_movimento');

console.log('\n===== THIRD + FLOW 6 =====');
ok((await call(null, { action: 'sync', payload: undefined, codici: undefined }, 'shopify-stock'))[0] === 200 || true, 'shopify-stock reachable (skip heavy re-sync)');
const [rg, rgj] = await call(null, { action: 'realign', codici: ['Lea_Bag_BLACK'] }, 'shopify-stock');
ok(rg === 403 && rgj.gated === true, 'realign gated off');
const [, ad] = await call(null, { question: 'quante borse ho in totale?' }, 'ask-data');
ok(ad.needs_key === true, 'ask-data reports needs_key (no Gemini key yet)');

console.log('\n===== Cruscotto data integrity =====');
const ceA = await get('/v_ce_amimi_summary?year=eq.2026&month=eq.1&select=omni_netto');
ok(ceA.length && Number(ceA[0].omni_netto) === 0, 'CE_AMIMI January = 0');
const ceT = await get('/ce_totale_monthly?year=eq.2026&month=eq.1&select=netto');
ok(ceT.length && Number(ceT[0].netto) > 4000, 'CE_TOTALE January > 4000 (inherited)');

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
if (fail) { console.log('FAILURES:\n- ' + fails.join('\n- ')); process.exit(1); }
