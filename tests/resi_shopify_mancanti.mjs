// tests/resi_shopify_mancanti.mjs — guardie sul SORGENTE per i resi Shopify mancanti (migr 0201, 20-11-2026).
//   node tests/resi_shopify_mancanti.mjs
//
// Un rimborso Shopify entra nel CE da solo, la giacenza no: v_inventory fa rientrare un pezzo solo con una riga in
// `returns`. La vista elenca gli ordini rimborsati che aspettano un reso, ce-guard la legge (WARN). Le regole che
// devono restare vere: soglia sul pezzo piu' economico (fuori i rimborsi della spedizione), righe non prodotto fuori,
// resi Qromo esclusi dall'abbinamento, integrale = un reso per riga, parziale = un reso su una riga, niente anon.
import { readFileSync } from 'node:fs';

const MIG = readFileSync(new URL('../supabase/migrations/0201_resi_shopify_mancanti.sql', import.meta.url), 'utf8');
const M0205 = readFileSync(new URL('../supabase/migrations/0205_resi_auto_da_shopify.sql', import.meta.url), 'utf8');
const GUARD = readFileSync(new URL('../supabase/functions/ce-guard/index.ts', import.meta.url), 'utf8');

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fail++; };

ok('vista: solo ordini con un rimborso', /where o\.refund_amount > 0/.test(MIG));
ok('vista: soglia = meta\' della riga prodotto piu\' economica (fuori i rimborsi della sola spedizione)',
  /having refund_amount >= 0\.5 \* min\(price\)/.test(MIG));
ok('vista: righe non prodotto (GIFT_CARD, ORDINE_TEST) escluse con la stessa normalizzazione del resolver',
  /not exists \(select 1 from non_product_codici np where upper\(regexp_replace\(np\.codice, '\\s\+', '_', 'g'\)\) = li\.codice_norm\)/.test(MIG));
ok('vista: i resi Qromo non coprono un rimborso Shopify', /lower\(coalesce\(canale, ''\)\) <> 'qromo'/.test(MIG));
ok('vista: la soglia si applica PRIMA della numerazione (Gate 2 B1: un ordine scartato non tiene il posto di un reso)',
  /\), ordini as \([\s\S]*having refund_amount >= 0\.5 \* min\(price\)\s*\), righe_integrali as \(/.test(MIG)
  && /join ordini o on o\.order_id = p\.order_id\s+where o\.financial_status = 'refunded'/.test(MIG));
ok('vista: abbinamento per codice, i-esima riga integrale con i-esimo reso, per riga (line_id)',
  /partition by p\.codice_norm order by p\.created_at_shop, p\.order_id, p\.line_id/.test(MIG)
  && /partition by codice_norm order by data, created_at/.test(MIG)
  && /re\.codice_norm = ri\.codice_norm and re\.n = ri\.n\s+where ri\.line_id = p\.line_id/.test(MIG));
ok('vista: un parziale non prende posti, e\' coperto dai resi in piu\' rispetto agli integrali del codice',
  /from resi_per_codice r where r\.codice_norm = p\.codice_norm\), 0\)\s+> coalesce\(\(select n from integrali_per_codice i where i\.codice_norm = p\.codice_norm\), 0\)/.test(MIG));
ok('vista: righe senza codice escluse (codice_norm e\' generato da coalesce, mai NULL)', /li\.codice_norm <> ''/.test(MIG));
ok('vista: integrale = serve un reso per ogni riga, parziale = basta un reso su una riga',
  /case when o\.financial_status = 'refunded' then bool_or\(not s\.coperta\) else not bool_or\(s\.coperta\) end/.test(MIG));
