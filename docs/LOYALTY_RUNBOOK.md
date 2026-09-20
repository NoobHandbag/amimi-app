# Premia / Area Membri: runbook operativo

> Per Claude Code e owner. Scritto il 2026-09-21 dalla quest audit (`Cowork12/projects/Premia_Area_Membri_2026-09/07_AUDIT_*`). Vale per il modulo `loyalty_*` + `mimi_state` + edge `loyalty-proxy`, `loyalty-orders`, `loyalty-page`. Le regole vincolanti restano `REGOLE_FERREE.md` (19 modulo isolato, 20 idempotenza a DB) e il "mai toccare il tema Symmetry".

## 0. Mappa in 10 righe

- Pagina: `https://amimi.it/apps/premia/club` (App Proxy Shopify -> `loyalty-proxy` rotta `/club` -> HTML da `loyalty-page`). Login = account cliente Shopify; l'identita' arriva SOLO nel query param firmato `logged_in_customer_id`.
- Azioni cliente (tutte via App Proxy, firma HMAC del client secret): `state`, `coccola`, `memory_win`, `nanna`, `wear`, `rewards`, `redeem`.
- Acquisti -> punti: edge `loyalty-orders` (poll, action `run` / `backfill`, `dryRun`), 1 pt per EUR di `subtotal` (IVA inclusa, dopo sconti, senza spedizione), una volta per ordine (PK `loyalty_order_credits.shopify_order_id`).
- Riscatto: RPC `loyalty_redeem` (detrazione con guardia saldo, idemp UNIQUE) + `loyalty_claim_code` (pool di codici sconto Shopify pre-generati). Pool vuoto = redemption `pending`.
- Flag (`app_flags`): `loyalty_purchase_enabled`, `loyalty_redeem_enabled`, `loyalty_click_enabled` (clicker, OFF), `loyalty_euro_per_point`, `loyalty_orders_since` (watermark), `loyalty_pool_min`, `shopify_app_proxy_secret`.
- KPI e allarmi: viste `v_loyalty_*`, `loyalty_health_check()` alle 06:12 UTC -> `health_log` chiavi `loyalty_*` (migr 0137).
- Sorgente della pagina: `supabase/functions/loyalty-page/src/index.html` (identica a `Cowork12/projects/Premia_Area_Membri_2026-09/PROD/index.html`); `index.ts` si GENERA con `build.mjs`.
- Regola d'oro: **rollback = flag OFF.** Nulla del modulo tocca CE, stock, checkout o tema.

## 1. Deploy sicuro di una edge del modulo

```bash
# 0. baseline Regola 19 (annotare i numeri)
#    select omni_netto, mc2 from v_ce_totale_summary where year=<Y> and month=<M>;
#    select sum(giacenza_attuale), round(sum(valore),2), count(*) from v_inventory;
# 1. git backup PRIMA del deploy: branch, commit, push (policy dal 18-09: mai su main diretto)
# 2. pagina: rigenerare e verificare
node supabase/functions/loyalty-page/build.mjs && node supabase/functions/loyalty-page/build.mjs --check
# 3. deploy (config.toml pinna verify_jwt=false per le tre edge; il flag esplicito resta buona abitudine)
npx supabase functions deploy <loyalty-proxy|loyalty-orders|loyalty-page> --project-ref imszbjeyplaiovylhkgl --no-verify-jwt --workdir <cartella amimi-app>
# 4. bundle vivo == repo (mai fidarsi del numero di versione)
npx supabase functions download <nome> --project-ref imszbjeyplaiovylhkgl --workdir <tmp> && diff --strip-trailing-cr <tmp>/supabase/functions/<nome>/index.ts supabase/functions/<nome>/index.ts
# 5. smoke in sola lettura + baseline Regola 19 DOPO (deve essere identica)
node tests/loyalty_smoke.mjs
# 6. changelog: Cowork12/docs/_CHANGELOG_CODE.md (file canonico nella cartella OneDrive, append ancorato) + docs/EDGE_FUNCTIONS.md
```

Se dopo il deploy `amimi.it/apps/premia/state` risponde 401 con un JWT error: `verify_jwt` e' tornato `true`. Rideploy con `--no-verify-jwt` (e controllare che `config.toml` abbia la sezione `[functions.<nome>]`).

## 2. Go-live (sequenza, parametri owner del 2026-09-20)

Parametri: G1 retroattivo TUTTO lo storico a 1 pt/EUR; G2 resi STORNANO i punti; G3 tier sul saldo spendibile; G4 pagina NON linkata fino alla campagna.

