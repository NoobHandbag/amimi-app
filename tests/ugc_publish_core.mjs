// tests/ugc_publish_core.mjs: ugc-publish (recensioni sul sito, brief 2026-10-28): logica pura di lib.ts e guardie sul
// sorgente della edge e della migr 0179.
//   node tests/ugc_publish_core.mjs   (Node 24 strippa i tipi TS all'import)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  titleCase, dayRome, isPublishable, ownedId, desiredFields, planReviews, planModello, deleteGuard, missingScopes, chunk, MAX_DELETE_RUN, mergeHealth,
} from '../supabase/functions/ugc-publish/lib.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SRC = read('supabase/functions/ugc-publish/index.ts');
const LIB = read('supabase/functions/ugc-publish/lib.ts');
const M179 = read('supabase/migrations/0179_ugc_publish.sql');
const TOML = read('supabase/config.toml');
const code = SRC.replace(/^\s*\/\/[^\n]*$/gm, '');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 300) : '')); } };
const eq = (n, got, exp) => t(n, JSON.stringify(got) === JSON.stringify(exp), `atteso ${JSON.stringify(exp)}, ottenuto ${JSON.stringify(got)}`);

const row = (o = {}) => ({ id: 14, kind: 'recensione', status: 'approvata', codice: 'LEA_BAG_COCCO_ORANGE', rating: 5, testo: ' Bellissima borsa ',
  firma: 'Marianna', consenso_testo: 'Acconsento...', created_at: '2026-10-28T09:10:48Z', ...o });
const GID = 'gid://shopify/Product/1';
const ctx = (o = {}) => ({
  handleByCodice: new Map([['LEA_BAG_COCCO_ORANGE', 'lea-bag-cocco-orange'], ['VALENTINA_BAG_RED', 'valentina-bag']]),
  productByHandle: new Map([['lea-bag-cocco-orange', { id: GID, handle: 'lea-bag-cocco-orange', status: 'ACTIVE', modello: 'Lea Bag' }]]),
  modelloByHandle: new Map([['lea-bag-cocco-orange', 'Lea Bag']]),
  modelByCodice: new Map([['LEA_BAG_COCCO_ORANGE', 'Lea Bag'], ['VALENTINA_BAG_RED', 'Valentina Bag']]),
  ...o,
});
const asExisting = (handle, fields, id = 'gid://shopify/Metaobject/9') => ({ id, handle, status: 'ACTIVE', fields: Object.fromEntries(fields.map((f) => [f.key, f.value])) });

console.log('\n== title case e giorno di Roma ==');
eq('LEA BAG -> Lea Bag', titleCase('LEA BAG'), 'Lea Bag');
eq('LEA BAG X RITA -> Lea Bag X Rita', titleCase('LEA BAG X RITA'), 'Lea Bag X Rita');
eq('spazi e minuscole', titleCase('  annie   bag maxi '), 'Annie Bag Maxi');
eq('null -> vuoto', titleCase(null), '');
eq('22:30 UTC del 30-09 = 01-10 a Roma', dayRome('2026-09-30T22:30:00Z'), '2026-10-01');
eq('ora solare: 23:30 UTC del 31-12 = 01-01', dayRome('2025-12-31T23:30:00Z'), '2026-01-01');

console.log('\n== pubblicabile ==');
t('approvata con stelle, testo e consenso', isPublishable(row()));
t('in revisione: no', !isPublishable(row({ status: 'in_revisione' })));
t('rifiutata: no', !isPublishable(row({ status: 'rifiutata' })));
t('look: no (fuori perimetro)', !isPublishable(row({ kind: 'look', rating: null })));
t('testo solo spazi: no', !isPublishable(row({ testo: '   ' })));
t('senza consenso: no', !isPublishable(row({ consenso_testo: '' })));
t('stelle nulle: no', !isPublishable(row({ rating: null })));

