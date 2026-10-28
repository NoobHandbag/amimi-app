// tests/ads_mensile_guardie.mjs: guardie sul SORGENTE della migr 0176 (v_ads_mensile sulla serie viva, 28-10-2026),
// del tool MCP ads_summary e dello schema nel prompt di ask-data.
//   node tests/ads_mensile_guardie.mjs
//
// Il confronto mese per mese con meta_ads_creative_daily non si fa con la chiave pubblica (base chiusa ad anon): lo fa
// la prova viva tests/ads_mensile_viste.sql (un blocco DO annullato) e tests/features.mjs controlla dalle viste
// pubbliche fonte e ultimo giorno. Qui si fissa il testo: regola PER GIORNO (Gate 2 M176-1: ads-sync se il giorno ha
// righe per ad, la serie vecchia solo per i giorni senza, nessun taglio unico su min(date)), le 8 colonne della 0020
// nello stesso ordine con le espressioni parola per parola (T1) e le due nuove in coda, grant ad ask_ro solo sulle
// viste; ads_summary senza anno fisso e con fonte/ultimo_giorno; ask-data che nomina le viste Ads vive e mai
// meta_ads_daily, un solo livello per query su v_ads_periodo_14g (G2-ADS-1), rapporti ricalcolati dalle somme
// (G2-ADS-2), colonne citate che sono colonne in uscita delle viste della 0175 (T2). Ogni controllo e' una funzione del
// testo: l'autocontrollo la prova su un sorgente rotto apposta.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const M176 = read('supabase/migrations/0176_ads_mensile_viva.sql');
const M175 = read('supabase/migrations/0175_ads_swap_cruscotto.sql');
const M020 = read('supabase/migrations/0020_ads_mensile.sql');
const MCP = read('supabase/functions/mcp/index.ts');
const ASK = read('supabase/functions/ask-data/index.ts');
const VISTE = read('tests/ads_mensile_viste.sql');
const sqlNoComments = (s) => s.replace(/--[^\n]*/g, '');
const tsNoComments = (s) => s.replace(/^\s*\/\/[^\n]*$/gm, '');
const flat = (s) => s.replace(/\s+/g, ' ').trim();

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

// voci di una select: separate dalle virgole a profondita' 0 (fuori da parentesi e stringhe) fino al from di primo
// livello. Nome in uscita = alias dopo "as" o la colonna nuda (anche "w.colonna"); null se non ha nome.
const voci = (sel) => {
  const s = sel.replace(/^\s*select\s+/i, '');
  const out = [];
  let dep = 0, q = false, cur = '', chiusa = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === "'") { if (s[i + 1] === "'") cur += s[++i]; else q = false; } continue; }
    if (ch === "'") { q = true; cur += ch; continue; }
    if (ch === '(') dep++;
    if (ch === ')') dep--;
    if (dep === 0 && /^\sfrom\s/i.test(s.slice(i, i + 6))) { out.push(cur); chiusa = true; break; }
    if (dep === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (!chiusa) return [];
  return out.map((e) => {
    const x = flat(e);
    const m = x.match(/\bas (\w+)$/) ?? x.match(/^(?:\w+\.)?(\w+)$/);
    return { expr: x, nome: m ? m[1] : null };
  });
};

