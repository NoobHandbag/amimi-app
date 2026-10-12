// tests/loyalty_guardie.mjs — guardie sul SORGENTE del modulo Premia (loyalty-proxy v14, loyalty-orders v3, migr 0136-0150,
// pagina Area Membri, config.toml). Quest audit Area Membri, Fase 6 (2026-09-21); pagina a soli punti del 2026-10-11.
//   node tests/loyalty_guardie.mjs
//
// Classe non collaudabile a runtime (compare solo con tap concorrenti, firme rigiocate, PostgREST che risponde male o
// Shopify che ritira una versione): si legge il sorgente e si verifica che ogni fix resti al suo posto. Ogni pin cita
// il finding dell'audit (Cowork12/projects/Premia_Area_Membri_2026-09/07_AUDIT_1_logico.md e 07_AUDIT_2_tecnico.md)
// che lo ha generato. Le prove vive (RPC sull'account di test, smoke di produzione) stanno in tests/loyalty_smoke.mjs
// e nel report di Fase 6.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
t('31 loyalty-proxy: app_flags letto solo dal segreto, da readFlag, da readFlagFor (v12) e dalla rotta club (v14)', (P.match(/from\('app_flags'\)/g) || []).length === 4);
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
t('40 pagina (v14): nessun livello, timbro, nanna o "indossa"', !/tierOf|nextTier|stampEvery|stampsForReward|Amica Speciale|Amica del Cuore|btnNanna|data-codice|api\('nanna'|api\('wear'/.test(PAGE));
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
t('67 pagina (v14): i livelli non si leggono piu\' (ne\' tier_lifetime_enabled ne\' punti_cumulati)', !/tier_lifetime_enabled|punti_cumulati|tier_cumulato/.test(PAGE));
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
t('82 D (v14, sentiero a giro del 12-10): giro e tappe derivano dal costo del premio attivo, nessun 100 o 12 fisso in pagina', /const cost=Number\(rw\.cost_points\), k=Math\.floor\(p\/cost\), c=p\/cost/.test(PAGE) && /Math\.round\(cost\*q\)/.test(PAGE) && !/cost_points: ?100|value: ?12\b|sconto del 12%|>100<|>25<|>50<|>75</.test(PAGE));
const pathFn = PAGE.slice(PAGE.indexOf('function renderPath()'), PAGE.indexOf('// === riscatto (punti'));
t('82b sentiero: a un multiplo esatto Mimi\' e\' SUL traguardo; un saldo che scende non la fa camminare all\'indietro; arrivo garantito senza fotogrammi', /function giro\(c, arrivo\)\{ const f=c-Math\.floor\(c\); return \(arrivo && c>0 && f<1e-9\) \? 1 : f; \}/.test(PAGE) && /if\(reduced \|\| c<=from\)\{ roadC=c; roadDraw\(w,c,true,true\);/.test(pathFn) && /roadEnd=setTimeout\(fine, d\+250\);/.test(pathFn) && /const from = roadC===null \? \(\(p>0 && resto===0\) \? c-1 : Math\.floor\(c\)\) : roadC;/.test(pathFn));
t('82d sentiero (Gate 2 del 12-10): in corsa un numero intero di giri e\' la partenza, non un arrivo (nessuna festa finta all\'apertura); festa solo all\'arrivo esatto o al passaggio', /roadDraw\(w, roadC, false, false\);/.test(pathFn) && /const fine=\(\)=>\{ roadStop\(\); roadC=c; roadDraw\(w,c,true,false\);/.test(pathFn) && /if\(x<1 && Math\.floor\(roadC\)>Math\.floor\(prima\)\) festa\(w\);/.test(pathFn) && /if\(on && !era && !quiet\) festa\(w\);/.test(PAGE));
t('82e sentiero: disegnato per ultimo e contenuto (se non si misura sparisce lui, non il riscatto); niente "pronti" con un riscatto in attesa; etichetta per i lettori al singolare e al traguardo', /try \{ renderPath\(\); \} catch\(e\) \{ roadStop\(\); el\('walk'\)\.classList\.add\('hidden'\); el\('pronti'\)\.classList\.add\('hidden'\); \}/.test(PAGE) && !/^    renderPath\(\); renderRedeem\(\);/m.test(PAGE) && /if\(k>0 && !attesa\)\{/.test(pathFn) && /'Sei al traguardo del giro\.'/.test(pathFn) && /resto===1\?' punto':' punti'/.test(pathFn));
t('82c sentiero: premi pronti = giri completati (al massimo cinque bandierine disegnate), "sconto" solo per un premio a percentuale', /for\(let i=0;i<Math\.min\(k,5\);i\+\+\)/.test(pathFn) && /sconto=percento\(rw\)>0/.test(pathFn) && /\(sconto\?'1 sconto pronto':'1 premio pronto'\)/.test(pathFn));
t('83 D: la edge non ha costi o percentuali fisse del premio (li legge la RPC dalla riga attiva)', !/cost_points: 200|cost: 200|value: 20\b|value: 12\b/.test(P));
t('84 C3: profile_save valida intervallo giorno/mese e body nullo', /day < 1 \|\| day > 31/.test(P) && /month < 1 \|\| month > 12/.test(P) && /\?\? \{\}\) as Record<string, unknown>/.test(P));
t('85 C4: la pagina usa days_left dal server (niente fuso del browser)', /Number\(bs\.days_left\)/.test(PAGE) && !/new Date\(bs\.deadline/.test(PAGE));

// ---- migr 0143 (23-09): il premio 12% si chiama amica12 (owner: nome legato all'essere parte di Amimi) ----
const M143 = read('supabase/migrations/0143_loyalty_premio_amica12.sql');
console.log('\n== migr 0143: premio amica12 ==');
t('86 esattamente una migrazione 0143_*', migs.filter((f) => f.startsWith('0143_')).length === 1);
t('87 rename tessera12 -> amica12 con pre-check sulle FK, riga ancora spenta', /where key = 'tessera12'/.test(M143) && /set key = 'amica12'/.test(M143) && /raise exception 'pre-check: tessera12/.test(M143) && /'percentage', 12, false, 5\)/.test(M143));
t('88 nessun tessera12 residuo fuori dalle migrazioni gia\' applicate', !/tessera12/.test(PAGE + P + read('tests/loyalty_profilo_idempotenza.sql') + read('docs/LOYALTY_RUNBOOK.md')));

// ---- migr 0146 (27-09): dashboard Premia nell'app (Fase 1) + tracciamento Area Membri (Fase 2) ----
const M146 = read('supabase/migrations/0146_loyalty_dashboard_tracking.sql');
const M146c = M146.replace(/^\s*--[^\n]*$/gm, '');
const dashFn = M146c.slice(M146c.indexOf('create or replace function public.loyalty_dashboard'));
const trackFn = M146c.slice(M146c.indexOf('create or replace function public.loyalty_track'), M146c.indexOf('create or replace function public.loyalty_ui_events_purge'));
console.log('\n== migr 0146: dashboard e tracciamento ==');
t('89 esattamente una migrazione 0146_*', migs.filter((f) => f.startsWith('0146_')).length === 1);
t('90 flag loyalty_track_enabled nasce spento', /\('loyalty_track_enabled', 'false'\)\s*on conflict \(key\) do nothing/.test(M146c));
t('91 loyalty_ui_events: RLS accesa, chiusa ad anon/authenticated, eventi e elementi vincolati', /alter table loyalty_ui_events enable row level security/.test(M146c) && /revoke all on loyalty_ui_events from anon, authenticated/.test(M146c) && /check \(event in \('page_open', 'view', 'tap'\)\)/.test(M146c) && /element ~ '\^\[a-z0-9_\]\{1,32\}\$'/.test(M146c));
t('92 loyalty_track: solo service_role, flag ricontrollato dentro, tetti 20 e 300, lock per cliente', /revoke all on function public\.loyalty_track\(text, jsonb\) from anon, authenticated, public/.test(M146c) && /grant execute on function public\.loyalty_track\(text, jsonb\) to service_role/.test(M146c) && /loyalty_flag_on\('loyalty_track_enabled', p_customer\)/.test(trackFn) && /c_max_call constant int := 20/.test(trackFn) && /c_max_day  constant int := 300/.test(trackFn) && /pg_advisory_xact_lock/.test(trackFn));
t('93 loyalty_track: liste chiuse di elementi (view e tap), payload solo array', /s\.element = any\(c_views\)/.test(trackFn) && /s\.element = any\(c_taps\)/.test(trackFn) && /jsonb_typeof\(p_events\) <> 'array'/.test(trackFn));
t('94 loyalty_dashboard: cancello @amimi.it (42501) prima di ogni lettura', dashFn.indexOf("ilike '%@amimi.it'") > 0 && dashFn.indexOf("errcode = '42501'") > 0 && dashFn.indexOf("errcode = '42501'") < dashFn.indexOf('select jsonb_build_object('));
t('95 loyalty_dashboard: execute solo ad authenticated, mai anon', /revoke all on function public\.loyalty_dashboard\(integer\) from anon, public/.test(M146c) && /grant execute on function public\.loyalty_dashboard\(integer\) to authenticated/.test(M146c) && !/loyalty_dashboard\(integer\) to anon/.test(M146c));
t('96 loyalty_dashboard: nessun codice sconto e nessun id cliente nel risultato', !/discount_code[^s]/.test(dashFn) && !/'shopify_customer_id'/.test(dashFn) && !/'code'/.test(dashFn));
t('97 loyalty_dashboard: flag esposti solo come on/off/test (mai la lista di id di prova)', /else 'test' end/.test(dashFn) && !/'value', f\.value|f\.key, f\.value/.test(dashFn));
t('98 v_loyalty_funnel_daily chiusa ad anon/authenticated', /revoke all on v_loyalty_funnel_daily from anon, authenticated/.test(M146c));
t('99 purge a 180 giorni con tetto 5000 righe e cron dopo le 06:12 UTC', /- 180 order by id limit 5000/.test(M146c) && /'loyalty-ui-events-purge', '35 6 \* \* \*'/.test(M146c));
const trackBranch = P.slice(P.indexOf("if (action === 'track')"), P.indexOf("if (action === 'profile')"));
t('100 loyalty-proxy v13: track solo POST, body max 4000, max 20 eventi, nessun retry', /req\.method !== 'POST'\) return json\(\{ error: 'method_not_allowed' \}, 405\)/.test(trackBranch) && /raw\.length > 4000/.test(trackBranch) && /tb\.events\.slice\(0, 20\)/.test(trackBranch) && !/retryOnce/.test(trackBranch));
t('101 loyalty-proxy v13: identita\' del track dal param firmato, errore = {ok:false} 200, off = {state:off}', /p_customer: customerId/.test(trackBranch) && /return json\(\{ ok: false \}\)/.test(trackBranch) && /tv\.reason === 'off'\) return json\(\{ state: 'off' \}\)/.test(trackBranch));
t('102 pagina: tracciamento in lotti con keepalive, tetto 60, si ferma a state off', /keepalive:true/.test(PAGE) && /MAX:60/.test(PAGE) && /d\.state==='off'\)\{ T\.off=true; T\.q=\[\]; \}/.test(PAGE) && /T\.q\.splice\(0,20\)/.test(PAGE));
t('103 pagina: il payload porta solo nome evento ed elemento', /T\.q\.push\(name \? \{ e:e, el:name \} : \{ e:e \}\)/.test(PAGE) && /body:JSON\.stringify\(\{ events:batch \}\)/.test(PAGE));
t('104 pagina: tap sul riscatto e card del premio con lo stato (ready/locked/pending)', /track\('tap','redeem'\)/.test(PAGE) && /track\('tap','copy_code'\)/.test(PAGE) && /'redeem_pending' : \(p>=rw\.cost_points \? 'redeem_ready' : 'redeem_locked'\)/.test(PAGE));
const trackNames = [...PAGE.matchAll(/track\('(view|tap)','([a-z0-9_]+)'\)|watch\('[a-zA-Z0-9]+','([a-z0-9_]+)'\)/g)].map((m) => m[2] || m[3]);
const M150 = read('supabase/migrations/0150_loyalty_percorso_eventi.sql');
const M150c = M150.replace(/^\s*--[^\n]*$/gm, '');
// dalla 0150 le liste chiuse valide sono le sue (la funzione e' ridefinita li')
const allowed = (M150c.match(/c_views\s+constant text\[\] := array\[([^\]]+)\]/)?.[1] + ',' + M150c.match(/c_taps\s+constant text\[\] := array\[([^\]]+)\]/)?.[1]).replace(/'/g, '').split(',').map((s) => s.trim());
t('105 pagina: ogni elemento tracciato e\' nella lista chiusa della RPC', trackNames.length >= 10 && trackNames.every((n) => allowed.includes(n)), trackNames.filter((n) => !allowed.includes(n)).join(','));

// ---- migr 0147 (27-09): Gate 2 sulla 0146 ----
const M147 = read('supabase/migrations/0147_loyalty_dashboard_gate2.sql').replace(/^\s*--[^\n]*$/gm, '');
const PREMIA = read('web/src/pages/Premia.tsx');
console.log('\n== migr 0147: Gate 2 della dashboard ==');
t('106 esattamente una migrazione 0147_*', migs.filter((f) => f.startsWith('0147_')).length === 1);
t('107 G2-1: label di health_log con le sequenze di 5+ cifre oscurate', /regexp_replace\(coalesce\(h\.label, ''\), '\[0-9\]\{5,\}', '…', 'g'\)/.test(M147));
t('108 G2-2: ritmo del pool sui giorni effettivi (giorni_ritmo) usato dalla pagina', /'giorni_ritmo'/.test(M147) && /pool\.riscatti_14gg \/ Math\.max\(1, pool\.giorni_ritmo \?\? 14\)/.test(PREMIA));
t('109 G2-3: visita contata solo se iniziata prima dell\'ordine', /v\.first_at < o\.created_at_shop/.test(M147) && !/v\.day between/.test(M147));
t('110 G2-5: ordini filtrati sugli stati pagati come v_loyalty_uplift', (M147.match(/financial_status = any\(v_paid\)/g) || []).length >= 7 && /financial_status in \('paid', 'partially_refunded', 'refunded'\)/.test(M147));
t('111 G2-7: capped sui soli eventi validi', /'capped', v_valid > v_room/.test(M147));
t('112 G2-10: vista funnel in security_invoker, ask_ro a colonne senza discount_code', /v_loyalty_funnel_daily with \(security_invoker = on\)/.test(M147) && /grant select \(id, shopify_customer_id, reward_key, cost_points, status, created_at, fulfilled_at\) on loyalty_redemptions to ask_ro/.test(M147));
t('113 G2-8/9: vista con soglia anche per card alte; tap Gioca solo se disponibile', /x\.intersectionRect\.height>=window\.innerHeight\*0\.4/.test(PAGE) && /S\.memory_disponibile\)\{ toast\('Torna domani per un nuovo gioco[^']*'\); return; \} track\('tap','gioco'\)/.test(PAGE));
t('114 G2-4/11/12: percentuali del funnel solo fra popolazioni omogenee, risposta vecchia ignorata, tab fra quelle finance', /i > 0 && v <= steps\[i - 1\]\[1\]/.test(PREMIA) && /if \(vivo\) setD\(x\)/.test(PREMIA) && /'ads', 'premia'\]/.test(read('web/src/lib/people.tsx')));

// ---- v14 (2026-10-11, call del 09-10): pagina a soli punti con percorso, QR eventi, codici, memory con foto (migr 0150) ----
const M147raw = read('supabase/migrations/0147_loyalty_dashboard_gate2.sql');
const BUILD = read('supabase/functions/loyalty-page/build.mjs');
const PAGE_V1 = read('supabase/functions/loyalty-page/src/index.v1.html');
const fnTrack = (sql) => { const i = sql.indexOf('create or replace function public.loyalty_track'); return sql.slice(i, sql.indexOf('end $$;', i)).replace(/array\[[^\]]+\]/g, 'array[...]').replace(/\s+/g, ' '); };
const fn = (name) => { const i = M150c.indexOf('create or replace function public.' + name); return M150c.slice(i, M150c.indexOf('$function$;', i)); };
console.log('\n== migr 0150: eventi con QR, codici riscattati, mazzo del memory ==');
t('115 esattamente una migrazione 0150_*', migs.filter((f) => f.startsWith('0150_')).length === 1);
t('116 due flag nuovi a false (presenze e pagina nuova)', /\('loyalty_checkin_enabled', 'false'\)/.test(M150c) && /\('loyalty_page_v2',\s+'false'\)/.test(M150c) && /on conflict \(key\) do nothing/.test(M150c));
t('117 RLS + REVOKE sulle due tabelle nuove', ['loyalty_checkin_events', 'loyalty_checkins'].every((tb) => new RegExp('alter table ' + tb + ' enable row level security;\\s*\\nrevoke all on ' + tb + ' from anon, authenticated;').test(M150c)));
t('118 presenza: PK (evento, cliente) + UNIQUE parziale su loyalty_events, pre-check sulla source nuova', /primary key \(event_code, shopify_customer_id\)/.test(M150c) && /loyalty_events_event_checkin_uq\s+on loyalty_events \(shopify_customer_id, \(meta->>'event'\)\) where source = 'event_checkin'/.test(M150c) && /raise exception 'pre-check: esistono gia'' eventi con source event_checkin'/.test(M150c));
t('119 evento: finestra obbligatoria (max 14 giorni), punti 1-100, tetto di presenze, codice a formato chiuso', /ends_at > starts_at and ends_at <= starts_at \+ interval '14 days'/.test(M150c) && /check \(points between 1 and 100\)/.test(M150c) && /check \(max_checkins between 1 and 5000\)/.test(M150c) && /check \(code ~ '\^\[A-Z0-9_-\]\{4,40\}\$'\)/.test(M150c));
const ck = fn('loyalty_checkin');
t('120 loyalty_checkin: flag dentro, lucchetto per evento, finestra e tetto PRIMA dell\'insert, gate = insert ON CONFLICT', /loyalty_flag_on\('loyalty_checkin_enabled', p_customer\)/.test(ck) && /pg_advisory_xact_lock\(hashtext\('loyalty_checkin:' \|\| v_code\)\)/.test(ck) && ck.indexOf("'not_started'") < ck.indexOf('insert into loyalty_checkins') && ck.indexOf("'ended'") < ck.indexOf('insert into loyalty_checkins') && ck.indexOf("'full'") < ck.indexOf('insert into loyalty_checkins') && /on conflict \(event_code, shopify_customer_id\) do nothing;\s*\n\s*get diagnostics v_gate = row_count;/.test(ck));
t('121 loyalty_checkin: i punti vengono dalla riga dell\'evento (nessun parametro punti), saldo ed evento nella stessa funzione', /loyalty_checkin\(p_customer text, p_code text\)/.test(ck) && !/p_points|p_delta/.test(ck) && /insert into loyalty_points[\s\S]*returning points into v_new;/.test(ck) && /'event_checkin', jsonb_build_object\('event', v_code/.test(ck));
t('122 le tre funzioni nuove: execute solo a service_role', ['loyalty_checkin(text, text)', 'loyalty_redemptions_for(text)', 'loyalty_memory_deck(int)'].every((sig) => M150c.includes('revoke all on function public.' + sig + ' from anon, authenticated, public;') && M150c.includes('grant execute on function public.' + sig + ' to service_role;')));
const rf = fn('loyalty_redemptions_for');
t('123 loyalty_redemptions_for: solo i riscatti del cliente chiesto, usato = codice in un ordine, niente jolly dal dato', /from loyalty_redemptions\s+where shopify_customer_id = p_customer and status in/.test(rf) &&/upper\(r\.discount_code\) = any\(regexp_split_to_array\(upper\(coalesce\(o\.discount_codes, ''\)\), '\[\^A-Z0-9_-\]\+'\)\)/.test(rf) && !/ilike|like '%' \|\||position\(/.test(rf) && /status in \('pending', 'fulfilled'\)\s*\n\s*order by created_at desc limit 60/.test(rf) && /'used_day', \(u\.used_at at time zone 'Europe\/Rome'\)::date/.test(rf));
const dk = fn('loyalty_memory_deck');
t('124 loyalty_memory_deck: solo schede attive con foto sul CDN Shopify, una per modello, tetto 8', /shopify_status = 'active'/.test(dk) && /like 'https:\/\/cdn\.shopify\.com\/%'/.test(dk) && /distinct on \(split_part\(codice, '_', 1\)\)/.test(dk) && /least\(greatest\(coalesce\(p_n, 3\), 2\), 8\)/.test(dk));
const dml150 = [...M150c.matchAll(/\b(?:insert into|delete from|update)\s+(?:only\s+)?(?:public\.)?([a-z_0-9]+)/g)].map((x) => x[1]).filter((n) => n !== 'set');
const alt150 = [...M150c.matchAll(/\balter table\s+(?:public\.)?([a-z_0-9]+)/g)].map((x) => x[1]);
t('125 0150: scrive solo su tabelle del modulo, app_flags e change_log; alter solo sulle due tabelle nuove; nessun drop', dml150.length >= 6 && dml150.every((n) => /^(loyalty_[a-z_]+|app_flags|change_log)$/.test(n)) && alt150.every((n) => n === 'loyalty_checkin_events' || n === 'loyalty_checkins') && !/\bdrop (table|function|view|column|policy|index)\b/.test(M150c), dml150.concat(alt150).join(','));
t('125b 0150: ask_ro legge davvero le due tabelle nuove (grant + policy: senza policy la RLS gli darebbe zero righe)', ['loyalty_checkin_events', 'loyalty_checkins'].every((tb) => M150c.includes('grant select on ' + tb + ' to ask_ro;') && new RegExp('create policy ' + tb + '_ask_ro on ' + tb + ' for select to ask_ro using \\(true\\);').test(M150c)) && !/create policy[^;]*\bto (anon|authenticated|public)\b/.test(M150c));
t('126 loyalty_track: corpo identico alla 0147, cambiano solo le due liste (che contengono quelle di prima)', fnTrack(M150c) === fnTrack(M147raw.replace(/^\s*--[^\n]*$/gm, '')) && ['redeem_ready', 'redeem_locked', 'redeem_pending', 'profilo', 'mimi', 'guardaroba', 'bonus2', 'bday', 'redeem', 'copy_code', 'coccola', 'gioco', 'nanna', 'wear', 'profile_save'].every((n) => allowed.includes(n)));

console.log('\n== loyalty-proxy v14: club, rewards, deck, checkin ==');
const clubBranch = P.slice(P.indexOf("=== 'club'"), P.indexOf('const url = new URL(req.url);'));
t('127 club: pagina nuova con ?anteprima=1, con ?evento= (QR) o a flag loyalty_page_v2 true; flag letto con un ritentativo, illeggibile = pagina di sempre', /let _v2 = _u\.searchParams\.get\('anteprima'\) === '1' \|\| _u\.searchParams\.has\('evento'\);/.test(clubBranch) && /await retryOnce\(\(\) => _sb\.from\('app_flags'\)\.select\('value'\)\.eq\('key', 'loyalty_page_v2'\)\.maybeSingle\(\)\)/.test(clubBranch) && /_v2 = !_fErr && String\(_f\?\.value \?\? ''\)\.trim\(\)\.toLowerCase\(\) === 'true'/.test(clubBranch) && /catch \(_e\) \{ _v2 = false; \}/.test(clubBranch) && /\/functions\/v1\/loyalty-page' \+ \(_v2 \? '\?v=2' : ''\)/.test(clubBranch));
t('128 club: resta prima di segreto, firma e identita\' (HTML pubblico, nessun dato)', P.indexOf("=== 'club'") < P.indexOf("'shopify_app_proxy_secret'") && !/logged_in_customer_id|customerId/.test(clubBranch));
t('129 rewards: storico dalla RPC del solo cliente loggato, risposta non-array = 503', /sb\.rpc\('loyalty_redemptions_for', \{ p_customer: customerId \}\)/.test(P) && /if \(!Array\.isArray\(mine\)\) return json\(\{ error: 'read_failed' \}, 503\)/.test(P));
const deckBranch = P.slice(P.indexOf("if (action === 'deck')"), P.indexOf("if (action === 'checkin')"));
const checkinBranch = P.slice(P.indexOf("if (action === 'checkin')"), P.indexOf("return json({ error: 'unknown_action'"));
t('130 deck e checkin dopo firma e identita\'', P.indexOf("if (action === 'deck')") > P.indexOf("params.get('logged_in_customer_id')") && P.indexOf("if (action === 'checkin')") > P.indexOf("params.get('logged_in_customer_id')"));
t('131 deck: sola lettura (una RPC, nessuna scrittura), errore = 503', /rpc\('loyalty_memory_deck'/.test(deckBranch) && !/insert|upsert|update\(|loyalty_points/.test(deckBranch) && /return json\(\{ error: 'read_failed' \}, 503\)/.test(deckBranch));
t('132 checkin: solo POST, codice a formato chiuso, identita\' dal param firmato, off = {state:off}', /req\.method !== 'POST'\) return json\(\{ error: 'method_not_allowed' \}, 405\)/.test(checkinBranch) && /\/\^\[A-Z0-9_-\]\{4,40\}\$\/\.test\(code\)/.test(checkinBranch) && /p_customer: customerId, p_code: code/.test(checkinBranch) && /c\.reason === 'off'\) return json\(\{ state: 'off' \}\)/.test(checkinBranch));
t('133 checkin: il client non manda mai punti e la edge non ne decide', !/cb\.points|cb\.delta|p_points|added: \d/.test(checkinBranch));
t('134 profile: checkin_enabled dal flag a valore, null = 503', /const checkinOn = await readFlagFor\('loyalty_checkin_enabled'\)/.test(P) && /if \(checkinOn === null\) return json\(\{ error: 'read_failed' \}, 503\)/.test(P) && /checkin_enabled: checkinOn/.test(P));
t('135 le azioni v13 restano tutte (compatibilita\' con la pagina di prima)', ["'state'", "'coccola'", "'memory_win'", "'nanna'", "'wear'", "'add'", "'rewards'", "'redeem'", "'track'", "'profile'", "'profile_save'"].every((a) => P.includes('action === ' + a)));

console.log('\n== pagina v14 e build ==');
t('136 pagina: presenza via POST col solo codice, formato chiuso anche in pagina, attesa a tempo in localStorage', /api\('checkin',\{method:'POST',body:\{code:EVT\}\}\)/.test(PAGE) && /\/\^\[A-Z0-9_-\]\{4,40\}\$\/\.test\(c\)/.test(PAGE) && /Date\.now\(\)-o\.t < CONFIG\.eventoOre\*3600000/.test(PAGE));
t('137 pagina: i testi dell\'evento passano da esc (titolo e messaggio col nome)', /<b>'\+esc\(title\)\+'<\/b>'\+esc\(msg\)/.test(PAGE));
t('138 pagina: accesso con ritorno alla pagina (account clienti nuovi)', /'\/customer_authentication\/login\?return_to='\+encodeURIComponent\(location\.pathname\+location\.search\)/.test(PAGE));
t('139 pagina: codici con escape, "usato" solo se il server manda used_at, Copia solo sui codici da usare e nel premio', /esc\(x\.discount_code\)/.test(PAGE) && /if\(x\.used_at\) return '<li class="cod used">/.test(PAGE) && (PAGE.match(/class="cp tap"/g) || []).length === 2);
t('140 pagina: memory col mazzo dal server, riserva se le foto non arrivano, premio solo da memory_win', /api\('deck'\)/.test(PAGE) && /DECK = ok\.length>=CONFIG\.coppie \? ok\.slice\(0,CONFIG\.coppie\) : RISERVA/.test(PAGE) && /api\('memory_win'\)/.test(PAGE));
t('141 pagina: contatore dei punti con arrivo garantito (non dipende dai fotogrammi)', /node\._end=setTimeout\(\(\)=>\{ if\(node\._to===to\) node\.textContent=to; \},900\)/.test(PAGE));
t('142 pagina: la Mimi\' e\' un segnaposto unico che build.mjs riempie da src/mimi.webp', PAGE.split('__MIMI_DATA_URI__').length === 2 && /html\.split\(MIMI_TOKEN\)\.length !== 2/.test(BUILD) && /readFileSync\(DIR \+ 'src\/mimi\.webp'\)\.toString\('base64'\)/.test(BUILD));
t('143 build: pagina di prima come default, nuova con ?v=2, {% endraw %} vietato nelle sorgenti', /searchParams\.get\("v"\) === "2"/.test(BUILD) && /v2 \? BODY : BODY_V1/.test(BUILD) && /\/\\\{%-\?\\s\*endraw\\s\*-\?%\\\}\/\.test\(html\)/.test(BUILD));
t('144 la pagina di prima e\' conservata INTATTA per il rollback (impronta sha256 del file a fine riga LF)', createHash('sha256').update(PAGE_V1, 'utf8').digest('hex') === '38bfde203efcdf362e3e3cd6180c93cbe4f75cad4c6120a2e3708a7c29320d3b');
t('145 pagina: niente emoji ne\' caratteri oltre U+2000 (tranne il puntino di sospensione)', ![...PAGE].some((ch) => ch.codePointAt(0) > 0x2000 && ch !== '…'));

console.log('\n== Gate 2 dell\'11-10 (revisione indipendente): rilievi chiusi ==');
const redeemHandler = PAGE.slice(PAGE.indexOf("let idempRiscatto=null;"), PAGE.indexOf('// === memory con le foto vere'));
t('146 G2-1 riscatto: un solo token per tentativo, il Riprova rimanda lo stesso; si butta solo a risposta definitiva', /const idemp = idempRiscatto \|\| \(idempRiscatto='r-'\+Date\.now\(\)/.test(redeemHandler) && (redeemHandler.match(/idempRiscatto=null;/g) || []).length === 3 && /if\(data && data\.ok\)\{\s*\n\s*idempRiscatto=null;/.test(redeemHandler) && /else if\(data && data\.reason\)\{\s*\n\s*idempRiscatto=null;/.test(redeemHandler) && !/else \{ toast\('Riprova fra poco'\);[^\n]*idempRiscatto=null/.test(redeemHandler));
t('147 G2-2 api(): corpo non JSON = errore, errore HTTP senza motivo = errore; mai una risposta vuota scambiata per buona', /if\(!data \|\| typeof data!=='object'\) data = \{ error:'bad_response' \};/.test(PAGE) && /else if\(!r\.ok && !data\.error && !data\.reason && !data\.state\) data\.error = 'http_'\+r\.status;/.test(PAGE) && !/let data = \{\}; try \{ data = await r\.json\(\); \} catch\(e\)\{\}\s*\n\s*return/.test(PAGE));
t('148 G2-2 il profilo si disegna solo con un saldo numerico; coccola e memory muovono i punti solo con un saldo dal server', /if \(status===503 \|\| data\.error \|\| typeof data\.points!=='number'\) return showGate\(/.test(PAGE) && (PAGE.match(/if\(data\.error \|\| typeof data\.points!=='number'\)\{ toast\('Riprova fra poco'\); return; \}/g) || []).length === 2);
t('149 G2-8 "%" solo per un premio a percentuale (percento()), mai rw.value o x.value stampati a mano', /function percento\(o\)\{ return \(o && \(o\.kind==null \|\| o\.kind==='percentage'\) && Number\(o\.value\)>0\) \? Number\(o\.value\) : 0; \}/.test(PAGE) && !/esc\(rw\.value\)|rw\.value\+'%'|x\.value\+'%'|esc\(val\)/.test(PAGE));
t('150 G2-9 i giorni dei codici arrivano dal server in Europe/Rome (created_day, used_day)', /itDate\(x\.created_day\|\|x\.created_at\)/.test(PAGE) && /itDate\(x\.used_day\|\|x\.used_at\)/.test(PAGE));
t('151 G2-10/11 presenze spente = avviso, coccola un tap alla volta, liste del tracciamento senza nomi mai mandati', /evtNote\('Presenze non attive'/.test(PAGE) && /if\(!S \|\| !S\.coccola_disponibile \|\| coccolaInCorso\) return;/.test(PAGE) && !allowed.includes('percorso') && allowed.every((n) => trackNames.includes(n) || ['redeem_ready', 'redeem_locked', 'redeem_pending', 'nanna', 'wear'].includes(n)), allowed.filter((n) => !trackNames.includes(n)).join(','));   // redeem_* nascono da dataset.trk; nanna e wear servono alla pagina di prima
const CKSQL = read('tests/loyalty_checkin_idempotenza.sql');
t('152 G2-6 prova viva delle presenze: blocco unico che finisce SEMPRE in rollback, copre flag spento, esiti, doppia presenza, tetto, UNIQUE, ledger', /^do \$\$/m.test(CKSQL) && /raise exception 'TEST_OK:[^']*\(rollback voluto\)';\s*\nend \$\$;\s*$/.test(CKSQL) && ["'off'", "'unknown_event'", "'not_started'", "'ended'", "'full'", 'unique_violation', 'v_loyalty_ledger_drift', 'already'].every((w) => CKSQL.includes(w)) && !/\bcommit\b/i.test(CKSQL.replace(/^\s*--[^\n]*$/gm, '')));
const MOCK = read('tests/loyalty_page_mock.js');
t('153 G2-6 il server finto sa perdere una risposta, rispondere senza JSON e riconoscere lo stesso idemp', /redeemMode === 'lost'/.test(MOCK) && /if \(idemp && fatti\[idemp\]\) return reply\(\{ ok: true, already: true/.test(MOCK) && /r\.raw !== undefined/.test(MOCK));

console.log('\n== CASI_APERTI 32: ask_ro legge le tabelle loyalty_* (migr 0151) ==');
const M151 = read('supabase/migrations/0151_ask_ro_loyalty_policy.sql');
const T151 = ['loyalty_points', 'loyalty_events', 'loyalty_order_credits', 'loyalty_order_reversals', 'loyalty_rewards', 'loyalty_redemptions', 'loyalty_reward_codes', 'loyalty_visits', 'loyalty_profiles', 'loyalty_birthday_awards', 'loyalty_bonus_second', 'loyalty_ui_events'];
const ASKSQL = read('tests/loyalty_ask_ro_policy.sql');
t('154 0151: le 12 tabelle loyalty_* precedenti alla 0150 hanno una policy for select to ask_ro', T151.every((tb) => M151.includes("'" + tb + "'")) && /create policy %I on public\.%I for select to ask_ro using \(true\)/.test(M151));
t('155 0151: nessun grant ne\' scrittura (i limiti a colonne restano quelli decisi)', !/^\s*(grant|revoke|insert|update|delete|alter table)\b/mi.test(M151.replace(/^--.*$/gm, '')));
t('156 0151: prova viva ask_ro contro owner, colonne vietate ancora vietate, finisce sempre in rollback', /TEST_OK loyalty 0151/.test(ASKSQL) && /birth_day leggibile/.test(ASKSQL));

console.log(`\nloyalty_guardie: ${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