console.log('\n== campi pubblici (privacy) ==');
{
  const f = desiredFields(row({ shopify_customer_id: '123', foto: ['x/y.jpg'], idemp: 'abcdefgh' }), GID, 'Lea Bag');
  eq('solo le chiavi ammesse', f.map((x) => x.key).sort(), ['borsa', 'data', 'firma', 'id_sorgente', 'modello', 'stelle', 'testo']);
  eq('testo con trim', f.find((x) => x.key === 'testo').value, 'Bellissima borsa');
  eq('stelle come stringa intera', f.find((x) => x.key === 'stelle').value, '5');
  t('nessun valore privato nei campi', !JSON.stringify(f).includes('123') && !JSON.stringify(f).includes('x/y.jpg'));
  const g = desiredFields(row({ firma: '   ' }), null, 'Lea Bag');
  t('firma vuota = campo omesso (niente stringa vuota)', !g.some((x) => x.key === 'firma'));
  t('borsa non trovata = campo omesso', !g.some((x) => x.key === 'borsa'));
}
t('lib: desiredFields non legge cliente, email, ordine o foto', !/shopify_customer_id|email|order|foto/.test(LIB.slice(LIB.indexOf('export const desiredFields'), LIB.indexOf('export type Ctx'))));
t('edge: la select di loyalty_ugc non chiede cliente, foto o idemp', /select\('id, kind, status, codice, rating, testo, firma, consenso_testo, created_at', \{ count: 'exact' \}\)/.test(code));
{
  const f = desiredFields(row({ firma: 'Anna\nB.', testo: 'riga uno\r\nriga due' }), null, '');
  eq('firma su una riga sola', f.find((x) => x.key === 'firma').value, 'Anna B.');
  eq('testo con a capo LF', f.find((x) => x.key === 'testo').value, 'riga uno\nriga due');
}

console.log('\n== voci nostre e voci altrui ==');
eq('recensione-14 con id_sorgente 14: nostra', ownedId(asExisting('recensione-14', [{ key: 'id_sorgente', value: '14' }])), 14);
eq('recensione-14 senza id_sorgente: mai toccata', ownedId(asExisting('recensione-14', [])), null);
eq('recensione-14 con id_sorgente 15: mai toccata', ownedId(asExisting('recensione-14', [{ key: 'id_sorgente', value: '15' }])), null);
eq('altro handle: mai toccata', ownedId(asExisting('recensione-della-redazione', [{ key: 'id_sorgente', value: '14' }])), null);
eq('recensione-14-bis: mai toccata', ownedId(asExisting('recensione-14-bis', [{ key: 'id_sorgente', value: '14' }])), null);

console.log('\n== piano delle recensioni ==');
{
  const p = planReviews([row()], [], ctx());
  eq('nuova -> crea', p.upserts.map((u) => [u.handle, u.create]), [['recensione-14', true]]);
  const same = desiredFields(row(), GID, 'Lea Bag');
  const p2 = planReviews([row()], [asExisting('recensione-14', same)], ctx());
  eq('identica -> nessuna scrittura (test 2 del brief)', [p2.upserts.length, p2.unchanged, p2.deletes.length], [0, 1, 0]);
  const draft = { ...asExisting('recensione-14', same.map((f) => f.key === 'testo' ? { ...f, value: 'vecchio' } : f)), status: 'DRAFT' };
  const p3 = planReviews([row()], [draft], ctx());
  eq('testo cambiato -> aggiorna solo quello', p3.upserts.map((u) => [u.create, u.changed]), [[false, ['testo']]]);
  const p4 = planReviews([row({ status: 'rifiutata', motivo: 'x' })], [asExisting('recensione-14', same)], ctx());
  eq('rifiutata dopo -> togli', p4.deletes.map((d) => d.handle), ['recensione-14']);
  const p5 = planReviews([], [asExisting('recensione-99', [{ key: 'id_sorgente', value: '99' }])], ctx());
  eq('cancellata dal gestionale -> togli', p5.deletes.map((d) => d.ugcId), [99]);
  const p6 = planReviews([row()], [asExisting('recensione-14', [])], ctx());
  eq('handle occupato da una voce senza id_sorgente -> ne' + "'" + ' crea ne' + "'" + ' aggiorna', [p6.upserts.length, p6.blocked, p6.deletes.length], [0, ['recensione-14'], 0]);
  const withFirma = asExisting('recensione-14', desiredFields(row(), GID, 'Lea Bag'));
  const p9 = planReviews([row({ firma: null })], [withFirma], ctx());
  eq('firma tolta nel gestionale -> svuotata sul sito', p9.upserts.map((u) => [u.changed, u.fields.find((f) => f.key === 'firma')?.value]), [[['firma'], '']]);
  const noFirma = asExisting('recensione-14', desiredFields(row({ firma: null }), GID, 'Lea Bag'));
  eq('firma assente su entrambi -> identica', planReviews([row({ firma: null })], [noFirma], ctx()).unchanged, 1);
  const p7 = planReviews([row({ id: 17, codice: 'VALENTINA_BAG_RED', firma: null })], [], ctx());
  const f7 = Object.fromEntries(p7.upserts[0].fields.map((f) => [f.key, f.value]));
  eq('scheda non letta: modello dal gestionale, niente borsa, niente firma', [f7.modello, f7.borsa, f7.firma], ['Valentina Bag', undefined, undefined]);
  const p8 = planReviews([row()], [], ctx({ modelloByHandle: new Map([['lea-bag-cocco-orange', 'Lea Bag Speciale']]) }));
  eq('il modello della recensione = custom.modello della scheda', p8.upserts[0].fields.find((f) => f.key === 'modello').value, 'Lea Bag Speciale');
}

