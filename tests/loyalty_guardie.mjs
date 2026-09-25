// tests/loyalty_guardie.mjs — guardie sul SORGENTE del modulo Premia (loyalty-proxy v11, loyalty-orders v3, migr 0136,
// pagina Area Membri, config.toml). Quest audit Area Membri, Fase 6 (2026-09-21).
//   node tests/loyalty_guardie.mjs
//
// Classe non collaudabile a runtime (compare solo con tap concorrenti, firme rigiocate, PostgREST che risponde male o
// Shopify che ritira una versione): si legge il sorgente e si verifica che ogni fix resti al suo posto. Ogni pin cita
// il finding dell'audit (Cowork12/projects/Premia_Area_Membri_2026-09/07_AUDIT_1_logico.md e 07_AUDIT_2_tecnico.md)
// che lo ha generato. Le prove vive (RPC sull'account di test, smoke di produzione) stanno in tests/loyalty_smoke.mjs
// e nel report di Fase 6.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const PROXY = read('supabase/functions/loyalty-proxy/index.ts');
const ORDERS = read('supabase/functions/loyalty-orders/index.ts');
const PAGE = read('supabase/functions/loyalty-page/src/index.html');
const M136 = read('supabase/migrations/0136_loyalty_hardening.sql');
const TOML = read('supabase/config.toml');
const noComments = (s) => s.replace(/^\s*\/\/[^\n]*$/gm, '');
const P = noComments(PROXY), O = noComments(ORDERS);

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

console.log('\n== T20: Admin API pinnata, niente 2024-01 ==');
t('1  loyalty-proxy: API_VERSION = 2026-07', /const API_VERSION = '2026-07'/.test(PROXY));
t('2  loyalty-orders: API_VERSION = 2026-07', /const API_VERSION = '2026-07'/.test(ORDERS));
t('3  nessun admin/api/2024-01 nelle due edge', !/admin\/api\/2024-01/.test(P + O));
t('4  loyalty-orders: GraphQL, nessuna orders.json REST', /graphql\.json/.test(O) && !/orders\.json/.test(O));
t('5  loyalty-orders: versione servita letta e confrontata (x-shopify-api-version)', /x-shopify-api-version/.test(O) && /versionMismatch\(\)/.test(O));

console.log('\n== T1/T2: firma fresca, PIN sul cron ==');
t('6  loyalty-proxy: freschezza firma (MAX_SKEW_SEC + stale_signature 401)', /const MAX_SKEW_SEC = 300/.test(PROXY) && /return json\(\{ error: 'stale_signature' \}, 401\)/.test(P));
t('7  loyalty-proxy: freschezza controllata DOPO la firma e PRIMA dell\'identita\'', P.indexOf("'bad_signature'") > 0 && P.indexOf("'bad_signature'") < P.indexOf("'stale_signature'") && P.indexOf("'stale_signature'") < P.indexOf("params.get('logged_in_customer_id')"));
t('8  loyalty-proxy: identita\' solo dai param firmati (mai customer dal body)', !/body[^\n]*customer/i.test(P));
t('9  loyalty-orders: PIN come le altre edge (sha256(body.pin) = app_config.pin_hash)', /\(await sha256hex\(String\(body\.pin\)\)\) !== cfg\.pin_hash\) return json\(\{ error: 'PIN errato' \}, 401\)/.test(O));
t('10 loyalty-orders: il PIN viene prima di ogni chiamata Shopify', O.indexOf("'PIN errato'") > 0 && O.indexOf("'PIN errato'") < O.indexOf('const gql = '));

