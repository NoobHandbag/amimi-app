# Premia / Area Membri: runbook operativo

> Per Claude Code e owner. Scritto il 2026-09-21 dalla quest audit (`Cowork12/projects/Premia_Area_Membri_2026-09/07_AUDIT_*`), aggiornato a fine Fase 6 (go-live del 21-09) il 22-09 per il brief M4b (profilo + compleanno, tier sui punti cumulati, bonus seconda borsa: §12) e il 27-09 per la dashboard nell'app e il tracciamento (§13). Vale per il modulo `loyalty_*` + `mimi_state` + edge `loyalty-proxy` (v13), `loyalty-orders` (v3), `loyalty-page`. Le regole vincolanti restano `REGOLE_FERREE.md` (19 modulo isolato, 20 idempotenza a DB) e il "mai toccare il tema Symmetry".

## 0. Mappa in 10 righe

- Pagina: `https://amimi.it/apps/premia/club` (App Proxy Shopify -> `loyalty-proxy` rotta `/club` -> HTML da `loyalty-page`). Login = account cliente Shopify; l'identita' arriva SOLO nel query param firmato `logged_in_customer_id`; la firma vale 300 s (`timestamp` firmato).
- Azioni cliente (tutte via App Proxy, firma HMAC del client secret): `state`, `coccola`, `memory_win`, `nanna`, `wear`, `rewards`, `redeem`, dal 22-09 `profile` / `profile_save` (§12) e dal 27-09 `track` (§13, flag `loyalty_track_enabled` ACCESO per tutte dal 28-09 con OK owner). I premi dei giochi passano dalla RPC `loyalty_award_daily` (cancello "1 al giorno" e accredito atomici).
- Acquisti -> punti: edge `loyalty-orders` v3 (Admin API GraphQL `2026-07`, PIN come le altre edge del cron), action `run` ogni 15 minuti (cron `loyalty-orders-poll`, minuti 10/25/40/55), `backfill` a mano, `refunds`, `diag`; 1 pt per EUR di `subtotal` (IVA inclusa, dopo sconti, senza spedizione), una volta per ordine (PK `loyalty_order_credits.shopify_order_id`), `order_name` come ponte verso `shopify_orders`/`shopify_line_items`.
- Resi: storno proporzionale e idempotente (RPC `loyalty_reverse_order`, stato in `loyalty_order_reversals`), da due fonti: ordini con rimborso nella finestra Shopify e coda DB `v_loyalty_refunds_due`.
- Riscatto: RPC `loyalty_redeem` (detrazione con guardia saldo, idemp UNIQUE, ramo `already` solo del proprietario) + `loyalty_claim_code` (idempotente: mai un secondo codice). Pool di codici sconto Shopify pre-generati; pool vuoto = redemption `pending`.
- Flag (`app_flags`): `loyalty_purchase_enabled` (ON dal 21-09), `loyalty_redeem_enabled` (ON), `loyalty_click_enabled` (clicker, OFF), `loyalty_euro_per_point` (1), `loyalty_orders_since` (watermark `2026-09-21T00:08:09Z`), `loyalty_orders_last_run` (cursore del giro), `loyalty_pool_min` (20), `shopify_app_proxy_secret`; dal 22-09 (migr 0141, tutti OFF) `loyalty_profile_enabled`, `loyalty_tier_lifetime_enabled`, `loyalty_bonus_second_enabled` e il cursore `loyalty_bonus_second_since` (§12). I tre flag nuovi accettano anche una lista di `shopify_customer_id` separati da virgola = acceso SOLO per quei clienti.
- KPI e allarmi: viste `v_loyalty_*`, `loyalty_health_check()` alle 06:12 UTC -> `health_log` chiavi `loyalty_*` (migr 0137); le edge scrivono `loyalty_orders`, `loyalty_backfill`, `loyalty_refunds`; i giri SQL del 22-09 scrivono `loyalty_birthday` (06:20 UTC) e `loyalty_bonus_second` (06:25 UTC), anche a flag OFF (riga `ok` "nessun giro").
- Sorgente della pagina: `supabase/functions/loyalty-page/src/index.html` (identica a `Cowork12/projects/Premia_Area_Membri_2026-09/PROD/index.html`); `index.ts` si GENERA con `build.mjs`.
- Guardie: `tests/loyalty_guardie.mjs` (177 pin sul sorgente, bloccante), `tests/loyalty_smoke.mjs` (9 probe di produzione in sola lettura) e `tests/loyalty_profilo_idempotenza.sql` (prova viva delle RPC della 0141 sull'account di test, in un blocco che si annulla da solo: esito atteso `TEST_OK`).
- Dashboard per l'owner: tab "Premia" nell'app (`#premia`, login @amimi.it), RPC `loyalty_dashboard` solo aggregati (§13).
- Dal 11-10 (call del 09-10, migr 0150, `loyalty-proxy` v14): pagina a soli punti con percorso, eventi con QR (`checkin`), elenco dei codici con "usato", memory con le foto (`deck`), due pagine dietro `loyalty_page_v2` e `?anteprima=1`: tutto nel §14. Livelli, timbri, nanna e "indossa" valgono solo per la pagina di prima.
- Regola d'oro: **rollback = flag OFF.** Nulla del modulo tocca CE, stock, checkout o tema.

## 1. Deploy sicuro di una edge del modulo

```bash
# 0. baseline Regola 19 (annotare i numeri)
#    select omni_netto, mc2 from v_ce_totale_summary where year=<Y> and month=<M>;
#    select sum(giacenza_attuale), round(sum(valore),2), count(*) from v_inventory;
# 1. git backup PRIMA del deploy: branch, commit, push (policy dal 18-09: mai su main diretto)
# 2. pagina: rigenerare e verificare; guardie sul sorgente
node supabase/functions/loyalty-page/build.mjs && node supabase/functions/loyalty-page/build.mjs --check && node tests/loyalty_guardie.mjs
# 3. deploy (config.toml pinna verify_jwt=false per le tre edge; il flag esplicito resta buona abitudine)
npx supabase functions deploy <loyalty-proxy|loyalty-orders|loyalty-page> --project-ref imszbjeyplaiovylhkgl --no-verify-jwt --workdir <cartella amimi-app>
# 4. bundle vivo == repo (mai fidarsi del numero di versione)
npx supabase functions download <nome> --project-ref imszbjeyplaiovylhkgl --workdir <tmp> && diff --strip-trailing-cr <tmp>/supabase/functions/<nome>/index.ts supabase/functions/<nome>/index.ts
# 5. smoke in sola lettura + baseline Regola 19 DOPO (deve essere identica)
node tests/loyalty_smoke.mjs
# 6. changelog: Cowork12/docs/_CHANGELOG_CODE.md (file canonico nella cartella OneDrive, append ancorato) + docs/EDGE_FUNCTIONS.md
```

Se dopo il deploy `amimi.it/apps/premia/state` risponde 401 con un JWT error: `verify_jwt` e' tornato `true`. Rideploy con `--no-verify-jwt` (e controllare che `config.toml` abbia la sezione `[functions.<nome>]`).

## 2. Go-live: cosa e' stato fatto il 2026-09-21 e cosa resta

Parametri owner del 20-09: G1 retroattivo TUTTO lo storico a 1 pt/EUR; G2 resi STORNANO i punti; G3 tier sul saldo spendibile (**rivisto il 22-09: tier sui punti CUMULATI, cioe' tutto tranne i riscatti; in produzione dietro `loyalty_tier_lifetime_enabled`, oggi OFF, quindi la pagina mostra ancora il tier sul saldo finche' l'owner non accende il flag**, §12); G4 pagina NON linkata fino alla campagna.

Eseguito (Fase 6, con la sequenza del punto 2 originale): fix L1-L9/T1/T2/T9/T16/T33 deployati (migr 0136, `loyalty-orders` v3, `loyalty-proxy` v11, pagina), smoke 9/9 e guardie 52/52, Regola 19 identica prima e dopo ogni deploy; storno provato dalla edge sull'ordine di test `#1781` (-50); pool: tolti i 3 codici ristretti al cliente di test (dal pool e da Shopify), caricato il lotto generico `PREMIA-XXXXXX` del 21-09 (§4); watermark `loyalty_orders_since = 2026-09-21T00:08:09Z`; `loyalty_purchase_enabled = true`; backfill della finestra visibile all'API (ordini dal 2026-07-23, tetto dei 60 giorni dello scope `read_orders`) a chunk mensili con dryRun prima: **248 ordini, 239 clienti, 26.216 punti**, 1 ordine parzialmente rimborsato stornato di 51 punti, ripetizione di un chunk = 0 accrediti (idempotenza); giro `run` reale e cron `loyalty-orders-poll` (migr 0138) attivo; `loyalty_redeem_enabled` resta `true`; pagina NON linkata (G4).

**Retroattivo completato (21-09, 10:47-10:52 UTC):** il token appartiene all'app Dev Dashboard **"Google Sheets Connector"** (id 325182062593, NON a "Gestionale AMIMI Sync"); l'owner ha rilasciato la versione `google-sheets-connector-5` con `read_all_orders` (piu' `write_discounts`, `read_analytics`, `read/write_price_rules`, `read/write_gift_cards`, `read/write_discounts_allocator_functions`: gli ultimi tre gruppi non servono e si possono togliere in una versione futura) e accettato le autorizzazioni dal negozio (Impostazioni -> App e canali di vendita -> Google Sheets Connector -> Apri app -> Aggiorna); il token e' rimasto lo stesso. `diag` elenca lo scope; backfill Feb-Lug a chunk mensili con dryRun prima: **520 ordini, +58.155 punti, 5 storni per -303 punti**, ripetizione = 0 accrediti. Non accreditati e giusto cosi': `#1001` (ordine di test senza cliente) e `#1043`, `#1048`, `#1049` (REFUNDED in Shopify, `paid` nel DB perche' `shopify-sync` aggiorna i rimborsi solo entro 45 giorni: la verita' e' l'API). Stato dopo: 739 membri, 84.389 punti == eventi, 770 accrediti, 34 membri con almeno 200 punti.

**Resta (owner):**

1. Facoltativo: nuova versione dell'app senza gli scope inutili (buoni regalo, analisi, regole di prezzo).
2. Decisioni aperte D-L1..D-L7 (`05_PROGRAMMA_Premia_design.md`): base punti IVA inclusa (oggi si'), ordini staff/bozza (oggi accreditati), scadenza codici (oggi nessuna), ospiti, boutique, modifiche ordine, saldo negativo (oggi impossibile per vincolo).
3. Account di test: oggi membro interno con 247 punti (§11); reset o tenerlo.
4. Giorno campagna: §9.

## 3. Rollback (in ordine di gravita')

| Sintomo | Azione | Effetto |
|---|---|---|
| Accrediti sbagliati | `update app_flags set value='false' where key='loyalty_purchase_enabled'` (il cron diventa NO-OP; per fermarlo del tutto `select cron.alter_job((select jobid from cron.job where jobname='loyalty-orders-poll'), active := false)`) | nessun nuovo accredito o storno; lo storico resta e si corregge a mano con eventi `manual_adjust` tracciati |
| Riscatti sbagliati o pool compromesso | `loyalty_redeem_enabled='false'` | la card riscatto sparisce dalla pagina; i codici gia' emessi restano validi in Shopify (disattivarli da admin se serve) |
| Pagina rotta | rideploy dell'ultima `loyalty-page` buona (`git checkout <commit> -- supabase/functions/loyalty-page && deploy`) | la pagina e' statica: zero effetti sui dati |
| loyalty-proxy rotta | rideploy dell'ultimo commit buono | giochi e stato tornano; i punti sono a DB, nulla si perde |
| Profilo/compleanno sbagliati | `loyalty_profile_enabled='false'` (la card sparisce, `profile_save` risponde `off`, il cron compleanni diventa NO-OP) | i profili salvati restano in `loyalty_profiles`; un +10/+20 sbagliato si corregge con `manual_adjust` motivato |
| Tier cumulato sbagliato | `loyalty_tier_lifetime_enabled='false'` | la pagina torna al tier sul saldo; nessun punto si muove (il tier e' solo una vista) |
| Bonus seconda borsa sbagliato | `loyalty_bonus_second_enabled='false'` (cron NO-OP, riga sparisce dalla pagina) | i bonus gia' dati restano (stato in `loyalty_bonus_second`); per fermare del tutto `cron.alter_job(..., active := false)` su `loyalty-bonus-second-daily` |
| Tutto il modulo | i sei flag `false` + la pagina resta raggiungibile solo a chi ha l'URL (non e' linkata) | il negozio non se ne accorge: il modulo non tocca commerce |

## 4. Pool di codici sconto (ricarica)

Il pool si consuma un codice per riscatto (`loyalty_claim_code`, idempotente). Stato al 23-09: premio attivo `amica12`, lotto `2026-09-23` di 1.000 codici `AMICA12-XXXXXX` (due tranche, 200 + 800) (creati dal connettore Shopify con `discountCodeBasicCreate`, `context: {all: ALL}`, 12%, uso singolo, non cumulabile), i 61 codici 20% liberi cancellati da Shopify con `discountCodeBulkDelete` (resta solo `PREMIA-T20-6KQ4ZM`, usato, come storico). Allarme `loyalty_pool` warn sotto `loyalty_pool_min` (20), error a 0 con riscatto ON. Stima del fabbisogno: `select count(*) from loyalty_points where points >= (select min(cost_points) from loyalty_rewards where active)` (i membri che possono riscattare oggi: 34 con `tessera` a 200, 467 con `amica12` a 100) piu' i riscatti attesi nella settimana di campagna. Con la Parte D (§12) il lotto nuovo e' al 12% (`percentage: 0.12`, titolo `Premia - Amica 12% (lotto <data>) AMICA12-XXXXXX`, `reward_key = 'amica12'` nell'insert) e va caricato PRIMA di accendere `amica12`, altrimenti i riscatti restano `pending`.

Il token dell'app NON ha `write_discounts`: i codici si creano dal connettore Shopify (Claude Code, `graphql_mutation`) o dall'admin, MAI dal tema ne' dalle edge. Formato `PREMIA-<6 caratteri da ABCDEFGHJKLMNPQRSTUVWXYZ23456789>` (niente I, O, 0, 1), titolo `Premia - Tessera 20% (lotto <data>) <codice>`, un discount per codice (uso singolo per chiunque; un solo discount con molti codici NON va bene perche' `appliesOncePerCustomer` e `usageLimit` valgono per l'intero discount). Mutazioni con alias, 20 per chiamata:

```graphql
mutation { c1: discountCodeBasicCreate(basicCodeDiscount: { title: "Premia - Tessera 20% (lotto 2026-09-21) PREMIA-XXXXXX", code: "PREMIA-XXXXXX", startsAt: "2026-09-21T00:00:00Z", usageLimit: 1, appliesOncePerCustomer: true, combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }, customerSelection: { all: true }, customerGets: { value: { percentage: 0.2 }, items: { all: true } } }) { codeDiscountNode { id } userErrors { field message } } c2: ... }
```

Poi (solo i codici creati senza `userErrors`):

```sql
insert into loyalty_reward_codes (code, reward_key) values ('PREMIA-XXXXXX','tessera'), ... on conflict do nothing;
select * from v_loyalty_pool;
```

Scadenza: decisione D-L3 (proposta 90 giorni con `endsAt`). Se si adotta, il lotto va rigenerato per tempo e i codici scaduti tolti dal pool (`delete from loyalty_reward_codes where claimed_by is null and code in (...)`, poi `discountCodeDelete` in Shopify).

## 5. `loyalty-orders` v3: giro manuale, backfill, storno, diagnosi

Tutte le chiamate sono POST JSON con `pin` (lo stesso PIN neutro degli altri cron; senza, 401). A flag OFF rispondono solo `dryRun` e `diag`.

```bash
U=https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/loyalty-orders
# diagnosi: versione API richiesta/servita, scope del token, flag (nessuna scrittura)
curl -s -X POST $U -H 'content-type: application/json' -d '{"action":"diag","pin":"x"}'
# anteprima del giro normale e giro reale
curl -s -X POST $U -H 'content-type: application/json' -d '{"action":"run","dryRun":true,"pin":"x"}'
curl -s -X POST $U -H 'content-type: application/json' -d '{"action":"run","pin":"x"}'
# backfill a chunk mensili (idempotente: rilanciare non doppia mai). since obbligatorio, until default = watermark,
# max accrediti per chiamata 300 (fino a 1000): se resta qualcosa la risposta da' next_since
curl -s -X POST $U -H 'content-type: application/json' -d '{"action":"backfill","dryRun":true,"pin":"x","since":"2026-02-01T00:00:00Z","until":"2026-03-01T00:00:00Z"}'
curl -s -X POST $U -H 'content-type: application/json' -d '{"action":"backfill","pin":"x","since":"2026-02-01T00:00:00Z","until":"2026-03-01T00:00:00Z"}'
# storno dalla sola coda DB (v_loyalty_refunds_due)
curl -s -X POST $U -H 'content-type: application/json' -d '{"action":"refunds","dryRun":true,"pin":"x"}'
```

**Attenzione ai bordi dei chunk:** il filtro di ricerca Shopify `created_at:<T` include TUTTO il giorno di `T` (granularita' a giorno), quindi chunk mensili contigui si sovrappongono di un giorno e il secondo conta gli ordini del primo giorno come `skipped` (gia' accreditati): innocuo per idempotenza (Regola 20), ma i totali per chunk vanno letti al netto degli skip. Leggere in risposta `fetched`, `candidati`, `credited`, `added`, `skipped` (gia' accreditati o a 0 punti), `resto`, `reversed_*`, `errors`, `api_version`; in `health_log` le chiavi `loyalty_orders` (giro), `loyalty_backfill`, `loyalty_refunds`. Un secondo giro identico deve dare `credited: 0`. Il giro normale legge gli ordini AGGIORNATI da min(ora - 3 giorni, ultimo giro - 1h) e accredita solo quelli creati dopo il watermark, fino a 100 per giro (il resto al giro dopo).

## 6. Resi e storno (G2)

Politica: rimborso totale o annullamento = storno totale dei punti dell'ordine; rimborso parziale = storno proporzionale (`refunded / subtotal`, tetto 1,0); mai sotto zero (si limita al saldo e riprova al giro dopo). Stato per ordine in `loyalty_order_reversals` (quanto stornato finora) + evento `refund_reversal`. Due fonti, entrambe nel giro `run`: gli ordini con `totalRefundedSet > 0` visti nella finestra Shopify (quasi in tempo reale) e la coda DB `v_loyalty_refunds_due` (`shopify_orders.refund_amount`, aggiornato ogni ora da `shopify-sync` per gli ordini toccati negli ultimi 45 giorni). Correzione manuale, se serve: evento `manual_adjust` con `meta.reason`, mai UPDATE diretto dei punti senza evento (invariante ledger, vincolo `points >= 0`).

## 7. Riscatti `pending` (pool vuoto)

`select * from loyalty_redemptions where status='pending' order by created_at;` -> ricaricare il pool (§4) e poi, per ogni pending, `select loyalty_claim_code('tessera', <customer>, <id>)` (idempotente dalla 0136: restituisce il codice gia' assegnato se c'e', non tocca redemption evase o di altri clienti). Avvisare la cliente (oggi a mano: nessuna notifica automatica, Known issue 18).

## 8. Incidenti

| Caso | Come si vede | Cosa fare |
|---|---|---|
| Edge giu' / PostgREST 504 | pagina in "Un attimo..." (503 `read_failed`), `health_log` `loyalty_orders` error | attendere/rilanciare; le letture sono fail-closed, nessuna scrittura parziale; se persiste > 1h, aprire un caso in `CASI_APERTI.md` (n.19 e' il 504 al minuto :00) |
| Segreto App Proxy ruotato | tutte le chiamate 401 `bad_signature` | aggiornare `app_flags.shopify_app_proxy_secret` col nuovo client secret (canale sicuro, mai in repo/chat/log) |
| Orologio o replay | 401 `stale_signature` | la firma vale 300 s dal `timestamp` firmato da Shopify: un 401 isolato e' un replay o una pagina rimasta aperta; se sono tutti, controllare l'orologio del runtime |
| Versione Admin API ritirata | `health_log` `loyalty_orders` **warn** con "API servita X, pinnata Y" (la edge confronta `x-shopify-api-version` a ogni giro) | calendario §10; aggiornare `API_VERSION` in `loyalty-orders` e `loyalty-proxy`, `diag`, `dryRun`, deploy |
| Scope del token cambiato | `diag` non elenca `read_orders`/`read_customers`/`read_all_orders`, giro con `Shopify HTTP 4xx` | l'app del token e' "Google Sheets Connector" nel Dev Dashboard (`dev.shopify.com/dashboard/200975974/apps/325182062593/versions/new`): nuova versione con gli scope, poi Apri app -> Aggiorna nel negozio; senza `read_all_orders` = solo 60 giorni di ordini (`fetched: 0` sul passato NON e' "nessun ordine") |
| Ledger fuori quadra | `health_log` `loyalty_ledger` error con gli id | `select * from v_loyalty_ledger_drift where diff <> 0;` poi correggere con `manual_adjust` motivato; cercare la causa in `loyalty_events` (tutte le scritture sono RPC atomiche: un drift e' un bug o un UPDATE a mano) |
| Pool a zero con riscatto ON | `loyalty_pool` error, redemption `pending` | §4 e §7 |
| Cron acquisti fermo | `loyalty_orders_fresh` error | `select * from cron.job where jobname='loyalty-orders-poll'`; `cron.alter_job(..., active := true)`; giro manuale §5: la finestra si allarga da sola fino all'ultimo giro riuscito |
| Clone divergente | il doc "non c'e'" o e' vecchio | `git fetch` e dire QUALE clone si e' guardato (CONOSCENZA 11-08); i cloni canonici stanno sotto `GESTIONALE AMI CLAUDE` |

## 9. Giorno della campagna (G4: il link arriva solo allora)

1. `node tests/loyalty_smoke.mjs` verde; `select * from v_loyalty_pool` con lotto sufficiente (stima: membri con >= 200 punti + riscatti attesi nella settimana x 2); il retroattivo prima del 23-07 fatto (§2 punto 1) o comunicato come "punti dal 23 luglio".
2. Shopify admin -> Online Store -> **Navigation** (menu, non codice del tema): voce "Premia" -> URL `/apps/premia/club` nel menu account/footer e, se deciso, nel menu principale.
3. Mail di campagna con il link; nelle prime 48 ore leggere ogni mattina `health_log` `loyalty_*` e `v_loyalty_kpi_daily`.
4. FAQ per l'assistenza: come si accumulano i punti (1 pt/EUR, giochi +5; con i flag del 22-09 accesi anche +10 profilo completo, +20 al compleanno, +50 seconda borsa entro 90 giorni), come si riscatta (oggi 200 pt = 20%; con la Parte D accesa 100 pt = 12% sul prossimo ordine, ripetibile a ogni tessera piena; sempre non cumulabile con altri codici, uso singolo), cosa succede coi resi (storno proporzionale; se il 2° ordine e' reso per intero si storna anche il +50), il livello: con `loyalty_tier_lifetime_enabled` OFF segue il saldo e puo' scendere dopo un riscatto (G3 originale); con il flag ON segue i punti cumulati e scende SOLO per un reso o una correzione, mai per un riscatto (decisione owner 22-09). La data di compleanno non si cambia dalla pagina: una correzione la fa l'assistenza (`update loyalty_profiles set birth_day=..., birth_month=... where shopify_customer_id=...`, tracciata in `change_log` a mano) e un premio dato per errore si storna con `manual_adjust` motivato.

## 10. Calendario deprecazioni e revisioni

| Quando | Cosa | Azione |
|---|---|---|
| 16-10-2026 | fine supporto Admin API `2025-10` | nessuna: le edge sono pinnate a `2026-07` dal 21-09 (diag: richiesta 2026-07, servita 2026-07) |
| **16-07-2027** | fine supporto `2026-07` | pin alla stabile piu' recente in `loyalty-orders` e `loyalty-proxy`, `diag` + `dryRun`, deploy, aggiornare questa tabella; l'health warn "API servita diversa" e' la rete di sicurezza se ci si dimentica |
| ogni trimestre | versioni Shopify (`shopify.dev/docs/api/usage/versioning`), `jsr:@supabase/supabase-js@2`, runtime Deno | leggere il bundle vivo, `node tests/loyalty_guardie.mjs`, smoke |
| ogni mese | `v_loyalty_pool`, `v_loyalty_redeem_rate`, `health_log` `loyalty_*` | ricaricare il pool, tarare `loyalty_pool_min`, rivedere i tier sulle misure reali (con B acceso: `tier_cumulato`) |
| ogni mattina (con A o C accesi) | `health_log` `loyalty_birthday`, `loyalty_bonus_second` | un `error` = giro annullato per intero (nessun punto mosso): leggere il messaggio e rilanciare a mano `select loyalty_birthday_run()` / `loyalty_bonus_second_run()`; un `warn` = resto oltre il tetto di 200 per giro, rilanciare |
| prima di ogni deploy | Regola 19 prima/dopo, `build.mjs --check`, guardie, smoke | vedi §1 |

## 11. Account di test e residui

Cliente `10147859530055` (alepodasca@gmail.com): dal 21-09 uno dei 240 membri, saldo 247 punti (200 `manual_adjust` del 20-09 + giochi, -200 riscatto del 20-09, +50 ordine `#1781` poi stornati -50 col rimborso); 257 il 22-09 dopo altri giochi. Residui: redemption 4 evasa col codice `PREMIA-T20-6KQ4ZM` (ristretto al cliente, uso singolo, ancora valido in Shopify); i 3 codici ristretti liberi sono stati tolti dal pool e cancellati da Shopify il 21-09. Decidere se azzerarlo (`manual_adjust` -247 motivato, redemption e codice lasciati come storico) o tenerlo come membro interno. La prova della 0141 (`tests/loyalty_profilo_idempotenza.sql`) lo usa ma si annulla da sola: nessun profilo e nessun evento nuovo restano a DB.

## 12. Profilo + compleanno, tier cumulato, bonus seconda borsa (brief M4b, 22-09, migr 0141, `loyalty-proxy` v12)

Tre parti indipendenti, ognuna dietro il proprio flag (default `false`); **accensione in produzione solo con OK esplicito dell'owner, parte per parte**. Valore del flag: `true` = tutti, `false` = nessuno, `10147859530055,<altro id>` = solo quei clienti (cosi' si prova sull'account di test con la pagina vera senza accendere per il pubblico). Nulla qui tocca CE, stock, checkout, tema o `write-api`.

| Parte | Flag | Cosa fa | Dove |
|---|---|---|---|
| A Profilo + compleanno | `loyalty_profile_enabled` | card "Il tuo profilo" (giorno e mese di nascita, MAI l'anno; materiale preferito su lista chiusa `cavallino, cocco, vernice, pelle liscia, cotone, nessuna preferenza`, da confermare con l'owner; consenso). Al primo salvataggio completo +10 una sola volta (`profile_complete`). La data non si cambia piu' dalla pagina (`birthday_locked`). Il giorno del compleanno +20 (`birthday`), una volta per anno, solo con consenso e profilo salvato almeno 30 giorni prima; 29/02 = 28/02 negli anni non bisestili; recupero di 3 giorni se il cron salta | tabelle `loyalty_profiles`, `loyalty_birthday_awards`; RPC `loyalty_profile_state`, `loyalty_profile_save`, `loyalty_birthday_run(p_today, p_max=200)`; cron `loyalty-birthday-daily` 06:20 UTC; azioni `profile` (GET) e `profile_save` (POST `{birth_day, birth_month, materiale, consenso}`) |
| B Tier cumulato | `loyalty_tier_lifetime_enabled` | punti cumulati = somma di tutti gli eventi tranne `redeem`; tier Amica 0 / Amica Speciale 150 / Amica del Cuore 400 sul cumulato; la pagina lo usa quando il flag e' acceso, altrimenti il saldo | `v_loyalty_members.punti_cumulati`, `.tier_cumulato` (colonne in coda; `tier_saldo` resta), RPC `loyalty_points_cumulati`, `loyalty_tier_of`; il valore arriva alla pagina dall'azione `profile` |
| C Bonus seconda borsa | `loyalty_bonus_second_enabled` | +50 (`bonus_second`) una volta per cliente quando il 2° ordine accreditato (data ordine da `shopify_orders.created_at_shop`, confronto su giorni Europe/Rome: un ordine il giorno della scadenza vale) arriva entro 90 giorni dal 1° ed e' creato dopo `loyalty_bonus_second_since`; se `since` e' vuoto il primo giro a flag acceso lo fissa a "adesso" una volta sola (non retroattivo; per un'altra data scriverla a mano in ISO). Se il 2° ordine (quello salvato in `loyalty_bonus_second.second_order_id`) viene rimborsato per intero il bonus si storna (`bonus_second_reversal`, mai sotto zero, riprova al giro dopo). Un 1° ordine reso per intero resta il "primo" (scelta conservativa, da confermare con l'owner). Pagina: "Seconda borsa entro il <data>: +50 punti · N giorni" per chi ha 1 ordine e finestra aperta (oggi 360 membri) | tabella `loyalty_bonus_second`; vista `v_loyalty_second_order`; RPC `loyalty_bonus_second_run(p_max=200)`; cron `loyalty-bonus-second-daily` 06:25 UTC |
| D Premio unico 100 pt = 12% (migr 0142, **ACCESO il 23-09 con OK owner**: `amica12` attiva, `tessera` spenta, lotto di 1.000 codici `AMICA12-XXXXXX` caricato (200 + 800 il 23-09), i 61 codici 20% liberi tolti dal pool e cancellati da Shopify) | riga `loyalty_rewards` (`amica12` attiva, `tessera` spenta) | sostituisce 200 pt = 20%. La riga `amica12` (100 pt, `percentage` 12) esiste gia' SPENTA; `loyalty_redeem`/`loyalty_claim_code` leggono costo e valore dalla riga attiva (nessun 200 fisso nel codice: verificato), la pagina deriva i 10 timbri dal costo del premio attivo (10 punti a timbro con `amica12`) e mostra `label` e `value` della riga. Chi ha 200+ punti riscatta piu' volte, un codice per ordine. KPI `v_loyalty_redeem_rate.membri_con_tessera_piena` segue il costo attivo (oggi 34 a 200; 467 a 100). **Prima di accendere**: pool di codici 12% caricato (§4: `reward_key = 'amica12'`, titolo `Premia - Amica 12% (lotto <data>)`, Shopify = scrittura solo con OK owner, stima 467 + margine); **dopo** l'accensione: togliere i 61 codici 20% liberi dal pool e disattivarli in Shopify (OK owner; `PREMIA-T20-6KQ4ZM` resta come storico). Provato in `tests/loyalty_profilo_idempotenza.sql` (108 punti -> codice e saldo 8, stesso idemp = stesso codice, 99 punti = rifiuto, premio spento = `reward_unknown`) | `loyalty_rewards`, RPC esistenti; accensione: `update loyalty_rewards set active = (key = 'amica12') where key in ('tessera','amica12');` rollback: lo stesso con `'tessera'` |

Comandi utili (sola lettura salvo dove detto):

```sql
select key, value from app_flags where key like 'loyalty_%' and key <> 'shopify_app_proxy_secret';
select * from health_log where day = current_date and k in ('loyalty_birthday','loyalty_bonus_second');
select count(*) filter (where n_ordini = 1 and deadline >= now()) finestra_aperta, count(*) filter (where entro_90gg and bonus_points is null) candidati_bonus from v_loyalty_second_order;
select shopify_customer_id, punti_cumulati, tier_cumulato, saldo, tier_saldo from v_loyalty_members where tier_cumulato <> tier_saldo;   -- chi cambierebbe livello col flag B
-- giro a mano (scrive solo a flag acceso; a flag OFF risponde {state:'off'} e lascia una riga ok in health_log):
select loyalty_birthday_run();  select loyalty_bonus_second_run();
-- prova end-to-end sull'account di test SOLO per lui (poi rimettere 'false'):
update app_flags set value = '10147859530055' where key in ('loyalty_profile_enabled','loyalty_tier_lifetime_enabled','loyalty_bonus_second_enabled');
```

Prima di accendere `loyalty_profile_enabled` per il pubblico: l'informativa privacy del sito deve coprire giorno e mese di nascita e il materiale preferito (compito owner, fuori dal codice). Se una cliente ritira il consenso, la data resta salvata (anti-abuso: non puo' reimpostarne un'altra) ma il regalo non parte; una cancellazione vera la fa l'assistenza con `delete from loyalty_profiles where shopify_customer_id = ...` (prima `loyalty_birthday_awards` per la FK). I 30 giorni di anticipo si misurano dal salvataggio della DATA (`birth_set_at`), non dal consenso: chi ha salvato la data mesi prima e spunta il consenso il giorno prima del compleanno incassa (da confermare con l'owner se va stretto). `ask_ro` legge `loyalty_events.meta` (grant 0121): per questo l'evento `birthday` porta solo l'anno, mai la data (Gate 2 A1, migr 0142).

Gate 2 del 22-09 (revisore indipendente sul diff) e cosa e' stato chiuso nella 0142: A1 data nel meta (sopra); B1 lo storno del bonus guarda l'ordine salvato, non il "secondo" ricalcolato dalla vista; B2 il cursore `since` si fissa una volta fuori dal blocco che puo' annullarsi; B3 finestra e scadenza su giorni Europe/Rome, la pagina usa `days_left` dal server; C1 `second_fully_refunded` mai null; C2 `health_log.n` = 0 in errore; C3 la edge rifiuta giorno/mese fuori intervallo e un body `null`; C4 niente date del browser. Nota sulla prova SQL: il passo A3 mette il flag a `true` dentro la transazione, quindi conta anche eventuali profili veri con compleanno oggi; tutto viene annullato dal `raise` finale.

## 13. Dashboard Premia nell'app e tracciamento dell'Area Membri (27-09, migr 0146, `loyalty-proxy` v13)

**Fase 1, dashboard (sola lettura, nessun flag).** Nell'app (PWA) tile "Premia" nella Home di Ale, oppure link diretto `https://noobhandbag.github.io/amimi-app/#premia`. Login @amimi.it come Assistenza, Negozi e Materiali. Una sola lettura: la RPC `loyalty_dashboard(p_days)` (7, 30 o 90 giorni; fuori scala = riportato fra 1 e 365), `SECURITY DEFINER`, eseguibile solo da `authenticated` e con un cancello interno sul JWT (`email` @amimi.it, altrimenti errore 42501). Restituisce SOLO aggregati: nessun codice sconto, nessun id cliente, i flag come `on`/`off`/`test` (mai la lista degli id di prova). Sezioni:

| Blocco | Da dove | Note |
|---|---|---|
| Salute | ultima riga per chiave `loyalty_*` di `health_log` negli ultimi 7 giorni + stato dei flag | ogni voce non verde porta la frase "cosa fare" con il paragrafo di questo runbook (§4 pool, §5 giro accrediti, §7 pending, §8 ledger, §12 giri notturni); una chiave ferma si vede con la sua data |
| Uso | `v_loyalty_kpi_daily` nel periodo, `loyalty_visits` | clienti distinti che hanno aperto l'area, visite cliente-giorno, coccole e giochi, riscatti; barre per giorno |
| Premio AMICA12 | `v_loyalty_pool`, `loyalty_redemptions`, `shopify_orders.discount_codes` | codici liberi e durata stimata (liberi / riscatti al giorno degli ultimi 14), riscattati, **usati al checkout** = ordini con un codice `AMICA12-` (arrivano col sync ordini, qualche ora di ritardo), venduto e sconto dato |
| Membri | `v_loyalty_members`, `v_loyalty_second_order` | fasce di saldo (<50, 50-99, >=100 = puo' riscattare), livelli sul saldo e sui cumulati, finestre seconda borsa aperte e in scadenza, bonus dati. Niente "attivi 30 giorni": il retroattivo del 21-09 ha dato un evento recente a tutti |
| Effetto vendite | `shopify_orders` + `loyalty_order_credits` + `loyalty_visits` | ordini del periodo e quelli di clienti che avevano aperto l'area nei 30 giorni prima: correlazione, non causa. `v_loyalty_uplift` (membri vs ospiti) resta solo come nota: dopo il retroattivo quasi ogni ordine e' di un membro |
| Percorso | `loyalty_visits`, `loyalty_ui_events`, `loyalty_redemptions`, `shopify_orders` | clienti distinti: aperto l'area, visto la card del premio, con punti sufficienti, toccato Riscatta, riscattato, ordini con AMICA12; i passaggi 2-4 esistono solo a tracciamento acceso |

**Fase 2, tracciamento (flag `loyalty_track_enabled`, nato `false`, ACCESO `true` il 28-09 con OK owner; a valore come quelli di §12).** La pagina manda in lotti (max 20 eventi, dopo 4 secondi o quando va in background, `keepalive`) al massimo 60 eventi per caricamento; la edge `loyalty-proxy` v13 azione `track` (POST `{events:[{e, el}]}`, body max 4000 byte, identita' dal param firmato) chiama la RPC `loyalty_track`, che ricontrolla il flag per quel cliente, tiene solo le coppie ammesse e taglia a 20 per chiamata e 300 per cliente al giorno (lock per cliente). Dati salvati in `loyalty_ui_events`: cliente, giorno Europe/Rome, evento, elemento, ora. Nient'altro. Eventi: `page_open`; `view` di `redeem_ready` / `redeem_locked` / `redeem_pending` (la card del premio con il suo stato), `profilo`, `mimi`, `guardaroba`, `bonus2`, `bday` (una volta per caricamento, quando la card e' visibile per meta'); `tap` su `redeem`, `copy_code`, `coccola`, `gioco`, `nanna`, `wear`, `profile_save`. A flag spento la RPC risponde `off`, la edge `{state:'off'}` e la pagina smette di mandare (una sola richiesta per caricamento). Un errore del tracciamento non arriva mai alla cliente. Conservazione 180 giorni: `loyalty_ui_events_purge()` su pg_cron `loyalty-ui-events-purge` alle 06:35 UTC, max 5.000 righe per giro. Vista `v_loyalty_funnel_daily` (ultimi 90 giorni, per Cowork e `ask_ro`).

Accensione (OK owner): prima sull'account di test, poi per tutti.

```sql
update app_flags set value = '10147859530055' where key = 'loyalty_track_enabled';   -- solo account di test
select * from v_loyalty_funnel_daily where day >= current_date - 2;                   -- dopo un giro sulla pagina
update app_flags set value = 'true'  where key = 'loyalty_track_enabled';              -- per tutti
update app_flags set value = 'false' where key = 'loyalty_track_enabled';              -- rollback
```

Prova viva senza residui: `tests/loyalty_dashboard_tracking.sql` (flag spento = niente scritture, flag a lista, liste chiuse, payload non array, tetto 20 e 300, dashboard chiusa a chi non e' @amimi.it e senza JWT, nessun id cliente o codice nel risultato, grant, purge; esito atteso `TEST_OK loyalty 0146`), verde il 27-09 dopo la 0146 e dopo la 0147 (con i controlli K `capped`, L label oscurate, M vista e grant). Pin 89-114 in `tests/loyalty_guardie.mjs`.

Gate 2 del 27-09 (revisore indipendente sul diff): nessun difetto alto; accessi, identita', tetti e grant confermati. Chiusi nella migr **0147** e nello stesso branch: (1) le label di `health_log` possono contenere id cliente (la 0137 elenca i membri fuori quadra) o testo d'errore: la dashboard oscura ogni sequenza di 5+ cifre; (2) la durata del pool divideva per 14 anche un premio attivo da 4 giorni: la RPC da' `giorni_ritmo`; (3) "ordini dopo una visita" contava anche la visita fatta DOPO l'ordine lo stesso giorno: ora serve `loyalty_visits.first_at` prima dell'ordine; (4) funnel: nota per il flag in modalita' prova, percentuale nascosta quando supera il 100% (popolazioni diverse), l'ultimo passaggio e' dichiarato come ordini; (5) ordini AMICA12, vendite e funnel filtrati su `paid`/`partially_refunded`/`refunded` come `v_loyalty_uplift`; (6) il KPI "Riscatti" dell'uso diventa "Richieste di riscatto" con le non riuscite; (7) `capped` di `loyalty_track` sui soli eventi validi; (8) una card piu' alta di due schermi conta come vista quando occupa il 40% dello schermo; (9) il tap "Gioca" si conta solo se il gioco e' disponibile; (10) `v_loyalty_funnel_daily` in `security_invoker`, con SELECT a colonne per `ask_ro` su `loyalty_redemptions` (senza `discount_code` ne' `meta`); (11) un cambio rapido di periodo non mostra una risposta vecchia; (12) la tab Premia e' fra le tab finance (mostra ricavi). Non fatto: (13) la purge da 5.000 righe al giorno basta finche' gli eventi restano sotto quella soglia giornaliera (oggi zero). Da verificare fuori dal codice (preesistente, vale anche per Assistenza, Negozi, Materiali): il cancello @amimi.it si fida dell'email del JWT, quindi in Supabase Auth l'iscrizione pubblica deve restare chiusa o con conferma email.

## 14. Pagina a soli punti con percorso, eventi con QR, codici riscattati, memory con le foto (call del 09-10, 11-10, migr 0150, `loyalty-proxy` v14)

Decisioni della call del 09-10 (owner e socie, transcript nel Registro Call) e dell'owner l'11-10: niente livelli e niente timbri, **solo punti** ("punti Mimi'"); un **percorso** con una bandierina a scacchi a ogni traguardo; premio **ripetibile** (ogni 100 punti uno sconto del 12%, riga attiva `amica12`: nessun numero fisso in pagina); **Mimi' nuova** (adesivo rosso e rosa, `src/mimi.webp`); via "Metti a nanna" e "indossa"; **memory con le foto vere** delle borse; **tutti i codici riscattati visibili**; **+20 punti agli eventi** con un QR. Nulla qui tocca CE, stock, checkout, tema o `write-api`.

### 14.1 Cosa vede la cliente (pagina nuova)

- Saluto con **Mimi' grande che parla** (richiesta owner del 12-10, "Mimi' piu' presente"): in un fumetto dice, in prima persona, la frase che vale per lo stato (chiede la coccola, ringrazia, "Hai uno sconto pronto", "Ancora N punti", "Per oggi abbiamo fatto tutto"); toccarla e' la coccola del giorno (stessa funzione del bottone), a coccola fatta ogni tocco cambia frase; dopo una vittoria al memory, un riscatto o una presenza dice una frase d'occasione. Le frasi stanno tutte in `frasi()` nella sorgente. Mimi' c'e' anche durante il caricamento, sul sentiero (piu' grande), nelle due azioni del giorno, nel guardaroba vuoto, in un saluto finale, in cima alla finestra del premio e sul bordo del memory (salta a ogni coppia). Immagine a 540 px per gli schermi densi.
- Card dei punti col **sentiero a giro** (scelto dall'owner il 12-10 fra cinque opzioni e tre fusioni, prototipo `https://claude.ai/artifact/RGgqA3PDfykGYrZzfVLSF4`): una strada a curve dove un giro vale il costo del premio (oggi 100 punti), con la bandierina a scacchi grande al traguardo e sotto "il tuo sconto" (owner 16-10: tolte le tappe a un quarto, meta' e tre quarti, prima i numeri e poi i pallini). Sopra il costo il bottone "Ritira il 12%" sta all'inizio della strada, alle spalle di Mimi' che riparte verso il prossimo (owner 16-10). Mimi' la percorre camminando: all'apertura parte dall'inizio del giro in corso, poi avanza a ogni coccola, partita o acquisto; al traguardo la bandierina scatta. I giri completati sono i premi pronti, contati sotto con una bandierina ciascuno (cinque al massimo disegnate). Sotto: "Ti mancano N punti allo sconto del 12%" oppure "Hai N sconti del 12% da riscattare" con il bottone "Riscatta". Quando riscatta i punti scendono di un giro intero: Mimi' resta dov'e' e cala solo il numero dei premi pronti. Con "riduci movimento" attivo sul telefono non c'e' animazione.
- "I tuoi codici": tutti i riscatti (fino a 60), prima quelli da usare con il tasto Copia, poi quelli usati ("usato il gg/mm/aaaa"); "In arrivo" per un riscatto senza codice (pool vuoto). Tre visibili, poi "Mostra tutti".
- "Ogni giorno": coccola (+5) e memory (+5). "Come prendi i punti": 1 punto per euro su amimi.it, coccola, memory e, a presenze accese, "+20 con il QR" agli eventi. "Le tue borse": le borse comprate, senza piu' "indossa".
- Card profilo, compleanno e seconda borsa restano come nel §12, dietro i loro flag.
- Accesso: il bottone porta a `/customer_authentication/login?return_to=<questa pagina>` (account clienti nuovi: `account.amimi.it`), cosi' dopo l'accesso si torna qui, anche con `?evento=`.

### 14.2 Due pagine, un interruttore (rollback = flag)

`loyalty-page` contiene due pagine: quella nuova (`src/index.html`, servita con `?v=2`) e quella di prima (`src/index.v1.html`, default). Quale arriva lo decide la rotta `/club` di `loyalty-proxy`:

| Indirizzo | Flag `loyalty_page_v2` | Pagina |
|---|---|---|
| `amimi.it/apps/premia/club?anteprima=1` | qualunque | nuova (per provarla sul sito vero col proprio account) |
| `amimi.it/apps/premia/club` | `false` (default) o non leggibile | di prima |
| `amimi.it/apps/premia/club` | `true` | nuova |
| `amimi.it/apps/premia/club?evento=<CODICE>` | qualunque | nuova (la pagina di prima non conosce i QR e li ignorerebbe in silenzio) |

**Ordine di deploy, obbligato: migr 0150, poi `loyalty-page`, poi `loyalty-proxy`.** L'azione `rewards` della v14 chiama `loyalty_redemptions_for` anche per la pagina di prima: senza la migrazione risponderebbe 503 e la card del riscatto sparirebbe a tutte. Prima di deployare la edge: `select count(*) from pg_proc where proname in ('loyalty_checkin', 'loyalty_redemptions_for', 'loyalty_memory_deck');` deve dare 3. Questo pezzo non e' dietro un flag: tornare indietro vuol dire rideployare la v13 (commit `3f2082c`). Il flag della pagina viene letto con un ritentativo; se resta illeggibile si serve la pagina di prima.

Lancio = `update app_flags set value = 'true' where key = 'loyalty_page_v2';` (scrittura: solo con OK dell'owner). Rollback = rimettere `false`: effetto immediato, nessun deploy. Le due pagine parlano con lo stesso server: la v14 e' compatibile con la pagina di prima e la pagina nuova regge un server v13 (provato nel banco, scenario `server_v13`). Quando la nuova e' stabile: togliere `index.v1.html`, `BODY_V1` e il parametro (un solo commit).

### 14.3 Eventi con QR (+20 punti di presenza)

Un evento e' una riga di `loyalty_checkin_events`. Il QR porta a `https://amimi.it/apps/premia/club?evento=<CODICE>`: un indirizzo con `?evento=` riceve sempre la pagina nuova, anche a `loyalty_page_v2` spento. La pagina chiede l'accesso se serve (il codice resta in attesa 12 ore nel telefono), poi chiama `checkin`: la RPC `loyalty_checkin` da' i punti dell'evento **una volta per cliente**, solo **dentro la finestra oraria** e **sotto il tetto di presenze**. Un QR fotografato e girato in rete non vale fuori orario ne' oltre il tetto.

Creare un evento (scrittura in produzione: solo con OK dell'owner; orari con il fuso, il codice in MAIUSCOLO e non indovinabile):

```sql
insert into loyalty_checkin_events (code, label, points, starts_at, ends_at, max_checkins)
values ('GALLIANO-7KQ4', 'la serata da Galliano', 20, '2026-10-22 18:00+02', '2026-10-22 23:59+02', 300);
```

- `label` finisce nelle frasi "+20 punti Mimi' per <label>" e "I punti per <label> ...": scriverlo in modo che la frase regga ("la serata da Galliano", "il pop-up di via Plinio").
- Un pop-up di piu' giorni e' UN evento con la finestra lunga (massimo 14 giorni): una presenza per cliente per tutto il pop-up.
- Accendere: `update app_flags set value = 'true' where key = 'loyalty_checkin_enabled';` (oppure una lista di `shopify_customer_id` per provarlo solo su account interni). A flag spento il server risponde `{state:'off'}` e la pagina dice "Presenze non attive".
- Spegnere un evento prima della fine: `update loyalty_checkin_events set active = false where code = '...';`.
- Esiti che la cliente vede: presenza registrata (+N), gia' presa, non ancora iniziato (con "Riprova", il codice resta in attesa), finito, punti esauriti (tetto), QR non valido.
- Contare le presenze: `select event_code, count(*), sum(points) from loyalty_checkins group by 1;`. I punti sono in `loyalty_events` con `source = 'event_checkin'` (il ledger resta in quadra: `v_loyalty_ledger_drift` = 0 righe).
- Limite noto: `v_loyalty_kpi_daily` non ha una colonna per le presenze e la dashboard nell'app non mostra i due flag nuovi (la RPC `loyalty_dashboard` ha la lista dei flag fissa). Da aggiungere quando serve.

### 14.4 Codici riscattati e "usato"

`rewards` legge lo storico dalla RPC `loyalty_redemptions_for`: per ogni riscatto il valore del premio di allora (un codice della vecchia tessera resta "20%") e `used_at` = data del primo ordine in `shopify_orders.discount_codes` che contiene quel codice. Arriva con il ritardo del sync ordini (qualche ora al massimo): un codice appena usato puo' restare "da usare" fino al giro dopo. Un codice del pool e' monouso su Shopify, quindi "in un ordine" = non piu' spendibile, qualunque sia lo stato dell'ordine. Il confronto e' esatto sul codice intero (un codice contenuto in un altro non conta), i giorni arrivano gia' in Europe/Rome (`created_day`, `used_day`) e i riscatti falliti non compaiono. **Regola: per cambiare un premio si crea una chiave nuova** (come `amica12` al posto di `tessera`): tipo e valore mostrati accanto a un codice sono quelli della riga del premio di oggi, quindi modificare il valore di una riga gia' riscattata rietichetterebbe i codici vecchi. La pagina scrive "%" solo per un premio `percentage`.

### 14.5 Memory con le foto vere

`deck` chiede alla RPC `loyalty_memory_deck` sei foto di borse a catalogo: schede `active` di `shopify_stock`, codice con `_BAG_`, foto sul CDN Shopify, una a caso per modello (LEA, NINA, ANNIE, AGATA, SOPHIE, VALENTINA, MARIA), cosi' le carte si distinguono. La pagina precarica le foto a 360 px e usa le prime tre che arrivano; se il server o le foto non rispondono gioca con tre carte di riserva (Mimi', scacchi, logo). Il premio resta deciso da `memory_win`. Se una foto non va bene come carta, la via e' cambiare la foto in evidenza della scheda su Shopify (o aggiungere un filtro alla RPC): la pagina non ha una lista a mano.

### 14.6 Prove

- **Banco di prova della pagina** (nessuna chiamata alla produzione): `node tests/loyalty_page_harness.mjs <cartella>`, poi servire la cartella (`python -m http.server 8765 --directory <cartella>`) e aprire `/run.html`: 98 prove su un server finto (`tests/loyalty_page_mock.js`, 48 scenari; i fotogrammi vanno a orologio, cosi' la camminata si prova anche quando il browser non disegna): stati della pagina, punti da 0 a 980, riscatto (codice, in attesa, errore, doppio tap), codici, coccola, memory (foto vere, mazzo di riserva), profilo, tutti gli esiti del QR, testo ostile, server v13, tracciamento, impaginazione a 375/768/1280 px, accessibilita'. `/index.html?s=<scenario>` apre un caso a mano (`&evento=CODICE` per il QR). L'iframe deve restare a schermo: con la finestra del browser coperta i fotogrammi si fermano.
- **Guardie sul sorgente**: `node tests/loyalty_guardie.mjs` (177 pin; 115-153 sono di questa versione, 82-82e fissano il sentiero, 83-83d Mimi' che parla e la coccola col tocco). **Prova viva delle presenze**: `tests/loyalty_checkin_idempotenza.sql`, un blocco che scrive sull'account di test e si annulla sempre (esito atteso `TEST_OK`): si lancia dopo la migrazione, con l'OK dell'owner perche' passa dalla produzione. **Smoke di produzione** in sola lettura: `node tests/loyalty_smoke.mjs` (2c, 2d, 3b, 3c, 6b sono nuovi e diventano verdi solo dopo il deploy della v14).
- **Prova viva**: accesso con un account interno su `amimi.it/apps/premia/club?anteprima=1`; per il QR un evento di prova con finestra di oggi e `loyalty_checkin_enabled` = id dell'account.

### 14.7 Revisione indipendente dell'11-10 (Gate 2) e come e' stata chiusa (Gate 3)

Un revisore separato ha letto il diff prima del deploy. Nessun rilievo che dia punti sbagliati da solo; undici rilievi, tutti chiusi con codice e prova, salvo dove indicato.

1. **Riscatto, risposta persa (ereditato dalla pagina di prima)**: il token `idemp` nasceva a ogni tap, quindi un "Riprova" dopo un 5xx arrivato a riscatto gia' fatto scalava i punti due volte. Ora un token per tentativo, buttato solo a risposta definitiva; il server riconosce lo stesso token (`already`) e rida' il codice. Guardia 146, scenario `riscatto_perso`.
2. **Risposte senza JSON prese per buone (ereditato)**: un 502 del gateway disegnava un profilo a zero punti e una coccola "riuscita". Ora `api()` le marca `bad_response`/`http_<stato>`, il profilo vuole un saldo numerico, coccola e memory muovono i punti solo con un saldo dal server. Guardie 147-148, scenari `gateway`, `senza_saldo`, `coccola_502`, `memory_502`.
3. **Rotta `club`**: flag letto con un ritentativo e `?evento=` che porta sempre alla pagina nuova (prima: un QR sulla pagina di prima non faceva nulla). Guardia 127.
4. **Ordine di deploy**: scritto al §14.2.
5. **`ask_ro` non leggeva le tabelle nuove**: RLS accesa senza policy e ruolo senza `bypassrls` = zero righe senza errore. La 0150 aggiunge la policy di sola lettura alle due tabelle nuove (guardia 125b). **Resta aperto per le tabelle `loyalty_*` piu' vecchie** (stesso difetto, `CASI_APERTI.md`): chi conta da Cowork o dall'assistente legge zero.
6. **Guardie**: la pagina di prima e' fissata con l'impronta sha256 (144); la 125 guarda ogni scrittura della migrazione; il server finto sa perdere una risposta e riconoscere un token (153); prova viva SQL delle presenze (152).
7. **"Usato" per sottostringa**: ora confronto esatto. 8. **Percentuale stampata per ogni premio**: ora solo per `percentage` (149, scenario `premio_importo`). 9. **Giorni tagliati dall'UTC**: ora dal server in Europe/Rome (150, scenario `mezzanotte`). 10. **Promessa dei punti prima di sapere se l'evento vale**: testo neutro e avviso a presenze spente (151). 11. **Igiene**: nomi mai mandati tolti dalle liste del tracciamento, un tap alla volta sulla coccola, controllo `endraw` piu' largo nel build.

Non fatto, per scelta: le finestre (memory, premio) non intrappolano il fuoco del tab, come nella pagina di prima.

### 14.8 Cosa resta a DB ma non si usa piu'

Livelli: `loyalty_tier_of`, `v_loyalty_members.tier_saldo/tier_cumulato`, `loyalty_points_cumulati`, flag `loyalty_tier_lifetime_enabled` (resta `false`; la dashboard nell'app non lo mostra piu'). Mimi': colonne `mimi_state.nanna` e `worn`, azioni `nanna` e `wear` della edge. Nessun drop: la pagina di prima le usa ancora finche' resta come rollback. La copy "1 punto per ogni euro" e "+20 con il QR" e' scritta nella pagina: se cambiano `loyalty_euro_per_point` o i punti degli eventi, va cambiata li'.

### 14.9 Stato del deploy (11-10-2026)

- **Migr 0150** applicata alle 22:36 UTC (`schema_migrations` 20261011223619); i corpi delle quattro funzioni a DB hanno lo stesso md5 del file nel repo. **`loyalty-page`** deployata alle 22:37 (versione di piattaforma 11): la pagina servita senza parametri e' byte per byte quella che era viva prima, `?v=2` e' byte per byte la sorgente nuova. **`loyalty-proxy` v14** deployata alle 22:37 (versione di piattaforma 16), `verify_jwt` false su entrambe. Deploy dal branch `claude/premia-percorso` (commit `4080b83`, contiene `origin/main`), PR amimi-app #38.
- **Flag: `loyalty_page_v2` = `false`, `loyalty_checkin_enabled` = `false`.** Quindi oggi: `/apps/premia/club` = pagina di prima per tutte; la nuova si vede con `?anteprima=1` (e con `?evento=`); nessun evento esiste e le presenze rispondono `off`.
- Regola 19, prima e dopo ogni passo: CE di ottobre 7.716,23 / MC2 5.360,30, giacenze 913 pezzi / 66.968,00 EUR / 203 righe, identici. Ledger: 97.526 punti = 97.526 a eventi (900), zero scarti.
- Prove sul vivo: `tests/loyalty_smoke.mjs` 15/15; `tests/loyalty_checkin_idempotenza.sql` = `TEST_OK` (rollback, zero residui verificati); pagina nuova aperta su `amimi.it/apps/premia/club?anteprima=1` senza accesso (cancello con la Mimi', link di accesso con ritorno, nessun errore in console).
- **Non ancora provato dal vivo: tutto cio' che chiede l'accesso di una cliente** (saldo, percorso, riscatto, codici, memory, presenza dal QR) e il ritorno alla pagina dopo l'accesso. Lo copre il banco di prova su server finto, non una sessione vera: serve un giro con un account interno prima di accendere `loyalty_page_v2`.
- PR amimi-app #38 mergiata in `main` (`e7dccb7`) la sera dell'11-10: il codice vivo e' quello di `main`. Web deployato da `main` subito dopo (l'unica differenza col build precedente `14db5c5` era la tab Premia senza la tabella e l'interruttore dei livelli).
- **12-10, sentiero a giro**: `loyalty-page` rideployata alle 10:17 UTC dal branch `claude/premia-sentiero` (commit `0e4acbc`, contiene `origin/main`). `?v=2` e' byte per byte la sorgente nuova, la pagina di default e' invariata, smoke 15/15, Regola 19 identica prima e dopo (CE di ottobre 7.826,89 / MC2 5.430,03; giacenze 912 pezzi / 66.818,00 EUR / 203 righe). `loyalty-proxy` v14 e i flag non sono stati toccati: la pagina nuova resta visibile solo con `?anteprima=1` o `?evento=`. Revisione indipendente del diff prima del deploy: nessun rilievo grave, i ritocchi (festa finta della bandierina all'apertura, "pronto" con un riscatto in attesa, etichetta per i lettori di schermo, attese del banco) sono chiusi e fissati dalle guardie 82d-82e.
- **12-10, Mimi' piu' presente**: `loyalty-page` rideployata alle 11:14 UTC dal branch `claude/premia-mimi-presente` (commit `b55c8a0`, contiene `origin/main`): `?v=2` e' byte per byte la sorgente nuova, la pagina di default e' invariata, smoke 15/15, Regola 19 identica prima e dopo (CE di ottobre 7.826,89 / MC2 5.430,03, giacenze 912 pezzi / 66.818,00 EUR / 203 righe), flag invariati (`loyalty_page_v2` e `loyalty_checkin_enabled` a `false`). Su `amimi.it/apps/premia/club?anteprima=1` la pagina nuova arriva dal proxy, senza errori in console.

## 15. Recensioni e foto delle borse (decisione owner 12-10, migr 0153, `loyalty-proxy` v15)

### 15.1 Cosa fa
- **La cliente** (Area Membri, sezione "Racconta la tua borsa", visibile solo a flag acceso): una **recensione** = stelle da 1 a 5, almeno due righe (15 caratteri) e fino a 3 foto, solo per una borsa comprata online (controllo a DB su `loyalty_order_credits` -> `shopify_line_items`); un **look** = almeno una foto e fino a 3, per una borsa sua o del catalogo (cosi' vale anche per chi ha comprato in boutique o ai pop-up). Firma facoltativa (40 caratteri), consenso obbligatorio: il testo e' in `loyalty_ugc_consenso()` e ogni invio salva quello accettato. Una per tipo per borsa; dopo un rifiuto la stessa borsa si puo' rimandare. Tetti: 5 invii in 24 ore, 12 foto al giorno.
- **Punti**: recensione +20, look +30 (`loyalty_ugc_points()`), SOLO quando una persona del team approva. L'invio non muove punti.
- **Foto**: rimpicciolite nel telefono (lato lungo 1600 px, JPEG: via anche i dati dello scatto come la posizione), caricate con link firmati nel bucket PRIVATO `loyalty-ugc`, su percorsi `<cliente>/<giorno>-<uuid>.jpg` decisi da `loyalty-proxy`. La RPC di invio accetta solo foto di quella forma, nella cartella di chi invia, caricate davvero e mai usate in un altro invio. Le vede solo chi entra nell'app con un account @amimi.it.

### 15.2 Moderazione (app, tab Premia, card "Recensioni e foto")
- Tre schede: Da approvare, Approvate, Non approvate. **Approva** = punti subito alla cliente (`loyalty_ugc_decide`: gate sulla riga ancora in revisione, punti e ledger nella stessa transazione, una sola volta; un doppio tap o due persone insieme ricevono "gia' decisa"). **Rifiuta** = motivo obbligatorio, che la cliente legge nella sua pagina. Ogni decisione lascia una riga in `change_log` (`ugc_approva` / `ugc_rifiuta`) con l'email di chi ha deciso.
- L'indicazione "acquisto verificato" dice se la borsa risulta fra i suoi ordini online (sempre vero per le recensioni).

### 15.3 Interruttore e rollback
- `loyalty_ugc_enabled`: `'false'` (oggi), lista di `shopify_customer_id` (prova), `'true'` (tutte). Spento: la sezione sparisce, caricamento e invio rispondono `off`. Le approvazioni dall'app restano possibili: sono una scelta di una persona, non un'azione della cliente.
- Prova con l'account di test: `update app_flags set value = '10147859530055' where key = 'loyalty_ugc_enabled';` (solo con l'OK dell'owner).
- Cambiare punti o testo del consenso = una migrazione nuova (le due funzioni sono la sola fonte).

### 15.4 Cose da sapere
- **Foto orfane**: una foto caricata e poi mai inviata (la cliente chiude il modulo) resta nel bucket. In questa fase nessuna pulizia automatica (`storage.objects` non si cancella da SQL: serve l'API di storage). Si contano con: `select count(*) from storage.objects o where o.bucket_id = 'loyalty-ugc' and o.created_at < now() - interval '1 day' and not exists (select 1 from loyalty_ugc u where o.name = any(u.foto));`
- **Fase 2** (non costruita): griglia pubblica dei look, stelline nelle schede prodotto, mail che chiede la recensione dopo la consegna.
- Tracciamento: vista `ugc`, tap `ugc_open`, `ugc_send`, e `mimi` (tocco su Mimi' che cambia frase, rinuncia del Gate 2 del 12-10 chiusa qui).

### 15.5 Prove
- `tests/loyalty_guardie.mjs` 160-172 (punti solo all'approvazione, idempotenza a DB, accesso solo @amimi.it, bucket privato senza policy di scrittura, percorsi decisi dal server, pagina e app).
- Banco della pagina: la sezione "racconta la tua borsa" (flag spento, invio di recensione e di look, foto rimpicciolite a 1600 px, tetto di tre foto, risposta persa con lo stesso idemp senza ricaricare le foto, caricamento rifiutato, tetto del giorno, rifiuto definitivo, testo ostile, Esc e fuoco, 320 px).
- Prova viva `tests/loyalty_ugc_idempotenza.sql` (account di test, si annulla da sola: esito atteso `TEST_OK`).

### 15.6 Stato del deploy
- 12-10: migr 0153 applicata alle 15:23 UTC (le 9 funzioni identiche al repo per md5), prova viva `tests/loyalty_ugc_idempotenza.sql` = `TEST_OK` senza residui (nessuna riga, nessun oggetto nel bucket, flag ancora `false`). `loyalty-page` deployata alle 15:26 UTC (default invariata, `?v=2` byte per byte la sorgente), `loyalty-proxy` v15 alle 15:26 UTC (piattaforma v17, `verify_jwt` false), smoke 15/15, Regola 19 identica prima e dopo (CE di ottobre 7.826,89 / MC2 5.430,03, giacenze 912 pezzi / 66.818,00 EUR / 203 righe), ledger senza scarti. Flag `loyalty_ugc_enabled` a `false`: la sezione non la vede nessuna cliente. App (tab Premia): deploy del web da `main` dopo il merge della PR.
- Non provato dal vivo: il caricamento di una foto vera sul link firmato (provato sul banco e, sul vivo, fino al controllo CORS dello storage) e il giro completo con un account vero. Si prova con il flag acceso solo per l'account di test, con l'OK dell'owner.
- **13-10, giro dal vivo con l'account di test** (OK owner: testo del consenso approvato, `loyalty_ugc_enabled` = `10147859530055`, traccia in `change_log`). Dalla pagina vera su amimi.it, con la sessione dell'account di test: la recensione spiega che serve una borsa comprata online; il look si invia con due foto da 3000x4000 (713 e 519 KB, con dati di posizione e una con orientamento 6), che arrivano nel bucket a 1200x1600 JPEG (120 e 82 KB), senza dati dello scatto e raddrizzate; senza consenso l'invio si ferma. Dall'app (tab Premia, sessione @amimi.it): la coda mostra testi, firma e foto private; Approva col secondo tocco da' +30 (saldo da 172 a 202, una riga nel ledger, `change_log` con chi ha deciso), Rifiuta senza motivo si ferma, col motivo passa. La cliente vede "approvato, +30 punti" e "Non approvato: <motivo>, Da rifare", e la borsa rifiutata si rimanda. Ledger senza scarti, nessuna foto orfana, tap `ugc_open` e `ugc_send` tracciati.
- **Non provata dal vivo: la recensione.** L'account di test non ha borse recensibili: il suo unico ordine accreditato (#1781) e' una riga di prova senza codice ("TEST LOYALTY PREMIA - non evadere"). 833 membri su 839 ne hanno almeno una. La recensione e' provata sul banco e dalla prova viva a DB; dal vivo si prova con un account che ha comprato una borsa online, aggiungendone l'id al flag.
- **Residui di prova** sull'account di test: invii 7 (approvato), 8 (rifiutato) e 9 (in revisione, lasciato all'owner da decidere dall'app), 4 foto nel bucket, +30 punti.
- **13-10, 09:26 UTC, PARTENZA (decisione owner: "partiamo fidandoci delle prove, accendi tutto insieme")**: `loyalty_page_v2` = `true` e `loyalty_ugc_enabled` = `true`, in un'unica istruzione, con due righe in `change_log`. Da quel momento `amimi.it/apps/premia/club` serve a tutte la pagina nuova (sentiero, Mimi' che parla, codici, memory con le foto) con la sezione "Racconta la tua borsa". Prima dell'accensione: 8 controlli di salute `loyalty_*` verdi, ledger senza scarti, 999 codici AMICA12 liberi, 839 membri di cui 552 con almeno 100 punti. Dopo: indirizzo pubblico verificato (pagina nuova, nessun timbro), sessione vera dell'account di test (202 punti, sezione visibile), smoke 15/15, Regola 19 identica (CE di ottobre 8.136,72 / MC2 5.656,66, giacenze 909 pezzi / 66.428,00 EUR / 203 righe). La recensione non e' stata provata dal vivo con un account vero: rinuncia dell'owner, resta provata dal banco e dalla prova viva a DB.
- **Rollback** (ognuno da solo, nessun deploy): `update app_flags set value = 'false' where key = 'loyalty_page_v2';` riporta tutte alla pagina di prima (la nuova resta con `?anteprima=1`); `update app_flags set value = 'false' where key = 'loyalty_ugc_enabled';` nasconde la sezione e ferma caricamenti e invii (gli invii gia' fatti restano, e si possono ancora decidere dall'app).
- **Ancora spenti**: `loyalty_checkin_enabled` (presenze agli eventi col QR: serve la riga dell'evento), `loyalty_profile_enabled`, `loyalty_bonus_second_enabled`, `loyalty_tier_lifetime_enabled`.
- **Prove con amiche e familiari**: la pagina e' di tutte, basta il link e il proprio account. Per far vedere a un gruppo una funzione ANCORA SPENTA per le altre, i flag a valore accettano una lista di `shopify_customer_id` separati da virgola (`loyalty_checkin_enabled`, `loyalty_profile_enabled`, `loyalty_bonus_second_enabled`, e lo stesso `loyalty_ugc_enabled`). `loyalty_page_v2` invece e' solo acceso o spento: a pagina spenta, la nuova si mostra a un gruppo col link `?anteprima=1`.
- **13-10, prova del QR** (richiesta owner): evento `PROVA-QR` ("la prova del QR", +20, dalle 11:43 al 20-10 alle 23:59 ora di Roma, tetto 30) e `loyalty_checkin_enabled` = `10147859530055` (solo l'account di test), con le righe in `change_log`. Verifica dal vivo con un evento usa e getta (`VERIFICA-1013`, tetto 1, poi spento): con la sessione dell'account di test `?evento=VERIFICA-1013` da' "Eccoti qui! +20 punti Mimi' per la verifica di Claude" (saldo da 202 a 222, una riga `event_checkin` nel ledger), la regola "Vieni a un evento Amimi' +20 con il QR" compare, il secondo passaggio da' "Punti gia' presi". Il QR del link `amimi.it/apps/premia/club?evento=PROVA-QR` sta in una pagina privata dell'owner (`https://claude.ai/artifact/BRmgxnZ3L9p7EMYqJNxT5v`), decodificato e controllato uguale al link. Per far provare altre persone: aggiungere i loro id al flag (lista separata da virgole) oppure `'true'`.
