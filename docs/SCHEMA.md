# Amimì App - SCHEMA (tabelle, viste, colonne generate)

> Stato cumulativo dello schema dopo le migrazioni `0001`-`0044` (generato 2026-07-06 leggendo `supabase/migrations/`). Per rigenerarlo: rileggere le migrazioni o `list_tables` via Supabase MCP.
> Filosofia (migr 0001): la storia si carica FEDELE e permissiva (niente FK strette), i problemi EMERGONO dalle viste di salute; l'integrita' stretta sta sul write path (write-api). Niente RLS: anon e' sola lettura via REVOKE, le scritture passano dal service-role delle edge.

## 1. Colonne GENERATED (MAI scrivibili: si corregge sempre l'input)

| Tabella | Colonna | Formula |
|---|---|---|
| products | `codice_norm` | upper + spazi collassati a `_` |
| products | `is_finalized` | codice non vuoto e non termina in `_` |
| product_aliases | `shopify_name_norm` | come codice_norm |
| purchases | `codice_norm`, `costo_totale` | norm; round(quantita * costo_unitario, 2) |
| shopify_line_items | `codice_norm` | norm |
| qromo_sales | `codice_norm` | norm |
| b2b_movements | `codice_norm`, `retail_tot`, `quota_negozio`, `incasso_amimi` | norm; prezzo*qta; *perc_negozio; *(1-perc_negozio) |
| gifts_offline | `codice_norm` | norm |
| returns | `codice_norm` | norm |
| stock_adjustments | `codice_norm` | norm |
| expenses | `amimi` | lower(trim(amimi_raw)) = 'si' |
| expenses | `categoria_valid` | categoria in (COGS, LOGISTICA, MARKETING, OPEX, PACKAGING, SALARI, TASSE, EVENTI) |

