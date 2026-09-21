# Premia / Area Membri: runbook operativo

> Per Claude Code e owner. Scritto il 2026-09-21 dalla quest audit (`Cowork12/projects/Premia_Area_Membri_2026-09/07_AUDIT_*`), aggiornato a fine Fase 6 (go-live del 21-09). Vale per il modulo `loyalty_*` + `mimi_state` + edge `loyalty-proxy` (v11), `loyalty-orders` (v3), `loyalty-page`. Le regole vincolanti restano `REGOLE_FERREE.md` (19 modulo isolato, 20 idempotenza a DB) e il "mai toccare il tema Symmetry".

## 0. Mappa in 10 righe

- Pagina: `https://amimi.it/apps/premia/club` (App Proxy Shopify -> `loyalty-proxy` rotta `/club` -> HTML da `loyalty-page`). Login = account cliente Shopify; l'identita' arriva SOLO nel query param firmato `logged_in_customer_id`; la firma vale 300 s (`timestamp` firmato).
- Azioni cliente (tutte via App Proxy, firma HMAC del client secret): `state`, `coccola`, `memory_win`, `nanna`, `wear`, `rewards`, `redeem`. I premi dei giochi passano dalla RPC `loyalty_award_daily` (cancello "1 al giorno" e accredito atomici).
- Acquisti -> punti: edge `loyalty-orders` v3 (Admin API GraphQL `2026-07`, PIN come le altre edge del cron), action `run` ogni 15 minuti (cron `loyalty-orders-poll`, minuti 10/25/40/55), `backfill` a mano, `refunds`, `diag`; 1 pt per EUR di `subtotal` (IVA inclusa, dopo sconti, senza spedizione), una volta per ordine (PK `loyalty_order_credits.shopify_order_id`), `order_name` come ponte verso `shopify_orders`/`shopify_line_items`.
- Resi: storno proporzionale e idempotente (RPC `loyalty_reverse_order`, stato in `loyalty_order_reversals`), da due fonti: ordini con rimborso nella finestra Shopify e coda DB `v_loyalty_refunds_due`.
- Riscatto: RPC `loyalty_redeem` (detrazione con guardia saldo, idemp UNIQUE, ramo `already` solo del proprietario) + `loyalty_claim_code` (idempotente: mai un secondo codice). Pool di codici sconto Shopify pre-generati; pool vuoto = redemption `pending`.
- Flag (`app_flags`): `loyalty_purchase_enabled` (ON dal 21-09), `loyalty_redeem_enabled` (ON), `loyalty_click_enabled` (clicker, OFF), `loyalty_euro_per_point` (1), `loyalty_orders_since` (watermark `2026-09-21T00:08:09Z`), `loyalty_orders_last_run` (cursore del giro), `loyalty_pool_min` (20), `shopify_app_proxy_secret`.
- KPI e allarmi: viste `v_loyalty_*`, `loyalty_health_check()` alle 06:12 UTC -> `health_log` chiavi `loyalty_*` (migr 0137); le edge scrivono `loyalty_orders`, `loyalty_backfill`, `loyalty_refunds`.
- Sorgente della pagina: `supabase/functions/loyalty-page/src/index.html` (identica a `Cowork12/projects/Premia_Area_Membri_2026-09/PROD/index.html`); `index.ts` si GENERA con `build.mjs`.
- Guardie: `tests/loyalty_guardie.mjs` (52 pin sul sorgente, bloccante) e `tests/loyalty_smoke.mjs` (9 probe di produzione in sola lettura).
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

Parametri owner del 20-09: G1 retroattivo TUTTO lo storico a 1 pt/EUR; G2 resi STORNANO i punti; G3 tier sul saldo spendibile; G4 pagina NON linkata fino alla campagna.

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
| Tutto il modulo | i tre flag `false` + la pagina resta raggiungibile solo a chi ha l'URL (non e' linkata) | il negozio non se ne accorge: il modulo non tocca commerce |

## 4. Pool di codici sconto (ricarica)

Il pool si consuma un codice per riscatto (`loyalty_claim_code`, idempotente). Allarme `loyalty_pool` warn sotto `loyalty_pool_min` (20), error a 0 con riscatto ON. Stima del fabbisogno: `select count(*) from loyalty_points where points >= 200` (i membri che possono riscattare oggi) piu' i riscatti attesi nella settimana di campagna.

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
4. FAQ per l'assistenza: come si accumulano i punti (1 pt/EUR, giochi +5), come si riscatta (200 pt = 20% non cumulabile, uso singolo), cosa succede coi resi (storno proporzionale), perche' il livello puo' scendere dopo un riscatto (G3).

## 10. Calendario deprecazioni e revisioni

| Quando | Cosa | Azione |
|---|---|---|
| 16-10-2026 | fine supporto Admin API `2025-10` | nessuna: le edge sono pinnate a `2026-07` dal 21-09 (diag: richiesta 2026-07, servita 2026-07) |
| **16-07-2027** | fine supporto `2026-07` | pin alla stabile piu' recente in `loyalty-orders` e `loyalty-proxy`, `diag` + `dryRun`, deploy, aggiornare questa tabella; l'health warn "API servita diversa" e' la rete di sicurezza se ci si dimentica |
| ogni trimestre | versioni Shopify (`shopify.dev/docs/api/usage/versioning`), `jsr:@supabase/supabase-js@2`, runtime Deno | leggere il bundle vivo, `node tests/loyalty_guardie.mjs`, smoke |
| ogni mese | `v_loyalty_pool`, `v_loyalty_redeem_rate`, `health_log` `loyalty_*` | ricaricare il pool, tarare `loyalty_pool_min`, rivedere i tier sulle misure reali |
| prima di ogni deploy | Regola 19 prima/dopo, `build.mjs --check`, guardie, smoke | vedi §1 |

## 11. Account di test e residui

Cliente `10147859530055` (alepodasca@gmail.com): dal 21-09 uno dei 240 membri, saldo 247 punti (200 `manual_adjust` del 20-09 + giochi, -200 riscatto del 20-09, +50 ordine `#1781` poi stornati -50 col rimborso). Residui: redemption 4 evasa col codice `PREMIA-T20-6KQ4ZM` (ristretto al cliente, uso singolo, ancora valido in Shopify); i 3 codici ristretti liberi sono stati tolti dal pool e cancellati da Shopify il 21-09. Decidere se azzerarlo (`manual_adjust` -247 motivato, redemption e codice lasciati come storico) o tenerlo come membro interno.