1. Prerequisiti: fix L1-L9 deployati (Fase 6), `node tests/loyalty_smoke.mjs` verde, baseline Regola 19 annotata.
2. Storno resi attivo e provato sull'account di test (G2) PRIMA di accendere gli acquisti.
3. Pool: togliere dal pool i codici ristretti al cliente di test (`PREMIA-T20-*`), caricare il lotto generico (vedi §4), verificare `select * from v_loyalty_pool`.
4. `update app_flags set value = to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"') where key='loyalty_orders_since';` (watermark = ora del flip).
5. `update app_flags set value='true' where key='loyalty_purchase_enabled';` poi `dryRun` e giro reale a mano (§5), poi il cron (migrazione `cron.schedule('loyalty-orders-poll', ...)`, cadenza 15 min, mai ai secondi :00-:03 per il pattern... il pg_cron parte sempre a :00, la edge ha `retryOnce`).
6. Backfill storico a chunk mensili con dryRun e report dei totali per chunk (§5).
7. `loyalty_redeem_enabled` resta `true`; riscatto di prova con un codice generico sull'account di test, poi ripristino.
8. NON linkare la pagina (G4). Preparare il runbook del giorno campagna (§9).
9. `select public.loyalty_health_check();` e leggere `health_log` `loyalty_*`: tutto `ok` tranne, al massimo, `loyalty_pool` warn se il lotto e' piccolo.
10. Decidere l'account di test: reset (punti a 0, redemption e codici di test rimossi) oppure tenerlo come membro interno; documentarlo.

## 3. Rollback (in ordine di gravita')

| Sintomo | Azione | Effetto |
|---|---|---|
| Accrediti sbagliati | `loyalty_purchase_enabled='false'` (+ `cron.alter_job` per fermare il poll) | nessun nuovo accredito; lo storico resta e si corregge a mano con eventi `manual_adjust` tracciati |
| Riscatti sbagliati o pool compromesso | `loyalty_redeem_enabled='false'` | la card riscatto sparisce dalla pagina; i codici gia' emessi restano validi in Shopify (disattivarli da admin se serve) |
| Pagina rotta | rideploy dell'ultima `loyalty-page` buona (`git checkout <commit> -- supabase/functions/loyalty-page && deploy`) | la pagina e' statica: zero effetti sui dati |
| loyalty-proxy rotta | rideploy dell'ultimo commit buono | giochi e stato tornano; i punti sono a DB, nulla si perde |
| Tutto il modulo | i tre flag `false` + la pagina resta raggiungibile solo a chi ha l'URL (non e' linkata) | il negozio non se ne accorge: il modulo non tocca commerce |

## 4. Pool di codici sconto (ricarica)

Il pool si consuma un codice per riscatto. Allarme `loyalty_pool` warn sotto `loyalty_pool_min` (20), error a 0 con riscatto ON.

Ricarica (owner o Claude Code col connettore Shopify, MAI dal tema): per ogni codice `discountCodeBasicCreate` con `customerGets: { value: { percentage: 0.20 }, items: { all: true } }`, `appliesOncePerCustomer: true`, `usageLimit: 1`, `combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }`, **senza** `customerSelection` per cliente (codice generico: il pool lo consegna a chiunque riscatti), titolo `Premia - Tessera 20% (lotto <data> n. N)`, codice `PREMIA-T20-<6 caratteri casuali>`. Poi:

```sql
insert into loyalty_reward_codes (code, reward_key) values ('PREMIA-T20-XXXXXX','tessera'), ... on conflict do nothing;
select * from v_loyalty_pool;
```

Scadenza: decisione D-L3 (proposta 90 giorni con `endsAt`). Se si adotta, il lotto va rigenerato per tempo e i codici scaduti tolti dal pool.

## 5. Backfill e giro manuale di `loyalty-orders`

```bash
# anteprima (nessuna scrittura); a flag OFF risponde {state:'off'}: il dryRun vive dietro il flag (T3 dell'audit: da spostare)
curl -s -X POST https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/loyalty-orders -H 'content-type: application/json' -d '{"dryRun":true}'
# giro reale
curl -s -X POST .../loyalty-orders -H 'content-type: application/json' -d '{}'
# backfill a chunk mensili (idempotente: rilanciare non doppia mai)
curl -s -X POST .../loyalty-orders -H 'content-type: application/json' -d '{"action":"backfill","since":"2026-02-01T00:00:00Z","until":"2026-03-01T00:00:00Z","dryRun":true}'
```