console.log('\n== L1/L2/L7/L8: watermark, lotti, parziali, finestra ==');
t('11 loyalty-orders: date per epoch (Date.parse), mai confronto di stringhe col floor', /Date\.parse\(o\.createdAt\)/.test(O) && !/String\(o\.created_at\) >= floor/.test(O));
t('12 loyalty-orders: giro a lotti (slice MAX_CREDIT_RUN), niente rifiuto in blocco', /cands\.slice\(0, MAX_CREDIT_RUN\)/.test(O) && !/niente accredito/.test(O));
t('13 loyalty-orders: partially_refunded accreditabili (poi stornati in proporzione)', /o\.status === 'PARTIALLY_REFUNDED'/.test(O));
t('14 loyalty-orders: finestra allargata all\'ultimo giro (loyalty_orders_last_run)', /loyalty_orders_last_run/.test(O) && /lastRunMs - 3600000/.test(O));
t('15 loyalty-orders: il cursore avanza solo a giro pulito', /if \(!errors\.length\) \{\s*\n\s*const \{ error: curErr \}/.test(O));
t('16 loyalty-orders: ordini di test e senza cliente mai accreditati', /!o\.test && !!o\.customer/.test(O));
t('17 loyalty-orders: backfill con since obbligatorio e until = watermark di default', /'since' \(ISO\) obbligatorio/.test(O) && /body\.until \? Date\.parse\(String\(body\.until\)\) : launchMs/.test(O));
t('18 loyalty-orders: flag OFF = nessuna scrittura, dryRun/diag leggibili', /if \(!enabled && !dryRun\) return json\(\{ state: 'off' \}\)/.test(O));

console.log('\n== L3/L4/L5/L6: RPC atomiche e storno ==');
t('19 loyalty-proxy: coccola/memory via loyalty_award_daily, niente award() non atomico', /rpc\('loyalty_award_daily'/.test(P) && !/const award = async/.test(P));
t('20 migr 0136: loyalty_award_daily con guardia sulla data nella stessa transazione', /loyalty_award_daily/.test(M136) && /last_coccola is null or last_coccola < p_day/.test(M136) && /get diagnostics v_gate = row_count/.test(M136));
t('21 migr 0136: claim idempotente (redemption del cliente e del premio, codice esistente restituito)', /where id = p_redemption_id and shopify_customer_id = p_customer and reward_key = p_reward_key/.test(M136) && /if v_existing is not null then return v_existing/.test(M136));
t('22 migr 0136: il ramo already risponde solo al proprietario dell\'idemp', /if v_ex\.shopify_customer_id is distinct from p_customer then/.test(M136));
t('23 migr 0136: storno proporzionale idempotente (loyalty_order_reversals + loyalty_reverse_order, mai sotto zero)', /create table if not exists loyalty_order_reversals/.test(M136) && /loyalty_reverse_order/.test(M136) && /v_delta := least\(v_delta, v_balance\)/.test(M136));
t('24 migr 0136: coda DB v_loyalty_refunds_due con security_invoker', /create or replace view v_loyalty_refunds_due with \(security_invoker = true\)/.test(M136));
t('25 loyalty-orders: storno chiamato da due fonti (finestra Shopify + coda DB)', /rpc\('loyalty_reverse_order'/.test(O) && /v_loyalty_refunds_due/.test(O));
t('26 loyalty-orders: accredito con order_name (RPC a 5 argomenti)', /p_order_name: o\.name/.test(O));

console.log('\n== T16: cinture di schema ==');
for (const c of [
  'loyalty_points_points_nonneg check (points >= 0)',
  "loyalty_redemptions_status_chk check (status in ('pending','fulfilled','failed'))",
  'loyalty_redemptions_reward_fk foreign key (reward_key) references loyalty_rewards(key)',
  'loyalty_reward_codes_redemption_fk foreign key (redemption_id) references loyalty_redemptions(id)',
  'loyalty_reward_codes_redemption_uq on loyalty_reward_codes (redemption_id) where redemption_id is not null',
  'loyalty_order_credits_points_pos check (points > 0)',
]) t('27 cintura ' + c.split(' ')[0], M136.includes(c));
t('28 migr 0136: pre-check dei dati prima di ogni cintura (si ferma intera)', /raise exception 'pre-check: loyalty_points\.points < 0'/.test(M136));

console.log('\n== T9 + letture controllate (Regola 20) ==');
t('29 loyalty-proxy: rewards legge catalogo e storico con errori controllati (503)', /error: catErr/.test(P) && /error: mineErr/.test(P) && /if \(catErr \|\| mineErr \|\| points === null\) return json\(\{ error: 'read_failed' \}, 503\)/.test(P));
t('30 loyalty-proxy: flag letti con retryOnce, null = 503 (mai off per un errore)', /const readFlag = async/.test(P) && (P.match(/=== null\) return json\(\{ error: 'read_failed' \}, 503\)/g) || []).length >= 4);
t('31 loyalty-proxy: app_flags letto solo dal segreto, da readFlag e da readFlagFor (v12)', (P.match(/from\('app_flags'\)/g) || []).length === 3);
t('32 loyalty-proxy: la RPC di premio ha il retryOnce (idempotente per giorno), l\'upsert del clicker no', /retryOnce\(\(\) => sb\.rpc\('loyalty_award_daily'/.test(P) && !/retryOnce\(\(\) => sb\.from\('loyalty_points'\)\s*\n?\s*\.upsert/.test(P));

console.log('\n== S1/T33: guardaroba dal DB ==');
t('33 loyalty-proxy: guardaroba da loyalty_order_credits.order_name', /from\('loyalty_order_credits'\)\.select\('order_name'\)/.test(P));
t('34 loyalty-proxy: chiave capo = codice_norm (ripiego codice)', /String\(i\.codice_norm \|\| i\.codice \|\| ''\)/.test(P));
t('35 loyalty-proxy: wardrobe null (non leggibile) distinto da [] e wardrobe_source in state', /wardrobe_source: ward\.source/.test(P) && /items: null, source: 'error'/.test(P));
t('36 loyalty-proxy: wear non scrive se il possesso non e\' verificabile', /if \(ward\.items === null\) return json\(\{ error: 'read_failed' \}, 503\)/.test(P));
t('37 loyalty-proxy: visite registrate (loyalty_visit) senza bloccare state', /rpc\('loyalty_visit'/.test(P));

console.log('\n== Pagina Area Membri (bundle D) ==');
t('38 pagina: escape di tutto cio\' che entra in innerHTML (esc)', /const esc = s => String\(s \?\? ''\)\.replace/.test(PAGE) && /esc\(rw\.label\)/.test(PAGE) && !/'<h4>'\+rw\.label\+/.test(PAGE));
t('39 pagina: fetch con rete assente gestita (status 0, error network)', /catch\(e\) \{ return \{ status:0, data:\{ error:'network' \} \}; \}/.test(PAGE));
t('40 pagina: copy del livello onesta (segue i punti disponibili)', /il livello segue i punti disponibili/.test(PAGE));
t('41 pagina: guardaroba non leggibile (null) mostrato come tale', /items===null/.test(PAGE));

console.log('\n== config.toml: verify_jwt pinnato per le tre edge ==');
for (const fn of ['loyalty-proxy', 'loyalty-orders', 'loyalty-page']) t('42 [functions.' + fn + '] verify_jwt = false', new RegExp('\\[functions\\.' + fn + '\\]\\s*\\n(?:[^\\[\\n]*\\n)*?verify_jwt = false').test(TOML));

console.log('\n== migrazioni: una sola 0135, 0136, 0137 e 0141 ==');
const migs = readdirSync(ROOT + 'supabase/migrations');
for (const n of ['0135_', '0136_', '0137_', '0141_']) t('43 esattamente una migrazione ' + n + '*', migs.filter((f) => f.startsWith(n)).length === 1, migs.filter((f) => f.startsWith(n)).join(','));

// ---- v12 (2026-09-22, brief M4b): profilo + compleanno, tier cumulato, bonus seconda borsa (migr 0141) ----
const M140 = read('supabase/migrations/0141_loyalty_profilo_tier_bonus.sql');
console.log('\n== migr 0141: flag OFF, UNIQUE a DB, privacy, cron dopo le 06:12 ==');
t('44 tre flag nuovi a false + cursore since vuoto', /\('loyalty_profile_enabled',\s+'false'\)/.test(M140) && /\('loyalty_tier_lifetime_enabled',\s+'false'\)/.test(M140) && /\('loyalty_bonus_second_enabled',\s+'false'\)/.test(M140) && /\('loyalty_bonus_second_since',\s+''\)/.test(M140));
t('45 loyalty_profiles senza anno di nascita (solo birth_day/birth_month)', /birth_day\s+smallint/.test(M140) && /birth_month\s+smallint/.test(M140) && !/birth_year/.test(M140) && !/data_nascita|birth_date/.test(M140));
t('46 check sulla data valida (31/02 rifiutato) e materiale su lista chiusa', /when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31/.test(M140) && /'cavallino', 'cocco', 'vernice', 'pelle liscia', 'cotone', 'nessuna preferenza'/.test(M140));
t('47 RLS + REVOKE sulle tre tabelle nuove', ['loyalty_profiles', 'loyalty_birthday_awards', 'loyalty_bonus_second'].every((tb) => new RegExp('alter table ' + tb + ' enable row level security;\\s*\\nrevoke all on ' + tb + ' from anon, authenticated;').test(M140)));
t('48 ask_ro non legge giorno e mese di nascita', /grant select \(shopify_customer_id, materiale_preferito, consenso_compleanno, completed_at, created_at, updated_at\) on loyalty_profiles to ask_ro/.test(M140) && !/grant select on loyalty_profiles/.test(M140));
t('49 UNIQUE parziali su loyalty_events: profile_complete, bonus_second, birthday (cliente+anno)', /loyalty_events_profile_complete_uq on loyalty_events \(shopify_customer_id\) where source = 'profile_complete'/.test(M140) && /loyalty_events_bonus_second_uq\s+on loyalty_events \(shopify_customer_id\) where source = 'bonus_second'/.test(M140) && /loyalty_events_birthday_uq\s+on loyalty_events \(shopify_customer_id, \(meta->>'year'\)\) where source = 'birthday'/.test(M140));
t('50 +10 profilo: gate completed_at sotto lock + insert evento ON CONFLICT (mai controllo-e-poi-inserisco)', /for update;/.test(M140) && /where shopify_customer_id = p_customer and completed_at is null/.test(M140) && /on conflict \(shopify_customer_id\) where source = 'profile_complete' do nothing/.test(M140));
t('51 data bloccata dopo il primo salvataggio (birthday_locked)', /v_locked := true/.test(M140) && /'birthday_locked', v_locked/.test(M140));
t('52 compleanno: +20 una volta per anno, 30 giorni di anticipo, 29/02 -> 28/02, tetto per giro', /on conflict \(shopify_customer_id, year\) do nothing/.test(M140) && /v_lead constant int := 30/.test(M140) && /make_date\(p_year, 2, 28\)/.test(M140) && /limit p_max \+ 1/.test(M140));
t('53 giri: NO-OP a flag spento con riga health_log, errore in health_log come error (Regola 20a)', (M140.match(/return jsonb_build_object\('state', 'off'\)/g) || []).length === 2 && (M140.match(/exception when others then\s*\n\s*v_err := sqlerrm;/g) || []).length === 2 && /v_sev := 'error'/.test(M140));
t('54 cron dopo refresh_health_log (06:00) e loyalty_health_check (06:12)', /'loyalty-birthday-daily', '20 6 \* \* \*'/.test(M140) && /'loyalty-bonus-second-daily', '25 6 \* \* \*'/.test(M140));
t('55 bonus: +50 una volta (PK cliente), 2° ordine entro 90 giorni, dopo since, storno se rimborsato per intero, mai sotto zero', /on conflict \(shopify_customer_id\) do nothing;\s*\n\s*if not found then v_skip/.test(M140) && /interval '90 days'/.test(M140) && /s\.second_order_at >= v_since/.test(M140) && /s\.second_fully_refunded/.test(M140) && /v_delta := least\(r\.points - r\.points_reversed, coalesce\(v_balance, 0\)\)/.test(M140));
const M140code = M140.replace(/^\s*--[^\n]*$/gm, '');
t('56 bonus: legge loyalty_order_credits e shopify_orders (core SOLO in lettura), nessuna scrittura core ne\' write-api nel codice', /from loyalty_order_credits c/.test(M140code) && /left join shopify_orders o on o\.order_id = c\.order_name/.test(M140code) && !/insert into shopify_|update shopify_|delete from shopify_|write-api|write_api/.test(M140code));
t('57 v_loyalty_members: punti_cumulati e tier_cumulato in coda, tier_saldo intatto', /as tier_saldo,/.test(M140) && /as punti_cumulati,\s*\n\s*loyalty_tier_of\(.*\) as tier_cumulato\s*\nfrom loyalty_points p/.test(M140));
t('58 cumulato = tutto tranne i riscatti', /where shopify_customer_id = p_customer and source <> 'redeem'/.test(M140) && /case when e\.source <> 'redeem' then e\.delta end/.test(M140));
t('59 nessuna colonna aggiunta a tabelle core', !/alter table (shopify_|products|purchases|sales|expenses|app_config)/.test(M140));

console.log('\n== loyalty-proxy v12: profile / profile_save additive ==');
t('60 azioni profile e profile_save presenti, dopo firma e identita\'', P.indexOf("action === 'profile'") > P.indexOf("params.get('logged_in_customer_id')") && /action === 'profile_save'/.test(P));
t('61 readFlagFor: true/false/lista di clienti, null = 503', /const readFlagFor = async/.test(P) && /v\.split\(','\)\.map\(\(s\) => s\.trim\(\)\)\.includes\(customerId\)/.test(P) && /if \(profOn === null \|\| tierOn === null \|\| bonusOn === null\) return json\(\{ error: 'read_failed' \}, 503\)/.test(P));
t('62 profile: stato dalla RPC loyalty_profile_state con errore controllato (503)', /rpc\('loyalty_profile_state'/.test(P) && /if \(stErr\) return json\(\{ error: 'read_failed' \}, 503\)/.test(P));
t('63 profile_save: flag OFF = off senza scritture, consenso booleano obbligatorio, RPC senza retry', /if \(!on\) return json\(\{ state: 'off' \}\)/.test(P) && /if \(typeof pb\.consenso !== 'boolean'\) return json\(\{ error: 'invalid_value' \}, 400\)/.test(P) && /await sb\.rpc\('loyalty_profile_save'/.test(P) && !/retryOnce\(\(\) => sb\.rpc\('loyalty_profile_save'/.test(P));
t('64 profile_save: il client non manda mai punti (solo data, materiale, consenso)', !/pb\.points|pb\.delta|p_points/.test(P.slice(P.indexOf("action === 'profile_save'"))));
t('65 le azioni esistenti restano: state/coccola/memory_win/nanna/wear/add/rewards/redeem', ["'state'", "'coccola'", "'memory_win'", "'nanna'", "'wear'", "'add'", "'rewards'", "'redeem'"].every((a) => P.includes('action === ' + a)));

console.log('\n== pagina v12: card profilo, compleanno, seconda borsa, tier cumulato ==');
t('66 pagina: testo del consenso (solo giorno e mese, niente anno)', /Usiamo solo giorno e mese per farti un regalo di compleanno\. Niente anno\./.test(PAGE));
t('67 pagina: tier dal cumulato SOLO a flag acceso, copy diversa', /pr\.tier_lifetime_enabled/.test(PAGE) && /il livello segue i punti cumulati: riscattare non lo abbassa/.test(PAGE) && /il livello segue i punti disponibili/.test(PAGE));
t('68 pagina: card profilo e bonus nascosti senza profile/flag (nessuna card finta)', /if\(!pr \|\| !pr\.profile_enabled\)\{ sec\.classList\.add\('hidden'\); return; \}/.test(PAGE) && /typeof pf\.data\.profile_enabled==='boolean'/.test(PAGE));
t('69 pagina: +20 compleanno mostrato solo se il server dice birthday_awarded', /pr\.birthday_awarded \? /.test(PAGE));
t('70 pagina: riga seconda borsa con data e +50', /Seconda borsa entro il <b>/.test(PAGE) && /\+50 punti/.test(PAGE));
t('71 pagina: escape sui valori del profilo', /esc\(P\.materiale_preferito/.test(PAGE) && /esc\(itDate\(bs\.deadline\)\)/.test(PAGE));
t('72 pagina: profile_save via POST con consenso booleano', /api\('profile_save',\{method:'POST',body\}\)/.test(PAGE) && /consenso: !!\(cons && cons\.checked\)/.test(PAGE));
t('73 pagina: nessun em dash nei testi', !/—/.test(PAGE));

// ---- migr 0142 (22-09 sera): Gate 2 sulla 0141 + Parte D (premio unico 100 pt = 12%) ----
const M142 = read('supabase/migrations/0142_loyalty_gate2_premio12.sql');
console.log('\n== migr 0142: Gate 2 chiuso a codice, premio 12% spento ==');
t('74 esattamente una migrazione 0142_*', migs.filter((f) => f.startsWith('0142_')).length === 1);
t('75 A1: evento birthday con SOLO anno nel meta (ask_ro legge loyalty_events.meta)', /'birthday', jsonb_build_object\('year', r\.year, 'fisso', true\)/.test(M142) && !/'birthday', r\.bday/.test(M142));
t('76 B1: storno del bonus sull\'ordine salvato (second_order_id), non sul rn=2 della vista', /join loyalty_order_credits c on c\.shopify_order_id = b\.second_order_id/.test(M142) && /left join loyalty_order_reversals rv on rv\.shopify_order_id = b\.second_order_id/.test(M142));
t('77 B2: cursore since fissato PRIMA del blocco exception e mai sovrascritto', M142.indexOf("key = 'loyalty_bonus_second_since'") < M142.indexOf('begin\n    for r in\n      select s.shopify_customer_id') && /do update set value = excluded\.value where coalesce\(trim\(app_flags\.value\), ''\) = ''/.test(M142));
t('78 B3: finestra 90 giorni e deadline su date Europe/Rome + days_left', /s\.order_day <= f\.order_day \+ 90/.test(M142) && /\(f\.order_day \+ 90\) as deadline/.test(M142) && /'days_left', case when v_n = 1/.test(M142));
t('79 C1/C2: second_fully_refunded mai null, n=0 in errore', /coalesce\(s\.points_reversed >= s\.points or/.test(M142) && (M142.match(/v_sev := 'error'; v_done := 0/g) || []).length === 2);
t('80 D: riga tessera12 (100 pt, 12%) inserita SPENTA, nessuna cancellazione, tessera invariata', /\('tessera12', '[^']*', 100, 'percentage', 12, false, 5\)/.test(M142) && !/delete from loyalty_rewards|update loyalty_rewards set active = \(key = 'tessera12'\)/.test(M142.replace(/^\s*--[^\n]*$/gm, '')));
t('81 D: KPI tessera piena sul premio attivo (niente 200 fisso)', /p\.points >= coalesce\(\(select min\(w\.cost_points\) from loyalty_rewards w where w\.active\), 200\)/.test(M142));
t('82 D: la pagina deriva i timbri dal costo del premio attivo (10 timbri = cost_points)', /Math\.round\(Number\(rw0\.cost_points\)\/CONFIG\.stampsForReward\)/.test(PAGE) && /Un timbro ogni '\+stampEvery\+' punti/.test(PAGE));
t('83 D: la edge non ha costi o percentuali fisse del premio (li legge la RPC dalla riga attiva)', !/cost_points: 200|cost: 200|value: 20\b|value: 12\b/.test(P));
t('84 C3: profile_save valida intervallo giorno/mese e body nullo', /day < 1 \|\| day > 31/.test(P) && /month < 1 \|\| month > 12/.test(P) && /\?\? \{\}\) as Record<string, unknown>/.test(P));
t('85 C4: la pagina usa days_left dal server (niente fuso del browser)', /Number\(bs\.days_left\)/.test(PAGE) && !/new Date\(bs\.deadline/.test(PAGE));

// ---- migr 0143 (23-09): il premio 12% si chiama amica12 (owner: nome legato all'essere parte di Amimi) ----
const M143 = read('supabase/migrations/0143_loyalty_premio_amica12.sql');
console.log('\n== migr 0143: premio amica12 ==');
t('86 esattamente una migrazione 0143_*', migs.filter((f) => f.startsWith('0143_')).length === 1);
t('87 rename tessera12 -> amica12 con pre-check sulle FK, riga ancora spenta', /where key = 'tessera12'/.test(M143) && /set key = 'amica12'/.test(M143) && /raise exception 'pre-check: tessera12/.test(M143) && /'percentage', 12, false, 5\)/.test(M143));
t('88 nessun tessera12 residuo fuori dalle migrazioni gia\' applicate', !/tessera12/.test(PAGE + P + read('tests/loyalty_profilo_idempotenza.sql') + read('docs/LOYALTY_RUNBOOK.md')));

console.log(`\nloyalty_guardie: ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