const vista = (src) => (sqlNoComments(src).match(/create or replace view v_ads_mensile as[\s\S]*?;/) ?? [''])[0];
const selectFinale = (v) => (v.match(/\n\s*select extract\(year[\s\S]*?\n\s*from (?:giorni|meta_ads_daily)\b/) ?? [''])[0];
const alias = (v) => voci(selectFinale(v)).map((x) => x.nome);

// --- migrazione
// M176-1: ads-sync per ogni giorno che ha righe per ad, la serie vecchia SOLO per i giorni senza
const perGiornoOk = (v) => /\bwith giorni as \(\s+select l\.date, l\.spend, l\.impressions, l\.clicks, l\.purchases, l\.purchase_value, 'meta_ads_daily'::text as fonte\s+from meta_ads_daily l\s+where not exists \(select 1 from meta_ads_creative_daily c where c\.date = l\.date\)\s+union all\s+select c\.date, c\.spend, c\.impressions, c\.clicks, c\.purchases, c\.purchase_value, 'ads-sync'::text\s+from meta_ads_creative_daily c\s*\)/.test(v)
  && (v.match(/meta_ads_creative_daily/g) || []).length === 2 && (v.match(/\bfrom meta_ads_daily\b/g) || []).length === 1
  && !/\bmin\(date\)/.test(v) && !/\btaglio\b/.test(v) && !/cross join/.test(v) && (v.match(/\bwhere\b/g) || []).length === 2;
const colonneOk = (v) => { const p = alias(vista(M020)), n = alias(v); return p.length === 8 && n.length === 10 && n.slice(0, 8).join() === p.join() && n.slice(8).join() === 'fonte,ultimo_giorno'; };
// T1: anno, mese e i sei aggregati del select finale, parola per parola e nell'ordine
const ESPR = {
  year: 'extract(year from date)::integer as year',
  month: 'extract(month from date)::integer as month',
  spend: 'round(sum(coalesce(spend, 0::numeric)), 2) as spend',
  impressions: 'sum(coalesce(impressions, 0::bigint)) as impressions',
  clicks: 'sum(coalesce(clicks, 0::bigint)) as clicks',
  purchases: 'sum(coalesce(purchases, 0::bigint)) as purchases',
  purchase_value: 'round(sum(coalesce(purchase_value, 0::numeric)), 2) as purchase_value',
  roas: 'case when sum(coalesce(spend, 0::numeric)) > 0::numeric then round(sum(coalesce(purchase_value, 0::numeric)) / sum(coalesce(spend, 0::numeric)), 2) else 0::numeric end as roas',
};
const aggregatiOk = (v) => { const vs = voci(selectFinale(v)); return vs.length === 10 && Object.entries(ESPR).every(([k, e], i) => vs[i].nome === k && vs[i].expr === e); };
const roasOk = (v) => voci(selectFinale(v)).some((x) => x.nome === 'roas' && x.expr === ESPR.roas);
const fonteOk = (v) => /case when min\(fonte\) = max\(fonte\) then min\(fonte\) else 'misto'::text end as fonte,\s+max\(date\) as ultimo_giorno/.test(v)
  && /'meta_ads_daily'::text as fonte/.test(v);
const ordineOk = (v) => /\n\s*order by \(extract\(year from date\)::integer\), \(extract\(month from date\)::integer\);$/.test(v);
const VISTE_ASK = ['v_ads_periodo_14g', 'v_ads_swap', 'v_ads_weekly_account', 'v_ads_creative_status'];
const grantOk = (src) => {
  const s = sqlNoComments(src);
  const g = s.match(/\ngrant select on ([^;]+) to ask_ro;/);
  return !!g && g[1].split(',').map((x) => x.trim()).sort().join() === [...VISTE_ASK].sort().join()
    && !/(grant|revoke)[^;]*\bmeta_\w+/i.test(s) && !/drop view/i.test(s) && !/(grant|revoke)[^;]*v_ads_mensile/i.test(s)
    && /\ncreate or replace view v_ads_mensile as\n/.test(s) && /^begin;$/m.test(s) && /^commit;$/m.test(s);
};

console.log('\n== 0176: v_ads_mensile, regola per giorno e colonne ==');
const V = vista(M176);
{
  t('1  vista trovata nel sorgente', V.length > 500, V.length);
  t('2  M176-1: serie vecchia solo per i giorni senza righe in meta_ads_creative_daily (not exists sul giorno), ads-sync senza filtri, nessun taglio su min(date)', perGiornoOk(V));
  t('3  le 8 colonne della 0020 nello stesso ordine, poi fonte e ultimo_giorno', colonneOk(V), alias(V).join(','));
  t('4  stessa regola del roas (0 a spesa 0)', roasOk(V));
  t('4b T1: anno, mese e i sei aggregati del select finale parola per parola', aggregatiOk(V), voci(selectFinale(V)).map((x) => x.expr).join(' | '));
  t('5  fonte ads-sync/meta_ads_daily/misto e ultimo_giorno = max(date)', fonteOk(V));
  t('6  order by anno, mese', ordineOk(V));
  t('7  grant select ad ask_ro sulle quattro viste Ads, niente sulle basi meta_*, niente drop, una transazione', grantOk(M176));
  t('8  commento sulla vista (regola per giorno, fonte)', /\ncomment on view v_ads_mensile is '[^']*Per ogni giorno[^']*fonte[^']*';/.test(M176));
}

// --- prova viva: tests/ads_mensile_viste.sql (T4)
const vivaOk = (s) => {
  const c = sqlNoComments(s);
  return (c.match(/\bdo \$t\$/g) || []).length === 1 && /raise exception 'TEST_OK: [^']*\(rollback voluto\)'/.test(c) && /end \$t\$;\s*$/.test(c)
    && /where not exists \(select 1 from meta_ads_creative_daily c where c\.date = l\.date\)/.test(c)
    && ['C', 'G', 'M', 'V', 'F', 'U', 'T', 'R', 'A'].every((k) => new RegExp(`raise exception 'KO ${k}[ :]`).test(c))
    && /ask_select\(/.test(c) && /'42501'/.test(c)
    && VISTE_ASK.concat('v_ads_mensile').every((x) => c.includes(`'${x}'`));
};
console.log('\n== prova viva tests/ads_mensile_viste.sql ==');
t('9  un blocco DO che finisce in TEST_OK, regola per giorno ricalcolata a mano, 9 controlli (C G M V F U T R A), ask_select sulle 5 viste e 42501', vivaOk(VISTE));

// --- mcp ads_summary
const caseAds = (src) => (tsNoComments(src).match(/case 'ads_summary': \{[\s\S]*?\n {4}\}/) ?? [''])[0];
const toolAds = (src) => (src.match(/\{ name: 'ads_summary', description: ("[^\n]*"|'[^\n]*'),/) ?? [''])[0];
const mcpOk = (src) => {
  const c = caseAds(src);
  return c.length > 0 && !/\.eq\('year'/.test(c) && !/2026/.test(c)
    && /sb\.from\('v_ads_mensile'\)\.select\('year,month,spend,purchases,purchase_value,roas,fonte,ultimo_giorno'\)\.order\('year'\)\.order\('month'\)/.test(c)
    && /await retryOnce\(\(\) => sb\.from\('v_ads_mensile'\)/.test(c) && /if \(error\) return readFailed\('v_ads_mensile', error\.message\);/.test(c);
};
const descOk = (src) => { const d = toolAds(src); return /ads-sync/.test(d) && /20-06-2026/.test(d) && /attribuiti da Meta/.test(d) && /ask_data/.test(d) && /v_ads_swap/.test(d) && /v_ads_periodo_14g/.test(d); };

console.log('\n== mcp: tool ads_summary ==');
{
  t('10 nessun anno fisso, tutti i mesi in ordine anno/mese, con fonte e ultimo_giorno, retryOnce + readFailed', mcpOk(MCP), caseAds(MCP).slice(0, 200));
  t('11 descrizione: serie viva da ads-sync dal 20-06-2026, acquisti attribuiti da Meta, rimando ad ask_data per creativita\' e 14g', descOk(MCP));
}

// --- ask-data SCHEMA
const schema = (src) => (src.match(/const SCHEMA = `([\s\S]*?)`;/) ?? [null, ''])[1];
const riga = (s, rel) => (s.match(new RegExp(`\\n- ${rel}\\([^\\n]*`)) ?? [''])[0];
const colsIn = (s, rel) => ((s.match(new RegExp(`- ${rel}\\(([^)]*)\\)`)) ?? [null, ''])[1]).split(',').map((x) => x.trim()).filter(Boolean);
// T2: colonne in uscita del select finale di una vista della 0175 (corpo fino al grant che la segue)
const vista175 = (src, rel) => (sqlNoComments(src).match(new RegExp(`create or replace view ${rel} as[\\s\\S]*?\\ngrant select on ${rel}\\b`)) ?? [''])[0];
const uscita175 = (src, rel) => { const v = vista175(src, rel); const i = v.lastIndexOf('\n select '); return i < 0 ? [] : voci(v.slice(i)).map((x) => x.nome); };
// le stesse liste copiate dalla 0175 (uguali a pg_attribute in produzione il 28-10): parser e migrazione d'accordo
const USCITA = {
  v_ads_periodo_14g: 'level,window_key,since,until,as_of,object_id,object_name,campaign_id,campaign_name,adset_id,adset_name,object_type,effective_status,spend,impressions,reach,frequency,clicks,link_clicks,link_ctr,cpc_link,cpm,landing_page_views,lpv_rate,add_to_cart,atc_rate,initiate_checkout,purchases,purchase_value,roas,cpa,video_3s_views,hook_rate,thruplays,hold_rate,days_with_spend',
  v_ads_swap: 'as_of,ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,effective_status,object_type,frame_url,image_url,thumbnail_url,pubblico,first_day,giorni_live,spend_7,impressions_7,link_ctr_7,link_ctr_base,impressions_base,ctr_var_pct,cpm_7,cpm_base,cpm_var_pct,freq_7g,freq_soglia,spend_14,purchases_14,value_14,cpa_14,roas_14,hook_7,hook_base,quota_adset_7,pct_oos,segnale_freq,segnale_ctr,segnale_spesa,stato,motivo,ordine,freq_mancante,freq_al',
};
const colsEsistono = (s, rel) => { const u = new Set(USCITA[rel].split(',')); const c = colsIn(s, rel); return c.length > 0 && c.every((x) => u.has(x)); };
const LIVELLO = "rows of different levels repeat the same spend and value: ALWAYS filter exactly one level (level='account' for the account total, 'campaign' + campaign_name for a campaign, 'adset' + adset_name, 'ad' + object_name for a creative) and select level and window_key; never sum or average across levels";
const RAPPORTI = 'for more than one row compute ROAS = SUM(purchase_value)/SUM(spend), CPA = SUM(spend)/SUM(purchases), CTR = SUM(link_clicks)/SUM(impressions); never AVG of the ratio columns';
const livelloOk = (s) => riga(s, 'v_ads_periodo_14g').includes(LIVELLO) && s.split(LIVELLO).length === 2;
const regolaMeta = (s) => (s.match(/\nMeta Ads questions use [^\n]*/) ?? [''])[0];
const rapportiOk = (s) => regolaMeta(s).includes(RAPPORTI) && !/\bAVG\s*\(/i.test(s);
const askOk = (src) => {
  const s = schema(src);
  return colsIn(s, 'v_ads_mensile').join() === 'year,month,spend,impressions,clicks,purchases,purchase_value,roas,fonte,ultimo_giorno'
    && colsIn(s, 'v_ads_periodo_14g').length >= 15 && colsIn(s, 'v_ads_swap').length >= 10
    && /never meta_ads_daily/.test(s) && /Meta-attributed \(not Shopify orders\)/.test(s)
    && !/- meta_ads_(creative_)?daily\(/.test(s) && /'cur14'/.test(s) && /'cambia'/.test(s);
};

console.log('\n== ask-data: schema nel prompt ==');
{
  const S = schema(ASK);
  t('12 schema trovato', S.length > 1000, S.length);
  t('13 v_ads_mensile (con fonte, ultimo_giorno), v_ads_periodo_14g, v_ads_swap e la regola "never meta_ads_daily"', askOk(ASK));
  t('14 T2: le colonne in uscita lette dal select finale della 0175 sono quelle copiate a mano (v_ads_periodo_14g, v_ads_swap)',
    uscita175(M175, 'v_ads_periodo_14g').join() === USCITA.v_ads_periodo_14g && uscita175(M175, 'v_ads_swap').join() === USCITA.v_ads_swap,
    uscita175(M175, 'v_ads_periodo_14g').join() + ' / ' + uscita175(M175, 'v_ads_swap').join());
  t('15 ogni colonna citata per v_ads_periodo_14g e\' una colonna in uscita della vista', colsEsistono(S, 'v_ads_periodo_14g'), colsIn(S, 'v_ads_periodo_14g').filter((x) => !USCITA.v_ads_periodo_14g.split(',').includes(x)).join(','));
  t('16 ogni colonna citata per v_ads_swap e\' una colonna in uscita della vista', colsEsistono(S, 'v_ads_swap'), colsIn(S, 'v_ads_swap').filter((x) => !USCITA.v_ads_swap.split(',').includes(x)).join(','));
  t('17 le colonne di v_ads_mensile nel prompt sono quelle della 0176, nello stesso ordine', colsIn(S, 'v_ads_mensile').join() === alias(V).join());
  t('18 G2-ADS-1: la riga di v_ads_periodo_14g impone un solo livello per query (level e window_key in uscita, mai somme fra livelli)', livelloOk(S));
  t('19 G2-ADS-2: la regola Meta ricalcola ROAS, CPA e CTR dalle somme e nessun AVG( nel prompt', rapportiOk(S));
}

console.log('\n== autocontrollo: i controlli vedono un sorgente rotto ==');
{
  const rotto = (src, da, a) => { const s = src.replace(da, a); if (s === src) throw new Error('mutazione a vuoto: ' + String(da).slice(0, 60)); return s; };
  const NE = '\n    where not exists (select 1 from meta_ads_creative_daily c where c.date = l.date)';
  t('20 serie vecchia senza filtro (giorni contati due volte) -> KO', !perGiornoOk(vista(rotto(M176, NE, ''))));
  t('20b not exists girato in exists -> KO', !perGiornoOk(vista(rotto(M176, 'where not exists (select 1', 'where exists (select 1'))));
  t('20c not exists su un intervallo (c.date >= l.date) invece che sul giorno -> KO', !perGiornoOk(vista(rotto(M176, 'where c.date = l.date', 'where c.date >= l.date'))));
  t('20d ads-sync filtrata da luglio -> KO', !perGiornoOk(vista(rotto(M176, 'from meta_ads_creative_daily c\n )', "from meta_ads_creative_daily c where c.date >= '2026-07-01'\n )"))));
  t('20e M176-1: taglio unico su min(date) rimesso (la forma di prima) -> KO', !perGiornoOk(vista(rotto(M176, NE,
    '\n     cross join (select min(date) as d from meta_ads_creative_daily) taglio\n    where taglio.d is null or l.date < taglio.d'))));
  t('20f serie vecchia coi click presi dalle impression -> KO', !perGiornoOk(vista(rotto(M176, 'l.impressions, l.clicks,', 'l.impressions, l.impressions,'))));
  t('21 fonte prima di roas -> KO', !colonneOk(vista(rotto(M176, `             else 0::numeric end as roas,
        case when min(fonte) = max(fonte) then min(fonte) else 'misto'::text end as fonte,`, `             else 0::numeric end as fonte_x,
        case when min(fonte) = max(fonte) then min(fonte) else 'misto'::text end as roas,`))));
  t('21b roas senza il caso spesa 0 -> KO', !roasOk(vista(rotto(M176, 'else 0::numeric end as roas', 'end as roas'))));
  {
    const clickDaImpr = vista(rotto(M176, 'sum(coalesce(clicks, 0::bigint)) as clicks', 'sum(coalesce(impressions, 0::bigint)) as clicks'));
    t('21c T1: clicks del select finale presi dalle impression -> KO (le sole colonne non lo vedono)', !aggregatiOk(clickDaImpr) && colonneOk(clickDaImpr));
  }
  t('21d T1: spesa senza round -> KO', !aggregatiOk(vista(rotto(M176, 'round(sum(coalesce(spend, 0::numeric)), 2) as spend', 'sum(coalesce(spend, 0::numeric)) as spend'))));
  t('22 grant ad ask_ro anche sulla base per ad -> KO', !grantOk(rotto(M176, 'v_ads_creative_status to ask_ro;', 'v_ads_creative_status to ask_ro;\ngrant select on meta_ads_creative_daily to ask_ro;')));
  t('22b drop della vista -> KO', !grantOk(rotto(M176, '\ncreate or replace view v_ads_mensile as\n', '\ndrop view v_ads_mensile;\ncreate or replace view v_ads_mensile as\n')));
  t('22c una vista Ads in meno ad ask_ro -> KO', !grantOk(rotto(M176, 'v_ads_weekly_account, ', '')));
  t('23 prova viva senza il controllo dei grant (A) -> KO', !vivaOk(rotto(VISTE, /raise exception 'KO A/g, "raise exception 'KX A")));
  t('23b prova viva che non chiude in TEST_OK -> KO', !vivaOk(rotto(VISTE, "raise exception 'TEST_OK: ", "raise notice 'TEST_OK: ")));
  t('24 mcp con l\'anno 2026 rimesso -> KO', !mcpOk(rotto(MCP, ".order('year').order('month')", ".eq('year', 2026).order('month')")));
  t('24b mcp senza fonte e ultimo_giorno -> KO', !mcpOk(rotto(MCP, ',fonte,ultimo_giorno', '')));
  t('24c mcp senza retryOnce -> KO', !mcpOk(rotto(MCP, "await retryOnce(() => sb.from('v_ads_mensile')", "await (() => sb.from('v_ads_mensile')")));
  t('24d descrizione senza il rimando ad ask_data -> KO', !descOk(rotto(MCP, 'usa ask_data (viste v_ads_swap, v_ads_periodo_14g)', 'chiedi altrove')));
  t('25 ask-data senza "never meta_ads_daily" -> KO', !askOk(rotto(ASK, '; never meta_ads_daily;', ';')));
  t('25b ask-data senza v_ads_swap -> KO', !askOk(ASK.replace(/\n- v_ads_swap\([^\n]*/, '')));
  t('25c ask-data che elenca meta_ads_daily come relazione -> KO', !askOk(rotto(ASK, '\n- suppliers(name)', '\n- meta_ads_daily(date, spend)\n- suppliers(name)')));
  t('26 T2: colonna interna della vista (k.impr_min) citata in v_ads_swap -> KO', !colsEsistono(schema(rotto(ASK, 'v_ads_swap(ad_name,', 'v_ads_swap(ad_name, impr_min,')), 'v_ads_swap'));
  t('26b T2: colonna interna (impr_video) citata in v_ads_periodo_14g -> KO', !colsEsistono(schema(rotto(ASK, 'v_ads_periodo_14g(level,', 'v_ads_periodo_14g(level, impr_video,')), 'v_ads_periodo_14g'));
  t('26c T2: colonna inventata in v_ads_swap -> KO', !colsEsistono(schema(rotto(ASK, 'v_ads_swap(ad_name,', 'v_ads_swap(ad_name, ctr_inventato,')), 'v_ads_swap'));
  t('26d T2: il parser non prende k.impr_min fra le colonne in uscita di v_ads_swap', !uscita175(M175, 'v_ads_swap').includes('impr_min') && M175.includes('k.impr_min'));
  t('27 G2-ADS-1: riga di v_ads_periodo_14g senza "ALWAYS filter exactly one level" -> KO', !livelloOk(schema(rotto(ASK, 'ALWAYS filter exactly one level', 'filter a level'))));
  t('27b G2-ADS-1: regola dei livelli spostata fuori dalla riga di v_ads_periodo_14g -> KO', !livelloOk(schema(rotto(ASK, '; ' + LIVELLO, '').replace('\nRules: ', '\n' + LIVELLO + '\nRules: '))));
  t('28 G2-ADS-2: regola Meta senza i rapporti dalle somme -> KO', !rapportiOk(schema(rotto(ASK, '; ' + RAPPORTI, ''))));
  t('28b G2-ADS-2: prompt che suggerisce AVG(roas) -> KO', !rapportiOk(schema(rotto(ASK, 'never AVG of the ratio columns', 'never AVG of the ratio columns; AVG(roas) is fine for one campaign'))));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