(dal v3 l'edge accetta anche `until` e il PIN come le altre cron: `{"pin": ...}`). Leggere in risposta `fetched`, `candidati`, `credited`, `added`, `skipped`, `errors` e in `health_log` la chiave `loyalty_orders`. Un secondo giro identico deve dare `credited: 0`.

## 6. Resi e storno (G2)

Politica: rimborso totale o annullamento = storno totale dei punti dell'ordine; rimborso parziale = storno proporzionale (`refunded / subtotal`, tetto 1,0); mai sotto zero. La poll di storno (v3) legge `shopify_orders.refund_amount` (aggiornato ogni ora da `shopify-sync` per gli ordini toccati negli ultimi 45 giorni) per gli ordini in `loyalty_order_credits` e scrive `loyalty_order_reversals` (una riga per ordine, stato = quanto stornato finora) + evento `refund_reversal`. Correzione manuale, se serve: evento `manual_adjust` con `meta.reason`, mai UPDATE diretto dei punti senza evento (invariante ledger).

## 7. Riscatti `pending` (pool vuoto)

`select * from loyalty_redemptions where status='pending' order by created_at;` -> ricaricare il pool (§4) e poi, per ogni pending, `select loyalty_claim_code('tessera', <customer>, <id>)` (dal fix 0136 la claim e' idempotente: non tocca redemption gia' evase). Avvisare la cliente (oggi a mano: nessuna notifica automatica, Known issue 18).

## 8. Incidenti

| Caso | Come si vede | Cosa fare |
|---|---|---|
| Edge giu' / PostgREST 504 | pagina in "Un attimo..." (503 `read_failed`), `health_log` `loyalty_orders` error | attendere/rilanciare; le letture sono fail-closed, nessuna scrittura parziale; se persiste > 1h, aprire un caso in `CASI_APERTI.md` (n.19 e' il 504 al minuto :00) |
| Segreto App Proxy ruotato | tutte le chiamate 401 `bad_signature` | aggiornare `app_flags.shopify_app_proxy_secret` col nuovo client secret (canale sicuro, mai in repo/chat/log) |
| Versione Admin API ritirata | Shopify serve la piu' vecchia stabile: cambi silenziosi di forma | calendario §10; aggiornare la costante `API` nelle edge e rifare `dryRun` |
| Ledger fuori quadra | `health_log` `loyalty_ledger` error con gli id | `select * from v_loyalty_ledger_drift where diff <> 0;` poi correggere con `manual_adjust` motivato; cercare la causa in `loyalty_events` (mai due scritture non atomiche) |
| Pool a zero con riscatto ON | `loyalty_pool` error, redemption `pending` | §4 e §7 |
| Cron acquisti fermo | `loyalty_orders_fresh` error | `select * from cron.job where jobname like 'loyalty%'`; `cron.alter_job` per riattivare; giro manuale §5 |
| Clone divergente | il doc "non c'e'" o e' vecchio | `git fetch` e dire QUALE clone si e' guardato (CONOSCENZA 11-08); i cloni canonici stanno sotto `GESTIONALE AMI CLAUDE` |

## 9. Giorno della campagna (G4: il link arriva solo allora)

1. `node tests/loyalty_smoke.mjs` verde; `select * from v_loyalty_pool` con lotto sufficiente (stima: riscatti attesi nella settimana x 2).
2. Shopify admin -> Online Store -> **Navigation** (menu, non codice del tema): voce "Premia" -> URL `/apps/premia/club` nel menu account/footer e, se deciso, nel menu principale.
3. Mail di campagna con il link; nelle prime 48 ore leggere ogni mattina `health_log` `loyalty_*` e `v_loyalty_kpi_daily`.
4. FAQ per l'assistenza: come si accumulano i punti (1 pt/EUR, giochi +5), come si riscatta (200 pt = 20% non cumulabile, uso singolo), cosa succede coi resi (storno), perche' il livello puo' scendere dopo un riscatto (G3).

## 10. Calendario deprecazioni e revisioni

| Quando | Cosa | Azione |
|---|---|---|
| **16-10-2026** | fine supporto Admin API `2025-10` (oggi serve di fatto le chiamate `2024-01` in fall-forward) | le edge devono gia' essere pinnate a `2026-07` (Fase 6) |
| **16-07-2027** | fine supporto `2026-07` | pin alla stabile piu' recente, `dryRun` di verifica, aggiornare questa tabella |
| ogni trimestre | versioni Shopify (`shopify.dev/docs/api/usage/versioning`), `jsr:@supabase/supabase-js@2`, runtime Deno | leggere il bundle vivo, `node --check`, smoke |
| ogni mese | `v_loyalty_pool`, `v_loyalty_redeem_rate`, `health_log` `loyalty_*` | ricaricare il pool, tarare `loyalty_pool_min`, rivedere i tier sulle misure reali |
| prima di ogni deploy | Regola 19 prima/dopo, `build.mjs --check`, smoke | vedi §1 |

## 11. Account di test e residui

Cliente `10147859530055` (alepodasca@gmail.com): unico membro fino al backfill. Residui al 21-09: 4 codici Shopify `PREMIA-T20-*` ristretti a questo cliente (1 usato nel pool, 3 liberi: da TOGLIERE dal pool prima del go-live), ordine `#1781` annullato e rimborsato, eventi `manual_adjust` (+200 il 20-09). Prima del lancio: decidere reset o membro interno (§2 punto 10).