Un INSERT/UPDATE che include una colonna generata FALLISCE (gia' successo: orphan_cleanup 01-07).

## 2. Tabelle anagrafica

- **`products`**: 1 riga = 1 CODICE_AMIIMI. `codice` UNIQUE + **UNIQUE su `codice_norm`** (migr 0037, anti-duplicati di casing). Campi: model, variant, item, categoria, shopify_name, shopify_sku, `retail_price` (IVA inclusa), `cogs`, description, seo_title, image_url, `verificato`.
- **`product_aliases`**: nome sito Shopify -> CODICE (`shopify_name_norm` generato). NON unique sul nome: un nome con 2 codici e' un bug segnalato, non bloccato.
- **`non_product_codici`**: codici da ignorare come prodotto (Gift Card, Vendita_Generica...). Il resolver li salta.
- **`suppliers`**, **`negozi`** (con `perc_default` per il conto-vendita).

## 3. Tabelle transazionali (fonti dell'inventario e del CE)

- **`purchases`** (ACQUISTI, verita' del carico): data, codice, quantita, costo_unitario, `costo_totale` generato, fornitore, note.
- **`shopify_orders`** + **`shopify_line_items`**: ordini (gross/net/discount/shipping/fees/refund, financial/fulfillment status, `fulfilled_at`, `discount_codes`) e righe (codice risolto, `cogs_snapshot`). Idempotenti su order_id.
- **`qromo_sales`** (vendite negozio): `prezzo` = PAGATO per unita' (sconti inclusi), `cogs` snapshot, `resolver_status` (resolved/unresolved), `sale_id` con **UNIQUE parziale** `qromo_sales_live_saleid_uq` per source in (`qromo-direct`, `qromo-forward`) (migr 0036); i duplicati storici da ETL sono tollerati.
- **`b2b_movements`**: conto_vendita/wholesale, tipo invio/reso/venduto, stato (le righe `annullato` sono ESCLUSE dal CE, migr 0028), incassi generati.
- **`gifts_offline`**: regali/vendite offline; QUIRK: `prezzo` e' il TOTALE riga (non si moltiplica per qta), `cogs` e' per unita'.
- **`returns`** (migr 0018): resi/cambi su 3 canali; `rientra_stock` bool, `sostituito_con` per i cambi merce. Nel CE la riga resi e' nettata /1.22 dal 06-07 (migr 0038).
- **`expenses`** (EXPENSES MASTER): `costo` NEGATIVO; `status` approved/pending/rejected con proposed_by/approved_by; `amimi` e `categoria_valid` generate.
- **`counts`** (staging conte) + **`stock_adjustments`** (migr 0027): la conta scrive in counts e produce una rettifica firmata in stock_adjustments (delta calcolato lato server); `v_inventory` somma le rettifiche.
- **`supplier_orders`**: ordini fornitore multi-borsa (`gruppo` uuid, qty_ordered/qty_arrived, costo_unitario, data_consegna; `wip` boolean da migr 0041: quantita'/costo ignoti, si risolve all'arrivo via arrival_set).
- **`meta_ads_daily`**: metriche Meta per campagna/giorno (da seed).

## 4. Tabelle di servizio

- **`change_log`**: audit di OGNI scrittura (tbl, op, before/after jsonb, `chi`, source).
- **`health_log`**: esiti giornalieri dei guardiani, UNIQUE (day, k); chiavi `ce_*` scritte da ce-guard, il resto da `refresh_health_log()`, `stock_autopush` da shopify-stock.
- **`ce_snapshots`** (migr 0032): mesi chiusi congelati, UNIQUE (ce, year, month), ce in ('amimi','totale'); base del blocco scritture di write-api e di `v_ce_drift`.
- **`ce_totale_monthly`**: copia storica del CE_TOTALE dal Foglio. NON e' piu' la fonte del Cruscotto (vedi `v_ce_totale`).
- **`ce_totale_manual`** (migr 0028): blocco manuale del Totale (gennaio 2026 pre-Amimi + rettifiche feb) che si SOMMA al calcolo live in `v_ce_totale`.
- **`app_config`** (singleton: pin_hash, shopify_token, iva_rate 0.22, `ai_enabled` gate assistente, `ai_actions_enabled` gate azioni AI Fase 3 default off, migr 0059) e **`app_flags`** (key/value: gate Shopify, secret Qromo, key Gemini, token MCP): entrambe SERVICE-ROLE ONLY (lockdown migr 0026).
- **`app_guides`** (migr 0058, singleton id=1): corpus how-to dell'assistente AI (FLOW 6 v2 Fase 2), FAQ ancorate al codice reale. SERVICE-ROLE ONLY (RLS on, no policy; l'edge `assistant` lo legge, `corpus-load` lo scrive). Editabile senza redeploy.
- **`shopify_stock`**: specchio giacenze/immagini Shopify (variant_id, `inventory_item_ids[]` per i dual SC/CC, synced_at; `shopify_status` active/draft/archived da migr 0041 + sync v10). Dal sync v13 (23-07) il pull e' paginato e le righe di prodotti eliminati da Shopify vengono rimosse a fine pull completo (prune, audit `change_log` op `stock_prune`): una riga presente = prodotto visto nell'ultimo pull riuscito.
- **`cs_*` (tool assistenza clienti, migr 0053, Fase 1):** `cs_conversations` (una riga per thread Gmail, UNIQUE `gmail_thread_id`; `canale` email_diretta|form_contatto|form_evento|chat_notifica|rumore; `stato` da_fare|fatto; `parse_failed`; colonne AI `categoria`/`categoria_source`/`categoria_confidence`/`urgente`/`urgenza_motivo`/`lingua` + **`flags` jsonb (migr 0065, Fase 2)** riempite dal classificatore; `summary` NULL fino a Fase 3), `cs_messages` (UNIQUE `gmail_message_id`, `body_text` troncato ~20KB, `form_fields` jsonb), `cs_events` (audit del tool, dominio separato da change_log; azioni `ingest`/`parse_failed`/`classify`/`categoria_edit`), `cs_drafts`/`cs_faq` (create vuote, uso in Fase 3). **RLS diversa dal resto dell'app** (§7): SELECT solo `authenticated`, scritture solo dalle edge service_role. Scritte da `cs-sync` (ingest), **`cs-classify` (categoria/urgenza, Fase 2)**, **`cs-api` (correzione manuale categoria dalla UI, JWT-gated, Fase 2)** e **`cs-assist` (`summary`/storia + `cs_drafts` bozze, Fase 3)**; mai da write-api. `categoria_source`: `ai` (>=0.6) | `ai_low` ("da confermare") | `manuale` (correzione UI). **`cs_drafts`** (Fase 3): bozze on-demand da `cs-assist` (`testo`, `dati_usati` jsonb = blocco DATI, `model`); **`cs_faq`** seedata con 6 `esempio_tono` (migr 0067) + **12 `risposta_standard` IT/EN (migr 0069, Fase 3)** coi valori operativi confermati dall'owner (reso **15gg** dalla consegna dal 2026-07-23 migr 0071, riunione owner; corriere TWS, codice PERTE, ritiro Via Plinio 43 provvisorio; NB: il sito policy dice ancora 14gg -> allineare il tema Shopify); i 3 `esempio_tono` con `[DA VERIFICARE]` (ritiro/sconto/reso) aggiornati coi valori. VINCOLO: la `categoria` delle `risposta_standard` DEVE essere una delle 13 stringhe ESATTE del classificatore `cs-classify` (senza emoji), altrimenti `cs-assist.faqTono` (che filtra `categoria === conv.categoria`) non le inietta. `A13 "Modifica / correzione indirizzo"` PROMOSSA a 14a categoria del classificatore il 2026-07-23 (cs-classify v5, OK owner): ora la riga si aggancia alle conversazioni classificate cosi'. A1 (Spedizione) non hardcoda piu' un link tracking generico (migr 0070): usa il link per-ordine dal BLOCCO DATI (mytws.it/tracking-status;ldv=, stessa logica di ship-sync). Config in `app_flags`: `cs_enabled` (interruttore go-live), `cs_last_history_id` (cursore Gmail), `cs_gmail_sa_key`, `cs_noise_senders` (denylist rumore estendibile, 77 voci), `gemini_api_key` (classificatore+riassunto+bozza), 3 topic ntfy.
- **`loyalty_*` (loyalty via App Proxy, migr 0068, sottosistema NON-core GATED):** `loyalty_points` (`shopify_customer_id` PK, `points` int, `updated_at`) e `loyalty_events` (append-only: `id` uuid, `shopify_customer_id`, `delta`, `source`, `meta` jsonb, `created_at`; audit + base del cap anti-abuso). Scritte SOLO dalla edge `loyalty-proxy` (service_role) dopo verifica firma HMAC dell'App Proxy Shopify; NON passano da write-api (non toccano CE/stock/inventario/Qromo). RLS on **senza policy** + REVOKE ad anon/authenticated (§7): zero accesso diretto dal client, piu' chiuse delle `cs_*`. Vuote finche' non parte il gioco "Amimì Click" (go-live owner: config App Proxy + secret in `app_flags.shopify_app_proxy_secret`).

## 5. Viste (logica derivata)

- **`v_inventory`**: giacenza = acquisti - shopify - qromo - regali - b2b_venduto + resi_rientrati + aggiustamenti; espone anche in_conto_vendita, disponibili_da_vendere, valore, last_sale, on_shopify (da `shopify_stock` LIVE, migr 0021; dal 0041 SOLO status active: le bozze non contano come pubblicate), image_url con fallback Shopify.
- **`v_ce_amimi`** / **`v_ce_amimi_summary`**: P&L brand per mese (online/offline/b2b netti /1.22, cogs, packaging, commissioni, logistica, resi /1.22 da migr 0038; MC1, MC2).
- **`v_ce_totale`** / **`v_ce_totale_summary`** (migr 0028, DI RECORD per il Totale): calcolo live + blocco `ce_totale_manual`.
- **`v_ce_drift`** (migr 0032): mesi in `ce_snapshots` con delta netto/mc2 tra congelato e live.
- **`v_health`** (migr 0023 + 0035): 14 detector: img_missing, stock_neg, cogs_missing, price_missing, orders_orphan, todo_products, lost_sales + shopify_orphan, qromo_orphan, dup_codice, period_mismatch, ce_drift_live e affini.
- **`v_expenses_review`** (migr 0032): coda spese pending o "da verificare" (sostituisce v_expenses_pending).
- **`v_products_todo`**: anagrafiche incomplete con bucket di priorita' (nuovo / costo_ricavo / pulizia). Dal **0047** la WHERE include anche i buchi `retail_price`/`cogs`, cosi' un prodotto GIA' verificato ma senza prezzo o COGS ricompare nel bucket `costo_ricavo` (prima irraggiungibile per i verificati -> COGS mancanti nascosti e bucket costo_ricavo strutturalmente vuoto).
- **`v_ordini_arrivo`**, **`v_fornitore_prodotti`**: monitor ordini fornitore e storico costi per fornitore. Dal **0062** `v_ordini_arrivo` espone `data_consegna_display = COALESCE(data_consegna, data_ultimo_arrivo)`: gli ordini creati in-app riempiono solo `data_ultimo_arrivo`, quindi la card "Gia' arrivati" legge il display e mostra la data d'arrivo quando manca la consegna (grezze `data_consegna`/`data_ultimo_arrivo` invariate, nessun UPDATE dati).
- **`v_shopify_align`**, **`v_stock_drift`** (migr 0034): disallineamenti app<->Shopify e azione di policy per l'autopush (ok / da_abbassare / da_alzare / hold_serve_conta).
- **`v_reorder`**, **`v_sku_availability`**: velocita' 60gg + giorni di stock; stato SKU (acquistabile / in_stock_non_pubblicato / pubblicato_esaurito). Dal 0041 v_reorder espone `riordino_archiviato` (flag su `products`, archivio riordino ripristinabile) e v_ordini_arrivo/v_fornitore_prodotti hanno il fallback immagini da shopify_stock + flag `wip`. Dal 0043 il CODICE e' TUTTO MAIUSCOLO in 12 tabelle (decisione owner 06-07; SKU Shopify legacy invariati, join case-insensitive); 0042 (solo server, dati non nel repo per privacy) ha backfillato i customer_name degli ordini #1001-#1179 dal Foglio Master.
- **`v_resi_mensile`**, **`v_ads_mensile`**, **`v_last_sale`**, **`v_conto_vendita_negozio`**.
- **`v_movimenti_14gg`** (migr 0044): riga singola col polso ecosistema ultimi 14gg vs 14 precedenti, stessa finestra del task Cowork `digest-salute-movimenti` (una sola fonte di logica): vendite online (shopify_line_items+orders su `created_at_shop`) e offline (qromo_sales) split e combinate, netto = lordo/1,22, ordini Shopify + AOV, movimenti fornitori (nuovi/arrivi/aperti), resi, catalogo (live/draft/soldout). SOLO aggregati: nessun PII, nessun segreto. Alimenta la pagina in-app "Salute & Movimenti".
- **`v_ops_flags`** (migr 0044, esteso 0057): SECURITY DEFINER, espone SOLO flag operativi non-segreti come colonne hard-coded: i 4 shopify (`shopify_write_enabled`, `shopify_autopush_enabled`, `shopify_hold_raises`, `shopify_expose_buffer`) da `app_flags`, piu' `ai_enabled` (booleano da `app_config`, gate dell'assistente AI, migr 0057). E' il modo corretto per far leggere ad anon un sottoinsieme sicuro di `app_flags`/`app_config` (che 0026 ha bloccato del tutto): i segreti gemini_api_key/mcp_token/qromo_webhook_*/pin_hash/shopify_token NON sono mai selezionati.
- **`v_digest_persone` + `v_digest_ordini_14gg` / `v_digest_pulizia_14gg` / `v_digest_spese_14gg` / `v_digest_log_attori_14gg` / `v_digest_versioni`** (migr 0045): alimentano la vista PER PERSONA della pagina "Salute & Movimenti" (Ginevra=ordini, Benedetta=catalogo/resi/spese, Dan[=Ale]=sistema). `v_digest_persone` e' la riga singola con tutti i KPI headline (finestra 14gg come 0044); le altre sono i drill-down (liste). Solo colonne di display: i drill su change_log espongono data/op/chi (+operazione/costo per le spese via join `expenses`), MAI i payload grezzi before/after. `v_digest_versioni` e' l'unica SECURITY DEFINER: legge lo schema riservato `supabase_migrations` ed espone SOLO `count(*)` + ultima versione (safe-subset, stesso pattern di v_ops_flags). NB: `gin_aov14` e' l'AOV ONLINE corretto (lordo online / ordini online); il campo `aov_lordo14` di v_movimenti_14gg divide invece il lordo TOTALE (incl. offline) per i soli ordini online e sovrastima -> non usarlo per l'AOV online.