console.log('\n== custom.modello sulle schede ==');
{
  const want = new Map([['a', 'Lea Bag'], ['b', 'Annie Bag'], ['c', 'Agata Bag Rose Butter Int. Lilla'], ['d', 'Nina Bag'], ['e', 'Lola Bag']]);
  const prods = [
    { id: 'A', handle: 'a', status: 'ACTIVE', modello: null },
    { id: 'B', handle: 'b', status: 'DRAFT', modello: 'Annie Bag' },
    { id: 'C', handle: 'c', status: 'ACTIVE', modello: 'Agata Bag' },
    { id: 'D', handle: 'd', status: 'ARCHIVED', modello: null },
    { id: 'E', handle: 'e', status: 'DRAFT', modello: '' },
  ];
  const m = planModello(prods, want);
  eq('vuoti (anche DRAFT) -> scritti', m.sets.map((s) => [s.handle, s.value]), [['a', 'Lea Bag'], ['e', 'Lola Bag']]);
  eq('gia giusti -> niente (test 6)', m.same, 1);
  eq('diverso -> NON sovrascritto, segnalato', m.divergent, [{ handle: 'c', shopify: 'Agata Bag', gestionale: 'Agata Bag Rose Butter Int. Lilla' }]);
  eq('archiviati ignorati', m.sets.some((s) => s.handle === 'd'), false);
  eq('valore effettivo dopo il giro', [...m.modelloByHandle.entries()].sort(), [['a', 'Lea Bag'], ['b', 'Annie Bag'], ['c', 'Agata Bag'], ['e', 'Lola Bag']]);
  eq('metafieldsSet a lotti di 25', chunk(Array.from({ length: 51 }, (_, i) => i), 25).map((x) => x.length), [25, 25, 1]);
}

