// tests/write_api_guardie.mjs — guardie sul SORGENTE di write-api v26 (audit gate 14-09, blocco 1).
//   node tests/write_api_guardie.mjs
//
// Come le altre guardie sul sorgente (shopify_sync_guardie, letture_controllate): le classi qui coperte compaiono solo
// quando arriva un input strano (contati vuoto, data '14/09/2026', reject di una spesa approvata) o un 504, cioe' mai
// in un collaudo. Il file legge il sorgente e verifica che le cinture della v26 ci siano ancora. Se qualcuno le toglie
// "per semplificare", il test lo dice.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const SRC = read('supabase/functions/write-api/index.ts');
const LIB = read('supabase/functions/write-api/lib.ts');
// le catene supabase-js vanno a capo prima di .select/.insert: si riattaccano prima di cercare per riga
const flat = (s) => s.replace(/\)\s*\n\s*\./g, ').');
const F = flat(SRC);

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 160) : '')); } };

console.log('\n== A5: nessun Number() sui campi soldi/stock; si passa da num() ==');
{
  const CAMPI = 'contati|qty|quantita|costo|costo_unitario|cogs|retail_price|prezzo|prezzo_retail|perc_negozio|importo_rimborsato|qty_sostituto|qty_ordered';
  const reNum = new RegExp(`Number\\((?:payload|p|r|edits)\\.(?:${CAMPI})\\b`, 'g');
  const hits = F.match(reNum) || [];
  t(`0 Number(...) su campi soldi/stock (trovati ${hits.length})`, hits.length === 0, hits.join(', '));
  t('num importato da ./lib.ts', /import \{[^}]*\bnum\b[^}]*\} from '\.\/lib\.ts'/.test(SRC));
  t('isoDate, ymFromIso, todayRome, tok, cnorm, VALID_CATEGORIE importati da ./lib.ts',
    /\bisoDate\b/.test(SRC) && /\bymFromIso\b/.test(SRC) && /\btodayRome\b/.test(SRC) && /import \{[^}]*VALID_CATEGORIE[^}]*\} from '\.\/lib\.ts'/.test(SRC));
}

console.log('\n== B4/B39: data di Roma, niente parsing a fuso per year/month ==');
{
  t('const today = todayRome()', /const today = todayRome\(\)/.test(SRC));
  t('nessun const today = new Date().toISOString()', !/const today = new Date\(\)\.toISOString\(\)/.test(SRC));
  t('nessun .getFullYear() (year/month vengono da ymFromIso)', !/\.getFullYear\(\)/.test(SRC));
  t('nessun .getMonth() ', !/\.getMonth\(\)/.test(SRC));
  t('ymFromIso usato per derivare year/month', /ymFromIso\(/.test(SRC));
}

console.log('\n== A4: return, aggiustamento del sostituto controllato ==');
{
  const adjInserts = F.split('\n').filter((l) => /from\('stock_adjustments'\)\.insert\(/.test(l));
  t(`ogni insert su stock_adjustments destruttura error (${adjInserts.length})`, adjInserts.length >= 2 && adjInserts.every((l) => /error:/.test(l)), adjInserts.find((l) => !/error:/.test(l)));
  t('risposta dedicata sostituto_adjustment_failed', /sostituto_adjustment_failed/.test(SRC));
  t("compensazione: il reso appena inserito viene cancellato", /from\('returns'\)\.delete\(\)\.eq\('id', data\.id\)/.test(F));
  t('un fallimento anche della compensazione lascia una riga change_log', /return_sostituto_failed/.test(SRC));
}

console.log('\n== B2/B3: expense_approve legge sempre la riga; reject di una approvata in mese chiuso bloccato; categorie ==');
{
  t("expense_approve legge year, month, status, categoria", /from\('expenses'\)\.select\('year, month, status, categoria'\)/.test(F));
  // la lettura NON e' piu' dentro `if (decision !== 'rejected' ...)`: il ramo rejected controlla lo stato approved
  t('reject di una spesa gia approved -> closedErr', /if \(decision === 'rejected'\)/.test(SRC) && /if \(exRow\.status === 'approved'\) return closedErr/.test(SRC));
  t('VALID_CATEGORIE usato in almeno 3 punti (manual/propose, approve, bulk)', (SRC.match(/VALID_CATEGORIE/g) || []).length >= 3);
  t('nessuna lista locale const VALID = [ ...', !/const VALID = \[/.test(SRC));
  t('edits.costo passa da num()', /const c = num\(edits\.costo, \{ nonZero: true \}\)/.test(SRC));
}

console.log('\n== A2/B9: gift/b2b dall\'app, COGS dal listino (totale di riga) ==');
{
  t("lettura products.cogs con retryOnce nell'insert generico", /retryOnce\(\(\) => sb\.from\('products'\)\.select\('cogs'\)\.eq\('codice_norm', cnorm\(p\.codice\)\)/.test(F));
  t('row.cogs = round(cogs unitario * quantita)', /Math\.round\(cogsUnit \* qtyG \* 100\) \/ 100/.test(SRC));
  t('un prodotto senza COGS a catalogo = 422 needs_cogs', /needs_cogs: true/.test(SRC));
  t('change_log porta cogs_unitario e cogs_da_catalogo', /cogs_unitario/.test(SRC) && /cogs_da_catalogo/.test(SRC));
  t('il server ignora year/month del client (li rideriva da ymFromIso)', /row\.year = ymG\.year; row\.month = ymG\.month/.test(SRC));
  t('chiavi di audit tolte dal payload (STRIP)', /const STRIP = new Set\(\[/.test(SRC) && /'verificato'/.test(SRC) && /'codice_norm'/.test(SRC));
}

console.log('\n== B43: product dall\'insert generico, CODICE derivato dal server ==');
{
  t('CODICE derivato con tok v2', /const derived = `\$\{tok\(item\)\}_\$\{tok\(variant\)\}`/.test(SRC));
  t('il codice del client diverso e\' tracciato in change_log', /codice_client/.test(SRC));
  t('verificato = false sul prodotto nuovo', /row\.verificato = false/.test(SRC));
}

console.log('\n== B5: force vale solo se === true e una scrittura forzata e\' tracciata ==');
{
  t('const force = body.force === true', /const force = body\.force === true/.test(SRC));
  t('nessun destructuring force = false dal body', !/force = false \} = body/.test(SRC));
  t('change_log porta forced: true su una scrittura forzata', /forced: true/.test(SRC));
}

console.log('\n== lib.ts: helper puri presenti ==');
{
  t('num, isoDate, todayRome, ymFromIso, tok, cnorm, VALID_CATEGORIE esportati', /export function num/.test(LIB) && /export function isoDate/.test(LIB) && /export function todayRome/.test(LIB) && /export function ymFromIso/.test(LIB) && /export const tok/.test(LIB) && /export const cnorm/.test(LIB) && /export const VALID_CATEGORIE/.test(LIB));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