## 6. Funzioni DB

- **`ask_select(q text)`**: SECURITY DEFINER; SELECT-only, singolo statement, keyword DML/DDL vietate, cap 200 righe, timeout 5s. EXECUTE solo service_role (migr 0016). APERTO audit A1: manca l'allowlist di viste.
- **`refresh_health_log()`**: rigenera le righe di oggi in `health_log` dai detector di `v_health` (NON tocca le chiavi `ce_*`, migr 0035). Chiamata dal cron health-daily.
- **`norm_codice(t)`**: helper immutabile, stessa normalizzazione delle colonne generate.

## 7. Sicurezza (stato finale)

- anon / authenticated: SELECT su tabelle operative e viste; INSERT/UPDATE/DELETE REVOCATI ovunque (migr 0026); TRUNCATE REVOCATO + default privileges future (migr 0037); ZERO accesso a `app_config`/`app_flags`; `ask_select` non eseguibile.
- service_role: tutto (usato solo dalle edge functions).
- Niente RLS sulle tabelle operative: il modello e' read-only pubblico by-design (frontend no-login) + write path unico. **ECCEZIONE: le `cs_*`** (tool assistenza, migr 0053) sono le UNICHE con RLS: contengono il testo dei thread cliente, quindi vanno dietro login. Policy: SELECT solo `authenticated` (utenti @amimi.it via Supabase Auth), niente policy anon (+ REVOKE cintura-e-bretelle), scritture per nessun ruolo applicativo (solo `service_role`, che bypassa la RLS). Test negativo verificato: `set role anon; select from cs_conversations` -> `insufficient_privilege`; l'advisor NON elenca le `cs_*` tra le `rls_disabled_in_public`.
- **`loyalty_*`** (migr 0068): RLS on con **NESSUNA policy** (deny sia anon SIA authenticated) + REVOKE cintura-e-bretelle. Piu' chiuse delle `cs_*` (che concedono SELECT ad authenticated): qui il client non tocca MAI le tabelle, l'unico canale e' la edge `loyalty-proxy` col service_role, protetta da HMAC App Proxy. Test negativo verificato: `has_table_privilege('anon'/'authenticated', ...)` = false su SELECT e INSERT; 0 policy.
- Sottoinsieme sicuro di una tabella bloccata: se serve esporre ad anon SOLO alcune colonne/chiavi di una tabella (o schema) revocata, si usa una vista SECURITY DEFINER che seleziona esplicitamente le sole colonne sicure (vedi `v_ops_flags`, migr 0044, per i flag operativi di `app_flags`; e `v_digest_versioni`, migr 0045, per il solo `count(*)`+ultima versione dallo schema riservato `supabase_migrations`). MAI riaprire `app_flags` ad anon.
- **VERIFICA 2026-07-06 (brief RLS/app_flags)**: l'advisor Supabase "RLS disabled" e' generico e va letto insieme ai GRANT. Provato che i segreti NON sono esposti ad anon in tre modi: (1) `role_table_grants` su `app_flags`/`app_config` = solo `service_role`; (2) `set role anon; select from app_flags` -> `permission denied`; (3) le due tabelle NON compaiono nell'elenco `rls_disabled_in_public` dell'advisor (senza grant anon PostgREST non le espone). Protezione via REVOKE (0026/0037), non via RLS: corretta e sufficiente per i segreti. Restano APERTI-OWNER (non fix ciechi): abilitare RLS+policy romperebbe l'app no-login (avviso esplicito dell'advisor); la PII cliente in `shopify_orders` (nome/email) e' leggibile da anon PER DESIGN no-login (rischio accettato, audit A-items); rotazione segreti A1/A2.

## 8. Cron (pg_cron)

8 job attivi: vedi `OPERATIONS.md` §2 (shopify-sync :07, stock sync :17, autopush :27, health 06:00, ce-guard 06:30) + **`cs-sync-poll` `*/2`** (migr 0054, ingest tool assistenza; NO-OP finche' `app_flags.cs_enabled='false'`) + **`cs-classify` `*/5`** (migr 0066, classificatore Fase 2) + **`cs-assist-summary` `*/7`** (migr 0067, riassunto/storia Fase 3); gli ultimi tre NO-OP se `cs_enabled!='true'`, decoupled tra loro. Definiti nelle migrazioni 0011/0024/0032/0034/0054/0066/0067.