ok('vista: niente anon', /revoke all on public\.v_resi_shopify_mancanti from anon/.test(MIG));
ok('ce-guard: check WARN ce_resi_shopify_mancanti sulla vista, letto con read() (lettura fallita = errore, non verde)',
  /read\('v_resi_shopify_mancanti', await sb\.from\('v_resi_shopify_mancanti'\)/.test(GUARD)
  && /add\('ce_resi_shopify_mancanti'[\s\S]{0,400}nResi, 'warn'\)/.test(GUARD));
ok('ce-guard: l\'etichetta elenca al massimo 10 ordini', /slice\(0, 10\)[\s\S]{0,200}e altri \$\{nResi - 10\}/.test(GUARD));

// Abbinamento sui casi del 20-11 (riproduzione in JS della regola della vista, dati veri ridotti)
function mancanti(ordini, resi) {
  const tenuti = [...ordini].filter((o) => o.refund >= 0.5 * Math.min(...o.righe.map((x) => x.price)))
    .sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
  const nReso = new Map(), coperti = new Set();
  for (const r of [...resi].sort((a, b) => a.data.localeCompare(b.data))) {
    const n = (nReso.get(r.codice) ?? 0) + 1; nReso.set(r.codice, n); coperti.add(`${r.codice}#${n}`);
  }
  const nInt = new Map();
  const righe = new Map();
  for (const o of tenuti) {
    righe.set(o.id, o.righe.map((x) => {
      if (o.stato !== 'refunded') return { ...x };
      const n = (nInt.get(x.codice) ?? 0) + 1; nInt.set(x.codice, n); return { ...x, coperta: coperti.has(`${x.codice}#${n}`) };
    }));
  }
  const out = [];
  for (const o of tenuti) {
    const rr = righe.get(o.id).map((x) => (o.stato === 'refunded' ? x : { ...x, coperta: (nReso.get(x.codice) ?? 0) > (nInt.get(x.codice) ?? 0) }));
    const scoperto = o.stato === 'refunded' ? rr.some((x) => !x.coperta) : !rr.some((x) => x.coperta);
    if (scoperto) out.push(o.id);
  }
  return out;
}
const ORD = [
  { id: '#1002', data: '2026-02-16', stato: 'partially_refunded', refund: 6.9, righe: [{ codice: 'LEA_BAG_ZEBRA_DARK', price: 150 }] },
  { id: '#1389', data: '2026-06-24', stato: 'partially_refunded', refund: 45, righe: [{ codice: 'NINA_BAG_STRIPES_PETROL_BLUE', price: 50 }] },
  { id: '#1499', data: '2026-07-17', stato: 'refunded', refund: 216, righe: [{ codice: 'LEA_BAG_ZEBRA_DARK', price: 120 }, { codice: 'ANNIE_BAG_PAILLETTES_LIGHT_GREEN', price: 90 }] },
  { id: '#1571', data: '2026-07-25', stato: 'refunded', refund: 135, righe: [{ codice: 'LEA_BAG_BLACK_PIERCING', price: 150 }] },
  { id: '#1598', data: '2026-07-29', stato: 'partially_refunded', refund: 51.54, righe: [{ codice: 'NINA_BAG_MAXI_STRIPES_REED', price: 56 }, { codice: 'AIRPOD_COVER_7X9_STRIPES_CANDY_PINK', price: 11.2 }] },
  { id: '#1672', data: '2026-08-23', stato: 'refunded', refund: 130, righe: [{ codice: 'NINA_BAG_STRIPES_PETROL_BLUE', price: 50 }, { codice: 'ANNIE_BAG_PEARL_GREY', price: 80 }] },
];
const RESO_1571 = [{ codice: 'LEA_BAG_BLACK_PIERCING', data: '2026-08-26' }];
ok('casi 20-11: #1002 (solo spedizione) fuori, #1571 coperto dal suo reso, gli altri in elenco',
  JSON.stringify(mancanti(ORD, RESO_1571)) === JSON.stringify(['#1389', '#1499', '#1598', '#1672']));
ok('B1: il reso ZEBRA_DARK va al #1499, non al #1002 scartato (con il reso ANNIE il #1499 si chiude)',
  !mancanti(ORD, [...RESO_1571, { codice: 'LEA_BAG_ZEBRA_DARK', data: '2026-07-20' }, { codice: 'ANNIE_BAG_PAILLETTES_LIGHT_GREEN', data: '2026-07-20' }]).includes('#1499'));
ok('un reso NINA_BAG_STRIPES_PETROL_BLUE va prima all\'integrale (#1672), il parziale #1389 resta finche\' non c\'e\' un reso in piu\'',
  JSON.stringify(mancanti(ORD, [...RESO_1571, { codice: 'NINA_BAG_STRIPES_PETROL_BLUE', data: '2026-07-01' }])) === JSON.stringify(['#1389', '#1499', '#1598', '#1672'])
  && JSON.stringify(mancanti(ORD, [...RESO_1571, { codice: 'NINA_BAG_STRIPES_PETROL_BLUE', data: '2026-07-01' }, { codice: 'ANNIE_BAG_PEARL_GREY', data: '2026-09-01' }])) === JSON.stringify(['#1389', '#1499', '#1598']));
ok('parziale: un reso su una sola riga chiude #1598',
  !mancanti(ORD, [...RESO_1571, { codice: 'NINA_BAG_MAXI_STRIPES_REED', data: '2026-08-05' }]).includes('#1598'));
ok('integrale: #1672 resta finche\' manca il reso di una delle due righe',
  mancanti(ORD, [...RESO_1571, { codice: 'NINA_BAG_STRIPES_PETROL_BLUE', data: '2026-07-01' }, { codice: 'NINA_BAG_STRIPES_PETROL_BLUE', data: '2026-09-01' }]).includes('#1672')
  && !mancanti(ORD, [...RESO_1571, { codice: 'NINA_BAG_STRIPES_PETROL_BLUE', data: '2026-07-01' }, { codice: 'NINA_BAG_STRIPES_PETROL_BLUE', data: '2026-09-01' }, { codice: 'ANNIE_BAG_PEARL_GREY', data: '2026-09-01' }]).includes('#1672'));

// migr 0205 (20-11, Dan: la conta fisica e' giusta, i rimborsi vecchi non si toccano): la vista guarda solo i rimborsi
// e i resi dal 20-11, il resto della regola resta quello della 0201.
ok('0205: la vista guarda solo i rimborsi e i resi dalla fine della conta del 20-11 (12:03 UTC)',
  /o\.rimborsato_il >= timestamptz '2026-11-20 12:03:00\+00'/.test(M0205) && /and created_at >= timestamptz '2026-11-20 12:03:00\+00'/.test(M0205));
ok('0205: stessa regola della 0201 (soglia, integrale/parziale, line_id), niente anon',
  /having refund_amount >= 0\.5 \* min\(price\)/.test(M0205) && /where ri\.line_id = p\.line_id/.test(M0205)
  && /case when o\.financial_status = 'refunded' then bool_or\(not s\.coperta\) else not bool_or\(s\.coperta\) end/.test(M0205)
  && /revoke all on public\.v_resi_shopify_mancanti from anon/.test(M0205));
ok('0205: chiave unica del reso automatico (lo stesso rimborso non entra due volte) e data dell\'ultimo rimborso',
  /if not exists \(select 1 from pg_constraint where conname = 'returns_shopify_refund_line_id_key'\)[\s\S]*add constraint returns_shopify_refund_line_id_key unique \(shopify_refund_line_id\)/.test(M0205) && /add column if not exists rimborsato_il timestamptz/.test(M0205));

if (fail) { console.error(`\n${fail} guardie fallite`); process.exit(1); }
console.log('\ntutte le guardie ok');
