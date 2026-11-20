// tests/stock_fermo_guardie.mjs: guardie sul SORGENTE delle migr 0190 e 0203 (pezzi a magazzino non in vendita sul sito, 09-11-2026)
//   node tests/stock_fermo_guardie.mjs
//
// Il 09-11 erano fermi 107 pezzi su 13 codici e nessuno schermo lo diceva. Qui si fissa il testo: v_stock_fermo conta solo
// i pezzi disponibili da vendere senza una riga Shopify ATTIVA fra quelle dell'ultimo giro di sync (le righe vecchie del
// mirror non salvano un prodotto tolto dal sito), fermi da almeno 3 giorni, fuori non_product_codici; sola lettura per i
// ruoli dell'app; v_health tiene identiche le 14 righe della 0181 e aggiunge stock_fermo, 'bad'; nessuna scrittura e nessun
// innesto. Lato app: la scheda e' per tutto il team (non dietro cfg.finance), legge colonne che la vista ha, dice quando la
// lettura fallisce, e il banner di Ale non la ripete. L'autocontrollo prova ogni rilevatore su un sorgente rotto apposta.
// 20-11 (migr 0203, chiesta da Dan): la scheda deve esistere solo per un problema vero. La vista viva e' quella della 0203:
// stesso corpo della 0190, fuori i codici di stock_fermo_esclusi (tenuti fuori dal sito apposta) e soglia a 30 giorni invece
// di 3. La 0190 resta com'era (storia); i criteri, le colonne e v_health si controllano sulla 0203.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const MIG = 'supabase/migrations/';
const nomi = readdirSync(ROOT + MIG);
const M190 = nomi.includes('0190_stock_fermo.sql') ? read(MIG + '0190_stock_fermo.sql') : '';
const M203 = nomi.includes('0203_stock_fermo_solo_problemi.sql') ? read(MIG + '0203_stock_fermo_solo_problemi.sql') : '';
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
const vecchieUguali = (src, giorni = 3) => {
  const prima = flat(righeChecks(vistaHealth(M181)));
  const ora = flat(righeChecks(vistaHealth(src)));
  return prima.length > 2000 && ora === prima + ` union all select 'stock_fermo', 'Prodotti con pezzi a magazzino non in vendita sul sito da almeno ${giorni} giorni', (select count(*) from v_stock_fermo)`;
};
const gravitaOk = (src) => flat(gravita(vistaHealth(src))) === flat(gravita(vistaHealth(M181)))
  .replace("'ce_drift_live'::text])", "'ce_drift_live'::text,'stock_fermo'::text])");
