// tests/stock_fermo_guardie.mjs: guardie sul SORGENTE della migr 0190 (pezzi a magazzino non in vendita sul sito, 09-11-2026)
//   node tests/stock_fermo_guardie.mjs
//
// Il 09-11 erano fermi 107 pezzi su 13 codici e nessuno schermo lo diceva. Qui si fissa il testo: v_stock_fermo conta solo
// i pezzi disponibili da vendere senza una riga Shopify ATTIVA fra quelle dell'ultimo giro di sync (le righe vecchie del
// mirror non salvano un prodotto tolto dal sito), fermi da almeno 3 giorni, fuori non_product_codici; sola lettura per i
// ruoli dell'app; v_health tiene identiche le 14 righe della 0181 e aggiunge stock_fermo, 'bad'; nessuna scrittura e nessun
// innesto. Lato app: la scheda e' per tutto il team (non dietro cfg.finance), legge colonne che la vista ha, dice quando la
// lettura fallisce, e il banner di Ale non la ripete. L'autocontrollo prova ogni rilevatore su un sorgente rotto apposta.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const MIG = 'supabase/migrations/';
const nomi = readdirSync(ROOT + MIG);
const M190 = nomi.includes('0190_stock_fermo.sql') ? read(MIG + '0190_stock_fermo.sql') : '';
const M181 = read(MIG + '0181_watchdog.sql');
const CARD = read('web/src/components/StockFermo.tsx');
const HOME = read('web/src/pages/Home.tsx');
const BANNER = read('web/src/components/HealthBanner.tsx');
const RLS181 = read('tests/watchdog_rls.sql');
const noComments = (s) => s.replace(/--[^\n]*/g, '');
const flat = (s) => s.replace(/\s+/g, ' ').trim();

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

// ---- rilevatori (funzioni del testo, provate anche sui sorgenti rotti in fondo) ----
const vistaFermo = (src) => (noComments(src).match(/create or replace view public\.v_stock_fermo as[\s\S]*?;\n/) ?? [''])[0];
const vistaHealth = (src) => (noComments(src).match(/create or replace view v_health as[\s\S]*?\nfrom checks;/) ?? [''])[0];
const righeChecks = (v) => (v.match(/with checks as \(([\s\S]*?)\n\)\nselect k, label, n,/) ?? ['', ''])[1];
const gravita = (v) => (v.match(/\nselect k, label, n,\n([\s\S]*?)\nfrom checks;/) ?? ['', ''])[1];
// le 14 righe della 0181 identiche (spazi a parte) in testa, poi solo stock_fermo
const vecchieUguali = (src) => {
  const prima = flat(righeChecks(vistaHealth(M181)));
  const ora = flat(righeChecks(vistaHealth(src)));
  return prima.length > 2000 && ora === prima + " union all select 'stock_fermo', 'Prodotti con pezzi a magazzino non in vendita sul sito da almeno 3 giorni', (select count(*) from v_stock_fermo)";
};
const gravitaOk = (src) => flat(gravita(vistaHealth(src))) === flat(gravita(vistaHealth(M181)))
  .replace("'ce_drift_live'::text])", "'ce_drift_live'::text,'stock_fermo'::text])");