console.log('\n== freni ==');
eq('scope: mancano entrambi', missingScopes(['read_products']), ['write_metaobjects', 'write_products']);
eq('scope: presenti', missingScopes(['write_metaobjects', 'write_products', 'read_products']), []);
t('gestionale vuoto con voci sul sito -> rimozioni sospese', deleteGuard(0, 5, 5) !== null);
t('rifiutata l\'ultima pubblicata (0 pubblicabili, 1 voce) -> passa', deleteGuard(0, 1, 1) === null);
t('forceDeletes sblocca il freno', deleteGuard(0, 5, 5, true) === null && deleteGuard(10, 10, 9, true) === null);
eq('health: un ok non cancella un errore dello stesso giorno', mergeHealth({ label: 'E', n: 1, severity: 'error' }, { label: 'O', n: 0, severity: 'ok' }), { label: 'E || ultimo giro: O', n: 1, severity: 'error' });
eq('health: un errore sostituisce un ok', mergeHealth({ label: 'O', n: 0, severity: 'ok' }, { label: 'E', n: 2, severity: 'error' }), { label: 'E', n: 2, severity: 'error' });
eq('health: prima riga del giorno', mergeHealth(null, { label: 'O', n: 0, severity: 'ok' }).severity, 'ok');
t('edge: letture del gestionale con conteggio esatto e stop se tagliate', (code.match(/\{ count: 'exact' \}/g) ?? []).length === 3 && /lettura tagliata/.test(code));
t('edge: la riga di salute passa da mergeHealth', /mergeHealth\(prev \?\? null/.test(code));
t('edge: forceDeletes solo come booleano esplicito', /body\.forceDeletes === true/.test(code));
t('oltre il tetto -> rimozioni sospese', deleteGuard(10, 10, MAX_DELETE_RUN + 1) !== null);
t('una rifiutata -> passa', deleteGuard(5, 6, 1) === null);

console.log('\n== guardie sul sorgente della edge ==');
t('flag OFF = {state:off} prima di ogni chiamata Shopify', /if \(!enabled && !dryRun\) return json\(\{ state: 'off' \}\)/.test(code) && code.indexOf("state: 'off'") < code.indexOf('const gql = '));
t('flag illeggibile = 503, mai off', /if \(fErr\) return json\(\{ error: `app_flags: \$\{fErr\.message\}` \}, 503\)/.test(code));
t('PIN prima del flag', code.indexOf("'PIN errato'") > 0 && code.indexOf("'PIN errato'") < code.indexOf("'ugc_publish_enabled'"));
t('API pinnata 2026-07, GraphQL', /const API_VERSION = '2026-07'/.test(SRC) && /graphql\.json/.test(SRC));
t('scope controllati prima di leggere o scrivere', code.indexOf('missingScopes(') < code.indexOf("from('loyalty_ugc')") && code.indexOf('missingScopes(') < code.indexOf('metaobjectUpsert'));
t('ogni lettura (gestionale e Shopify) prima della prima scrittura', code.lastIndexOf('return fail(') < code.indexOf('metafieldsSet(metafields'));
t('capabilities ACTIVE solo alla creazione (la Bozza resta Bozza)', /if \(u\.create\) metaobject\.capabilities = \{ publishable: \{ status: 'ACTIVE' \} \}/.test(code) && (code.match(/capabilities = /g) ?? []).length === 1);
t('rimozioni dietro il freno', /if \(stop\) noteErr\(stop\);\s*\n\s*else for \(const del of plan\.deletes\)/.test(code));
t('change_log site_publish / site_unpublish su loyalty_ugc', /'site_publish'/.test(code) && /'site_unpublish'/.test(code) && /tbl: 'loyalty_ugc'/.test(code));
t('health_log k = ugc_publish', /k: 'ugc_publish'/.test(code));
t('productByHandle deprecato non usato', !/productByHandle\(/.test(code));
t('nessuna scrittura su loyalty_* (solo lettura)', !/from\('loyalty_[a-z_]+'\)\.(insert|update|upsert|delete)/.test(code));

console.log('\n== migr 0179 e config ==');
t('flag nasce false', /insert into app_flags \(key, value\) values \('ugc_publish_enabled', 'false'\) on conflict \(key\) do nothing/.test(M179));
t('cron ogni 10 minuti su minuti dispari', /cron\.schedule\('ugc-publish', '9,19,29,39,49,59 \* \* \* \*'/.test(M179));
t('cron col PIN neutro verso ugc-publish', /functions\/v1\/ugc-publish/.test(M179) && /"pin":"x"/.test(M179));
t('config.toml: verify_jwt = false (il cron non manda JWT)', /\[functions\.ugc-publish\]\nverify_jwt = false/.test(TOML));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