// soglia: 3 giorni nella 0190, 30 dalla 0203, che in piu' salta i codici di stock_fermo_esclusi
const ESCLUSI = "and not exists (select 1 from stock_fermo_esclusi e where upper(regexp_replace(e.codice, '\\s+'::text, '_'::text, 'g'::text)) = f.codice_norm)";
const criteri = (v, giorni = 3) => {
  const f = flat(v);
  return f.includes("s.synced_at >= (select coalesce(max(s1.synced_at), now()) from shopify_stock s1) - interval '2 hours'")
    && f.includes("bool_or(coalesce(s.shopify_status, 'active'::text) = 'active'::text) as attivo")
    && f.includes('where i.disponibili_da_vendere > 0::numeric')
    && f.includes('where not coalesce(sh.attivo, false)')
    && f.includes("and not exists (select 1 from non_product_codici n where upper(regexp_replace(n.codice, '\\s+'::text, '_'::text, 'g'::text)) = f.codice_norm)")
    && f.includes(`and (f.fermo_dal is null or f.fermo_dal <= f.oggi - ${giorni});`)
    && (giorni === 3 ? !f.includes('stock_fermo_esclusi') : f.includes(ESCLUSI + ' and (f.fermo_dal is null'))
    && f.includes('where p.quantita > 0::numeric and p.data is not null')
    && f.includes('from v_inventory i')
    && fifo(v) && romaOk(v)
    && !/\bon_shopify\b/.test(v) && !/current_date/.test(v);
};
// FIFO (Gate 2 del 09-11): il pezzo piu' vecchio ancora a magazzino, non l'ultimo arrivo
const fifo = (v) => {
  const f = flat(v);
  return f.includes('sum(p.quantita) over (partition by p.codice_norm order by p.data desc, p.id rows unbounded preceding) as cum')
    && f.includes('coalesce((select max(a.data) from arr a where a.codice_norm = i.codice_norm and a.cum >= i.disponibili_da_vendere), (select min(a.data) from arr a where a.codice_norm = i.codice_norm)) as fermo_dal')
    && !/max\(p\.data\)/.test(v);
};
const romaOk = (v) => flat(v).includes("(now() at time zone 'Europe/Rome')::date as oggi") && flat(v).includes('f.oggi - f.fermo_dal as giorni');
// lista del select spezzata sulle virgole di primo livello: il nome e' l'alias dopo `as`, o la colonna se non c'e' alias
const colonne = (v) => {
  const lista = (v.match(/\nselect ([\s\S]*?)\n  from fermi f/) ?? ['', ''])[1];
  const pezzi = []; let prof = 0, cur = '';
  for (const ch of lista) {
    if (ch === '(') prof++;
    if (ch === ')') prof--;
    if (ch === ',' && prof === 0) { pezzi.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) pezzi.push(cur);
  return pezzi.map((p) => { const s = p.trim(); return (s.match(/\bas ([a-z_]+)$/) ?? s.match(/\.([a-z_]+)$/) ?? ['', s])[1]; });
};
const COLONNE = ['codice', 'item', 'variant', 'pezzi', 'fermo_dal', 'giorni', 'stato_shopify', 'valore'];
const privilegi = (src) => [...noComments(src).matchAll(/\b(grant|revoke)\b[^;]*;/gi)].map((m) => flat(m[0]));
const PRIVILEGI = ['revoke all on public.v_stock_fermo from public, anon, authenticated, ask_ro;', 'grant select on public.v_stock_fermo to anon, authenticated, ask_ro;'];
const PRIVILEGI_203 = ['revoke all on public.stock_fermo_esclusi from public, anon, authenticated, ask_ro;', ...PRIVILEGI];
const scrive = (src) => [...noComments(src).matchAll(/\b(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|truncate\s+[a-z_.]+)\b[^;]*/gi)].map((m) => m[0].slice(0, 60));
// i codici seminati in stock_fermo_esclusi: la prima stringa di OGNI tupla dei values (qualunque testo, anche due per riga)
const semina = (src) => { const b = (noComments(src).match(/insert into public\.stock_fermo_esclusi[\s\S]*?;/) ?? [''])[0].split(/\bvalues\b/)[1] ?? ''; return [...b.matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*'(?:[^']|'')*'\s*,\s*'(?:[^']|'')*'\s*\)/g)].map((m) => m[1]); };
const scriveIntere = (src) => [...noComments(src).split('\ndo $$')[0].matchAll(/\b(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|truncate\s+[a-z_.]+)\b[^;]*/gi)].map((m) => m[0]);
const innesti = (src) => /refresh_health_log|create\s+(or\s+replace\s+)?(trigger|function)|cron\.(schedule|alter_job|unschedule)|net\.http_(post|get)|\bdrop\s/i.test(noComments(src));
// l'app: colonne lette = colonne della vista; scheda fuori dal cancello delle finanze; errore detto
const selectScheda = (s) => ((s.match(/from\('v_stock_fermo'\)\s*\.select\('([^']+)'\)/) ?? ['', ''])[1]).split(',').filter(Boolean);
const fuoriFinanze = (h) => /\n\s*<StockFermo \/>\n/.test(h) && !/cfg\.finance\s*&&\s*<StockFermo/.test(h) && /import StockFermo from '\.\.\/components\/StockFermo';/.test(h);
const erroreDetto = (s) => /if \(error\) \{ setErrore\(true\); return; \}/.test(s) && /if \(errore\) return <div[^\n]*Non riesco a leggere i pezzi fermi/.test(s);

console.log('== A: v_stock_fermo ==');
const VF = vistaFermo(M203);
const VF190 = vistaFermo(M190);
// 09-11 (0191, notifica dei pezzi fermi): un'altra migrazione puo' NOMINARE la vista (la 0191 ne controlla il privilegio),
// non ridefinirla o cambiarne i privilegi
t('1 migrazioni 0190 e 0203 presenti e uniche a definire v_stock_fermo o a cambiarne i privilegi', M190.length > 0 && M203.length > 0
  && nomi.filter((n) => n !== '0190_stock_fermo.sql' && n !== '0203_stock_fermo_solo_problemi.sql' && /(create\s+(or\s+replace\s+)?view|drop\s+view|alter\s+view|grant|revoke)[^;]*v_stock_fermo/i.test(noComments(read(MIG + n)))).length === 0);
t('2 criteri (0203): disponibili > 0, nessuna riga attiva fresca (2 ore), non_product e esclusi fuori, 30 giorni dal pezzo piu\' vecchio', criteri(VF, 30), flat(VF).slice(-300));
t('2b la 0190 resta com\'era (3 giorni, nessuna esclusione): la storia non si riscrive', criteri(VF190, 3));
t('2c fra 0190 e 0203 la vista cambia solo per l\'esclusione e la soglia', flat(VF) === flat(VF190).replace('and (f.fermo_dal is null or f.fermo_dal <= f.oggi - 3);', ESCLUSI + ' and (f.fermo_dal is null or f.fermo_dal <= f.oggi - 30);'));
t('3 colonne come la prova della migrazione', JSON.stringify(colonne(VF)) === JSON.stringify(COLONNE), JSON.stringify(colonne(VF)));
t('4 privilegi: solo select ai ruoli dell\'app, dopo un revoke all', JSON.stringify(privilegi(M190)) === JSON.stringify(PRIVILEGI), JSON.stringify(privilegi(M190)));
t('4b 0203: stessi privilegi sulla vista, nessuno sulla tabella degli esclusi (RLS accesa, niente grant)', JSON.stringify(privilegi(M203)) === JSON.stringify(PRIVILEGI_203)
  && /alter table public\.stock_fermo_esclusi enable row level security;/.test(noComments(M203)) && !/create\s+policy/i.test(noComments(M203)) && !/disable\s+row\s+level|no\s+force|security_invoker/i.test(noComments(M203)), JSON.stringify(privilegi(M203)));

console.log('\n== B: v_health ==');
t('5 le 14 righe della 0181 identiche, in testa, poi solo stock_fermo', vecchieUguali(M190));
t('6 gravita\' come la 0181 con stock_fermo fra le bad', gravitaOk(M190));
t('5b 0203: le stesse 15 righe, cambia solo il testo di stock_fermo (30 giorni)', vecchieUguali(M203, 30) && !vecchieUguali(M203, 3));
t('6b 0203: gravita\' identiche alla 0190', gravitaOk(M203) && flat(gravita(vistaHealth(M203))) === flat(gravita(vistaHealth(M190))));

console.log('\n== C: niente scritture, niente innesti, prova in fondo ==');
t('7 nessuna scrittura di dati', scrive(M190).length === 0, scrive(M190).join(' | '));
t('8 nessun trigger, funzione, cron, pg_net, drop o refresh_health_log', !innesti(M190));
t('7b 0203: tre scritture e basta: la semina degli esclusi (on conflict do nothing) coi tre codici decisi da Dan il 20-11, il testo del tema magazzino, la pulizia del registro stock_fermo', scrive(M203).length === 3
  && /^update public\.push_temi set descrizione = 'Prodotti con pezzi a magazzino da almeno 30 giorni e nessuna pagina attiva sul sito' where key = 'magazzino' and descrizione = 'Prodotti con pezzi a magazzino da almeno 3 giorni e nessuna pagina attiva sul sito'$/.test(flat(scriveIntere(M203)[1] ?? ''))
  && flat(scriveIntere(M203)[2] ?? '') === "delete from public.push_eventi_inviati r where r.evento = 'stock_fermo' and r.chiave like 'fermo:%' and not exists (select 1 from v_stock_fermo f where upper(f.codice) = upper(split_part(r.chiave, ':', 2)))"
  && /^insert into public\.stock_fermo_esclusi \(codice, motivo, chi\)/.test(scrive(M203)[0])
  && JSON.stringify(semina(M203)) === JSON.stringify(['AGATA_BAG_PALLIETTES_ADOC_ARGENTO_PER_SPOSA', 'AGATA_BAG_PERSONALIZZAZIONE_SPOSA', 'LEA_BAG_CAVALLINO_CHOCOLATE'])
  && /\non conflict \(codice\) do nothing;/.test(noComments(M203)), scrive(M203).join(' | '));
t('8b 0203: nessun trigger, funzione, cron, pg_net, drop o refresh_health_log', !innesti(M203));
{
  const pre = noComments(M190).split('\ndo $$')[1] ?? '';
  t('9 la migrazione si controlla da sola: colonne, 15 righe, conteggio uguale, criterio, privilegi',
    pre.includes("'codice:text,item:text,variant:text,pezzi:numeric,fermo_dal:date,giorni:integer,stato_shopify:text,valore:numeric'")
    && pre.includes('if v_n <> 15') && pre.includes("k = 'stock_fermo' and n = v_fermi") && pre.includes('pezzi <= 0 or giorni < 3')
    && pre.includes("has_table_privilege(r, 'public.v_stock_fermo', 'insert')") && pre.includes("array['anon', 'authenticated', 'ask_ro']"));
  const pre3 = noComments(M203).split('\ndo $$')[1] ?? '';
  t('9b la 0203 si controlla da sola: colonne, 15 righe, testo a 30 giorni, criterio, esclusi fuori e in anagrafica, RLS, privilegi',
    pre3.includes("'codice:text,item:text,variant:text,pezzi:numeric,fermo_dal:date,giorni:integer,stato_shopify:text,valore:numeric'")
    && pre3.includes('if v_n <> 15') && pre3.includes("k = 'stock_fermo' and n = v_fermi") && pre3.includes('pezzi <= 0 or giorni < 30')
    && pre3.includes("label = 'Prodotti con pezzi a magazzino non in vendita sul sito da almeno 30 giorni'")
    && pre3.includes('from v_stock_fermo f join stock_fermo_esclusi e') && pre3.includes('un codice escluso non esiste in anagrafica')
    && pre3.includes("relrowsecurity from pg_class where oid = 'public.stock_fermo_esclusi'::regclass")
    && pre3.includes("has_table_privilege(r, 'public.stock_fermo_esclusi', 'select')") && pre3.includes("array['anon', 'authenticated', 'ask_ro']")
    && pre3.includes("has_table_privilege('service_role', 'public.v_stock_fermo', 'select')")
    && pre3.includes("descrizione like '%almeno 3 giorni%'") && pre3.includes('nel registro restano righe stock_fermo di codici fuori elenco'));
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
  t('15 on_shopify al posto delle righe fresche -> KO', !criteri(vistaFermo(rotto(M203, 'where not coalesce(sh.attivo, false)', 'where not f.on_shopify')), 30));
  t('16 senza finestra delle 2 ore -> KO', !criteri(vistaFermo(rotto(M203, "\n     and s.synced_at >= (select coalesce(max(s1.synced_at), now()) from shopify_stock s1) - interval '2 hours'", '')), 30));
  t('17 bozza contata come in vendita -> KO', !criteri(vistaFermo(rotto(M203, "bool_or(coalesce(s.shopify_status, 'active'::text) = 'active'::text)", "bool_or(coalesce(s.shopify_status, 'active'::text) in ('active', 'draft'))")), 30));
  t('18 non_product_codici dimenticato -> KO', !criteri(vistaFermo(rotto(M203, "\n   and not exists (select 1 from non_product_codici n where upper(regexp_replace(n.codice, '\\s+'::text, '_'::text, 'g'::text)) = f.codice_norm)", '')), 30));
  t('19 grant anche insert -> KO', JSON.stringify(privilegi(rotto(M190, 'grant select on public.v_stock_fermo', 'grant select, insert on public.v_stock_fermo'))) !== JSON.stringify(PRIVILEGI));
  t('20 una riga vecchia di v_health cambiata -> KO', !vecchieUguali(rotto(M190, "'Prodotti con giacenza negativa'", "'Prodotti con giacenza sotto zero'")));
  t('21 stock_fermo solo warn -> KO', !gravitaOk(rotto(M190, ",'stock_fermo'::text])", '])')));
  t('22 una scrittura -> KO', scrive(M190 + "\ninsert into health_log (day, k) values (current_date, 'x');\n").length === 1);
  t('23 un innesto in refresh_health_log -> KO', innesti(M190 + '\ncreate or replace function public.refresh_health_log() returns void language sql as $f$ select 1 $f$;\n'));
  t('24 scheda dietro le finanze -> KO', !fuoriFinanze(rotto(HOME, '\n          <StockFermo />\n', '\n          {cfg.finance && <StockFermo />}\n')));
  t('25 errore di lettura ingoiato -> KO', !erroreDetto(rotto(CARD, 'if (error) { setErrore(true); return; }', 'if (error) return;')));
  t('26 colonna che la vista non ha -> KO', !selectScheda(rotto(CARD, "select('codice,item,variant,pezzi,giorni,stato_shopify')", "select('codice,item,variant,pezzi,giorni,stato')")).every((c) => COLONNE.includes(c)));
  t('27 giorni dall\'ULTIMO arrivo (un riordino nasconde i fermi) -> KO', !criteri(vistaFermo(rotto(M203, "coalesce((select max(a.data) from arr a where a.codice_norm = i.codice_norm and a.cum >= i.disponibili_da_vendere),", "coalesce((select max(a.data) from arr a where a.codice_norm = i.codice_norm),")), 30));
  t('29 0203: esclusione dimenticata -> KO', !criteri(vistaFermo(rotto(M203, "\n   " + ESCLUSI, '')), 30));
  t('30 0203: soglia rimessa a 3 giorni -> KO', !criteri(vistaFermo(rotto(M203, 'f.fermo_dal <= f.oggi - 30', 'f.fermo_dal <= f.oggi - 3')), 30));
  t('31 0203: grant sulla tabella degli esclusi -> KO', JSON.stringify(privilegi(M203 + '\ngrant select on public.stock_fermo_esclusi to anon;\n')) !== JSON.stringify(PRIVILEGI_203));
  t('32 0203: un codice in piu\' nella semina (anche minuscolo, anche sulla stessa riga) -> KO', semina(rotto(M203, "\n  ('LEA_BAG_CAVALLINO_CHOCOLATE',", "\n  ('Lea Bag Cocco', 'x', 'x'), ('LEA_BAG_CAVALLINO_CHOCOLATE',")).length === 4);
  t('34 0203: una scrittura in piu\' -> KO', scrive(rotto(M203, '\n-- (e) prova', "\ndelete from public.push_eventi_inviati where evento = 'stock_fermo';\n-- (e) prova")).length === 4);
  t('33 0203: testo di v_health rimasto a 3 giorni -> KO', !vecchieUguali(rotto(M203, "sul sito da almeno 30 giorni',\n    (select count(*) from v_stock_fermo)", "sul sito da almeno 3 giorni',\n    (select count(*) from v_stock_fermo)"), 30));
  t('28 giorni sul calendario del server (UTC) -> KO', !criteri(vistaFermo(rotto(M203, "(now() at time zone 'Europe/Rome')::date as oggi", 'current_date as oggi')), 30));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