const criteri = (v) => {
  const f = flat(v);
  return f.includes("s.synced_at >= (select coalesce(max(s1.synced_at), now()) from shopify_stock s1) - interval '2 hours'")
    && f.includes("bool_or(coalesce(s.shopify_status, 'active'::text) = 'active'::text) as attivo")
    && f.includes('where i.disponibili_da_vendere > 0::numeric')
    && f.includes('and not coalesce(sh.attivo, false)')
    && f.includes("and not exists (select 1 from non_product_codici n where upper(regexp_replace(n.codice, '\\s+'::text, '_'::text, 'g'::text)) = i.codice_norm)")
    && f.includes('and (a.ultimo_arrivo is null or a.ultimo_arrivo <= current_date - 3)')
    && f.includes('where p.quantita > 0::numeric')
    && f.includes('from v_inventory i')
    && !/\bon_shopify\b/.test(v);
};
// lista del select spezzata sulle virgole di primo livello: il nome e' l'alias dopo `as`, o la colonna se non c'e' alias
const colonne = (v) => {
  const lista = (v.match(/\nselect ([\s\S]*?)\n  from v_inventory i/) ?? ['', ''])[1];
  const pezzi = []; let prof = 0, cur = '';
  for (const ch of lista) {
    if (ch === '(') prof++;
    if (ch === ')') prof--;
    if (ch === ',' && prof === 0) { pezzi.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) pezzi.push(cur);
  return pezzi.map((p) => { const s = p.trim(); return (s.match(/\bas ([a-z_]+)$/) ?? s.match(/\.([a-z_]+)$/) ?? ['', s])[1]; });
};
const COLONNE = ['codice', 'item', 'variant', 'pezzi', 'ultimo_arrivo', 'giorni', 'stato_shopify', 'valore'];
const privilegi = (src) => [...noComments(src).matchAll(/\b(grant|revoke)\b[^;]*;/gi)].map((m) => flat(m[0]));
const PRIVILEGI = ['revoke all on public.v_stock_fermo from public, anon, authenticated, ask_ro;', 'grant select on public.v_stock_fermo to anon, authenticated, ask_ro;'];
const scrive = (src) => [...noComments(src).matchAll(/\b(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|truncate\s+[a-z_.]+)\b[^;]*/gi)].map((m) => m[0].slice(0, 60));
const innesti = (src) => /refresh_health_log|create\s+(or\s+replace\s+)?(trigger|function)|cron\.(schedule|alter_job|unschedule)|net\.http_(post|get)|\bdrop\s/i.test(noComments(src));
// l'app: colonne lette = colonne della vista; scheda fuori dal cancello delle finanze; errore detto
const selectScheda = (s) => ((s.match(/from\('v_stock_fermo'\)\s*\.select\('([^']+)'\)/) ?? ['', ''])[1]).split(',').filter(Boolean);
const fuoriFinanze = (h) => /\n\s*<StockFermo \/>\n/.test(h) && !/cfg\.finance\s*&&\s*<StockFermo/.test(h) && /import StockFermo from '\.\.\/components\/StockFermo';/.test(h);
const erroreDetto = (s) => /if \(error\) \{ setErrore\(true\); return; \}/.test(s) && /if \(errore\) return <div[^\n]*Non riesco a leggere i pezzi fermi/.test(s);

console.log('== A: v_stock_fermo ==');
const VF = vistaFermo(M190);
t('1 migrazione 0190 presente e unica a definire v_stock_fermo', M190.length > 0
  && nomi.filter((n) => /v_stock_fermo/.test(read(MIG + n)) && n !== '0190_stock_fermo.sql').length === 0);
t('2 criteri: disponibili > 0, nessuna riga attiva fresca (2 ore), non_product fuori, 3 giorni dall\'ultimo arrivo', criteri(VF), flat(VF).slice(0, 200));
t('3 colonne come la prova della migrazione', JSON.stringify(colonne(VF)) === JSON.stringify(COLONNE), JSON.stringify(colonne(VF)));
t('4 privilegi: solo select ai ruoli dell\'app, dopo un revoke all', JSON.stringify(privilegi(M190)) === JSON.stringify(PRIVILEGI), JSON.stringify(privilegi(M190)));

console.log('\n== B: v_health ==');
t('5 le 14 righe della 0181 identiche, in testa, poi solo stock_fermo', vecchieUguali(M190));
t('6 gravita\' come la 0181 con stock_fermo fra le bad', gravitaOk(M190));

console.log('\n== C: niente scritture, niente innesti, prova in fondo ==');
t('7 nessuna scrittura di dati', scrive(M190).length === 0, scrive(M190).join(' | '));
t('8 nessun trigger, funzione, cron, pg_net, drop o refresh_health_log', !innesti(M190));
{
  const pre = noComments(M190).split('\ndo $$')[1] ?? '';
  t('9 la migrazione si controlla da sola: colonne, 15 righe, conteggio uguale, criterio, privilegi',
    pre.includes("'codice:text,item:text,variant:text,pezzi:numeric,ultimo_arrivo:date,giorni:integer,stato_shopify:text,valore:numeric'")
    && pre.includes('if v_n <> 15') && pre.includes("k = 'stock_fermo' and n = v_fermi") && pre.includes('pezzi <= 0 or giorni < 3')
    && pre.includes("has_table_privilege(r, 'public.v_stock_fermo', 'insert')") && pre.includes("array['anon', 'authenticated', 'ask_ro']"));
  t('10 la prova viva della 0181 conta 15 righe', /if v_n <> 15 then raise exception 'KO V: v_health ha % righe'/.test(RLS181));
}

console.log('\n== D: l\'app ==');
t('11 la scheda legge solo colonne della vista', selectScheda(CARD).length >= 5 && selectScheda(CARD).every((c) => COLONNE.includes(c)), selectScheda(CARD).join(','));
t('12 la scheda e\' per tutto il team (fuori da cfg.finance)', fuoriFinanze(HOME));
t('13 una lettura fallita si dice', erroreDetto(CARD));
t('14 il banner di Ale non ripete stock_fermo', BANNER.includes("r.severity === 'bad' && r.k !== 'stock_fermo'"));

console.log('\n== autocontrollo: i controlli vedono un sorgente rotto ==');
{
  const rotto = (src, da, a) => { const s = src.replace(da, a); if (s === src) throw new Error('mutazione a vuoto: ' + da); return s; };
  t('15 on_shopify al posto delle righe fresche -> KO', !criteri(vistaFermo(rotto(M190, 'and not coalesce(sh.attivo, false)', 'and not i.on_shopify'))));
  t('16 senza finestra delle 2 ore -> KO', !criteri(vistaFermo(rotto(M190, "\n     and s.synced_at >= (select coalesce(max(s1.synced_at), now()) from shopify_stock s1) - interval '2 hours'", ''))));
  t('17 bozza contata come in vendita -> KO', !criteri(vistaFermo(rotto(M190, "bool_or(coalesce(s.shopify_status, 'active'::text) = 'active'::text)", "bool_or(coalesce(s.shopify_status, 'active'::text) in ('active', 'draft'))"))));
  t('18 non_product_codici dimenticato -> KO', !criteri(vistaFermo(rotto(M190, "\n   and not exists (select 1 from non_product_codici n where upper(regexp_replace(n.codice, '\\s+'::text, '_'::text, 'g'::text)) = i.codice_norm)", ''))));
  t('19 grant anche insert -> KO', JSON.stringify(privilegi(rotto(M190, 'grant select on public.v_stock_fermo', 'grant select, insert on public.v_stock_fermo'))) !== JSON.stringify(PRIVILEGI));
  t('20 una riga vecchia di v_health cambiata -> KO', !vecchieUguali(rotto(M190, "'Prodotti con giacenza negativa'", "'Prodotti con giacenza sotto zero'")));
  t('21 stock_fermo solo warn -> KO', !gravitaOk(rotto(M190, ",'stock_fermo'::text])", '])')));
  t('22 una scrittura -> KO', scrive(M190 + "\ninsert into health_log (day, k) values (current_date, 'x');\n").length === 1);
  t('23 un innesto in refresh_health_log -> KO', innesti(M190 + '\ncreate or replace function public.refresh_health_log() returns void language sql as $f$ select 1 $f$;\n'));
  t('24 scheda dietro le finanze -> KO', !fuoriFinanze(rotto(HOME, '\n          <StockFermo />\n', '\n          {cfg.finance && <StockFermo />}\n')));
  t('25 errore di lettura ingoiato -> KO', !erroreDetto(rotto(CARD, 'if (error) { setErrore(true); return; }', 'if (error) return;')));
  t('26 colonna che la vista non ha -> KO', !selectScheda(rotto(CARD, "select('codice,item,variant,pezzi,giorni,stato_shopify')", "select('codice,item,variant,pezzi,giorni,stato')")).every((c) => COLONNE.includes(c)));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
