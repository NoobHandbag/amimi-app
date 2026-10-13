// tests/ce_compenso_soci.mjs — guardie sul SORGENTE per la riga "compenso soci" del CE (migr 0154, 13-10-2026).
//   node tests/ce_compenso_soci.mjs
//
// La riga e' un costo VARIABILE calcolato nelle viste (2,5% delle vendite nette, accordo socio). Vive in sei posti che
// devono restare d'accordo: le viste (MC1/MC2), l'invariante di ce-guard (se manca, ce_invarianti_mc suona su ogni mese),
// la griglia del CE dettagliato (riga + totale costi variabili), il Dettaglio mese del Cruscotto, il backup (senza la
// tabella parametri un restore azzera il compenso e manda in drift i mesi chiusi) e lo scope di default (Totale, richiesta
// owner 13-10). Le verifiche sui NUMERI in produzione stanno in tests/features.mjs (sola lettura).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 160) : '')); } };

console.log('\n== migrazione 0154 ==');
{
  const p = 'supabase/migrations/0154_ce_compenso_soci.sql';
  t('il file esiste', existsSync(ROOT + p));
  const M = existsSync(ROOT + p) ? read(p) : '';
  const mc1 = /omni_netto \+ cogs \+ packaging \+ commissioni \+ logistica_var \+ resi \+ compenso_soci AS mc1/g;
  t('MC1 delle due summary include compenso_soci', (M.match(mc1) || []).length === 2);
  t('MC2 delle due summary include compenso_soci', (M.match(/resi \+ compenso_soci \+ salari \+ tasse \+ logistica_mag \+ opex \+ eventi \+ marketing AS mc2/g) || []).length === 2);
  t('v_ce_totale: mc1 e mc2 ricalcolati col compenso', /t\.mc1 \+ c\.compenso_soci as mc1/.test(M) && /t\.mc2 \+ c\.compenso_soci as mc2/.test(M));
  t('base del Totale senza omaggi: si tolgono solo le righe kind = gift (vendite manuali e righe senza kind restano)', /and g\.kind = ''gift''\), 0\) \/ 1\.22/.test(M) && !/is distinct from ''vendita_manuale''/.test(M));
  t('base mai negativa (greatest ..., 0)', (M.match(/greatest\(/g) || []).length >= 3);
  t('le viste si avvolgono da pg_get_viewdef, non si ribattono', (M.match(/pg_get_viewdef\('public\.v_ce_(amimi|totale)'/g) || []).length === 2);
  t('guardia pre-reclose: netto identico, mc1 e mc2 scesi del solo compenso',
    /abs\(\(mc1 - \(snapshot->>'mc1'\)::numeric\) - compenso_soci\) > 0\.01/.test(M) && /abs\(\(mc2 - \(snapshot->>'mc2'\)::numeric\) - compenso_soci\) > 0\.01/.test(M));
  t('reclose = PATCH (solo mc1, mc2, base e compenso), non copia del live: non congela altri spostamenti fra righe (Gate 2 B1)',
    /set snapshot = s\.snapshot \|\| jsonb_build_object\('mc1', t\.mc1, 'mc2', t\.mc2, 'base_compenso_soci', t\.base_compenso_soci, 'compenso_soci', t\.compenso_soci\)/.test(M)
    && !/set snapshot = to_jsonb\(t\)/.test(M));
  t('change_log.before conserva i vecchi closed_at e closed_by', /'_closed_at', closed_at, '_closed_by', closed_by/.test(M));
  t('un solo accordo per socio e data di inizio (niente aliquote doppie)', /unique \(socio, dal\)/.test(M));
  t('audit in change_log prima della sovrascrittura', /insert into change_log[\s\S]*reclose-compenso-soci[\s\S]*update ce_snapshots/.test(M));
  t('guardia post-reclose: drift 0', /dopo la ri-chiusura restano/.test(M));
  t('funzione aliquota SECURITY DEFINER con search_path fisso', /security definer set search_path = public/.test(M));
  t('grant ad ask_ro (ask-data, assistant, MCP)', /grant execute on function public\.ce_aliquota_compensi\(int, int\) to ask_ro/.test(M));
}

console.log('\n== migrazione 0156 (pulizia gifts_offline) ==');
{
  const p = 'supabase/migrations/0156_gifts_offline_kind_pulizia.sql';
  const M = existsSync(ROOT + p) ? read(p) : '';
  t('0156 esiste', M.length > 0);
  // la base del Totale toglie le vendite incassate fuori dal fatturato, non piu' gli omaggi (che ora hanno prezzo 0)
  t('v_ce_totale riscritta da pg_get_viewdef cambiando SOLO il filtro del compenso, con guardia "uno e uno solo"',
    /pg_get_viewdef\('public\.v_ce_totale'::regclass, true\)/.test(M) && /<> 1 then\s+raise exception '0156: in v_ce_totale atteso un solo filtro/.test(M)
    && /replace\(d, old, 'g\.kind = ''vendita_fuori_fatturato''::text'\)/.test(M));
  t('kind obbligatorio con i soli quattro valori',
    /alter column kind set not null/.test(M)
    && /check \(kind in \('gift', 'vendita_manuale', 'vendita_fuori_fatturato', 'rettifica'\)\)/.test(M));
  t('un gift non puo\' avere prezzo (vincolo nel database)', /gifts_offline_gift_senza_prezzo\s+check \(kind <> 'gift' or coalesce\(prezzo, 0\) = 0\)/.test(M));
  t('il magazzino non si muove: guardia su quantita, codice e data', /a\.quantita is distinct from b\.quantita or a\.codice is distinct from b\.codice or a\.data is distinct from b\.data/.test(M));
  t('ogni riga toccata ha before/after in change_log', /insert into change_log[\s\S]*'gifts_offline', a\.id::text, 'update', to_jsonb\(b\), to_jsonb\(a\)/.test(M));
  t('ri-chiusura solo del Totale di marzo e giugno, con la lista esatta delle differenze attese',
    /where s\.id = t\.id and t\.ce = 'totale' and t\.month in \(3, 6\)/.test(M) && /'totale-6:cogs 193\.00, totale-6:mc1 193\.00, totale-6:mc2 193\.00'/.test(M));
  t('guardia finale: nessuna riga di nessuno snapshot diversa dal live', /restano righe diverse dal live/.test(M));
  const F = read('web/src/components/GiftForm.tsx');
  t('form Regalo: prezzo 0, il prezzo si chiede solo alla Vendita',
    /prezzo: isVendita \? Number\(prezzo\) : 0,/.test(F) && (F.match(/<NumberStepper value=\{prezzo\}/g) || []).length === 1
    && /\{isVendita && \(/.test(F));
  for (const f of ['supabase/functions/ask-data/index.ts', 'supabase/functions/assistant/index.ts']) {
    const P = read(f);
    t(`${f}: il prompt non dice piu' che il Totale contiene omaggi a listino e nomina vendita_fuori_fatturato`,
      !/gifts at list price|gifts val/.test(P) && /vendita_fuori_fatturato/.test(P));
  }
}

console.log('\n== ce-guard: invariante MC1 ==');
{
  const G = read('supabase/functions/ce-guard/index.ts');
  t('mc1c somma anche compenso_soci', /const mc1c = [^\n]*N\(r\.resi\) \+ N\(r\.compenso_soci\)/.test(G));
}

console.log('\n== frontend ==');
{
  const A = read('web/src/lib/api.ts');
  t('CE_COLS chiede base_compenso_soci e compenso_soci', /const CE_COLS = '[^']*,base_compenso_soci,compenso_soci'/.test(A));
  const D = read('web/src/pages/CeDetail.tsx');
  t('CE dettagliato: riga compenso_soci fra i costi variabili (dopo resi, prima del totale)',
    /k: 'resi'[^\n]*\n\s*\{ k: 'compenso_soci'[^\n]*\n\s*\{ k: 'var_tot'/.test(D));
  t('CE dettagliato: il totale costi variabili include il compenso', /case 'var_tot': return [^\n]*r\.compenso_soci;/.test(D));
  t('CE dettagliato: scope di default Totale', /const \[scope, setScope\] = useState<Scope>\('totale'\)/.test(D));
  const R = read('web/src/pages/Report.tsx');
  t('Cruscotto: scope di default Totale', /const \[scope, setScope\] = useState<Scope>\('totale'\)/.test(R));
  t('Cruscotto: Dettaglio mese anche in Totale (non piu\' solo Amimi)', !/scope === 'amimi' && \(\s*\n\s*<section className="card">\s*\n\s*<div className="dethead">/.test(R) && /const detRows = scope === 'amimi'/.test(R));
  t('Cruscotto: riga Compenso soci nel Dettaglio mese', /<DetRow label="Compenso soci[^"]*" v=\{dm\.compenso_soci/.test(R));
}

console.log('\n== Home e assistenti AI (13-10, seconda richiesta owner) ==');
{
  const H = read('web/src/pages/Home.tsx');
  t('Home: la card legge il CE Totale (stesso default di Cruscotto e CE dettagliato)',
    /from\('v_ce_totale'\)\.select\('month,omni_netto,mc2'\)/.test(H) && !/from\('v_ce_amimi_summary'\)/.test(H));
  t('Home: il delta a pari giorni usa lo stesso perimetro (Totale)', /fetchNettoMtd\('totale'\)/.test(H));
  const A = read('web/src/lib/api.ts');
  t('fetchNettoMtd: canali come le viste (Totale con le righe gift, B2B in entrambi i perimetri)',
    /scope === 'totale' \? \['online', 'offline', 'gift', 'b2b'\] : \['online', 'offline', 'b2b'\]/.test(A));
  for (const f of ['assistant', 'ask-data']) {
    const P = read(`supabase/functions/${f}/index.ts`);
    // la lista colonne di v_ce_totale: o nomina compenso_soci fra parentesi, o rimanda esplicitamente a quella sopra
    t(`${f}: lo schema nel prompt elenca compenso_soci in entrambe le viste CE`,
      /v_ce_amimi_summary\([^)]*compenso_soci[^)]*\)/.test(P)
      && (/v_ce_totale\([^)]*compenso_soci[^)]*\)/.test(P) || /v_ce_totale\([^)]*same columns as above\)/.test(P)));
    t(`${f}: l'aliquota non e' scritta nel prompt, si rimanda a ce_compensi_soci`, /rate from table ce_compensi_soci/.test(P) && !/2\.5% of net sales/.test(P));
    t(`${f}: il prompt dice che il compenso e' gia' dentro mc1 e mc2 e che il default e' il Totale`,
      /INSIDE mc1 and mc2/.test(P) && /v_ce_totale\([^\n]*DEFAULT for any P&L/.test(P));
  }
  const M = read('supabase/functions/mcp/index.ts');
  t('MCP pnl_summary: scope con default totale e compenso_soci nella risposta',
    /const scope = args\.scope === 'amimi' \? 'amimi' : 'totale';/.test(M) && /select\('month,omni_netto,compenso_soci,mc1,mc2'\)\.eq\('year', year\)/.test(M)
    && /scope: \{ type: 'string', enum: \['totale', 'amimi'\] \}/.test(M));
}

console.log('\n== backup ==');
{
  const B = read('scripts/db-backup.mjs');
  t('db-backup copia ce_compensi_soci', /'ce_compensi_soci'/.test(B));
}

console.log(`\n${ok} ok, ${ko} KO`);
if (ko) process.exit(1);
