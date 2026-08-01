# Amimì App - SCHEMA (tabelle, viste, colonne generate)

> Stato cumulativo dello schema dopo le migrazioni `0001`-`0074` (base generata 2026-07-06 su 0001-0044; integrazioni successive annotate in linea, ultima 2026-07-24). Per rigenerarlo: rileggere le migrazioni o `list_tables` via Supabase MCP.
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

- **`products`**: 1 riga = 1 CODICE_AMIIMI. `codice` UNIQUE + **UNIQUE su `codice_norm`** (migr 0037, anti-duplicati di casing). Campi: model, variant, item, categoria, shopify_name, shopify_sku, `retail_price` (IVA inclusa), `cogs`, description, seo_title, image_url, `verificato`, `status`, `source`, `riordino_archiviato`. Dal 2026-07-24 (write-api v21, brief campi_necessari_prodotto): il CODICE degli stub e' SEMPRE derivato server-side da item+variant (mai dal client), `status` e' DEPRECATO (non si scrive piu', colonna resta), `categoria` non e' piu' input manuale (deriva da `models`), `verificato` e' solo un timbro audit (mai retrocesso; scatta a true SOLO ad anagrafica completa: model+variant+prezzo>0+COGS>0), `is_finalized` mai usata come workflow.
- **`models`** (migr 0073, brief C.1): un MODELLO -> `categoria` (PELLE/TESSUTO/ACCESSORI), `product_type`, `template_suffix`, `collections[]` per l'upload Shopify. `model_norm` generata UNIQUE. RLS on con SELECT pubblica, scritture solo service-role (in pratica: migrazioni). Seed dal manuale Nuovo_Prodotto_su_Shopify.md (sez. 4.1/4.3/4.7, verificato live 06-16) + LEA BAG X RITA (live 23-07). Righe mancanti BY DESIGN (decisione owner, mai default): ISABELLA, LOLA, ROSE, PORTA_CARTE, SVEVA. L'upload DEVE fallire se il modello non ha riga (mai inventare BAG).
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
- **`cs_knowledge`** (migr 0082, 31-07): conoscenza di casa iniettata nel prompt delle bozze CS da cs-assist v14 (tono di voce, valori operativi fonte-unica, escalation, linee guida per categoria; 15 voci seed coi valori confermati dall'owner 31-07). `categoria` NULL = sempre; altrimenti solo su quella categoria (nomi ESATTI del classificatore, stesso vincolo di cs_faq). SERVICE-ROLE ONLY (RLS on, no policy). Si aggiorna a DB, mai hardcoded nel prompt.
- **`shopify_stock`**: specchio giacenze/immagini Shopify (variant_id, `inventory_item_ids[]` per i dual SC/CC, synced_at; `shopify_status` active/draft/archived da migr 0041 + sync v10). Dal sync v13 (23-07) il pull e' paginato e le righe di prodotti eliminati da Shopify vengono rimosse a fine pull completo (prune, audit `change_log` op `stock_prune`): una riga presente = prodotto visto nell'ultimo pull riuscito.
- **`cs_*` (tool assistenza clienti, migr 0053, Fase 1):** `cs_conversations` (una riga per thread Gmail, UNIQUE `gmail_thread_id`; `canale` email_diretta|form_contatto|form_evento|chat_notifica|rumore; `stato` da_fare|in_corso|fatto (workflow coda dal 24-07: `in_corso` con `stato_by`=chi la prende, scritture via cs-api `set_stato`); `parse_failed`; colonne AI `categoria`/`categoria_source`/`categoria_confidence`/`urgente`/`urgenza_motivo`/`lingua` + **`flags` jsonb (migr 0065, Fase 2)** riempite dal classificatore; `summary` NULL fino a Fase 3), `cs_messages` (UNIQUE `gmail_message_id`, `body_text` troncato ~20KB GREZZO E INTATTO, **`body_clean` migr 0081** = solo le parole del mittente pulite in modo deterministico da cs-sync `stripQuoted` — citazioni/firma/boilerplate Inbox rimossi; NULL = fallback su body_text in UI/prompt; backfill 31-07 completo, azione `backfill_clean`, `form_fields` jsonb), `cs_events` (audit del tool, dominio separato da change_log; azioni `ingest`/`parse_failed`/`classify`/`categoria_edit`), `cs_drafts`/`cs_faq` (create vuote, uso in Fase 3). **RLS diversa dal resto dell'app** (§7): SELECT solo `authenticated`, scritture solo dalle edge service_role. Scritte da `cs-sync` (ingest), **`cs-classify` (categoria/urgenza, Fase 2)**, **`cs-api` (correzione manuale categoria dalla UI, JWT-gated, Fase 2)** e **`cs-assist` (`summary`/storia + `cs_drafts` bozze, Fase 3)**; mai da write-api. `categoria_source`: `ai` (>=0.6) | `ai_low` ("da confermare") | `manuale` (correzione UI). **`cs_drafts`** (Fase 3): bozze on-demand da `cs-assist` (`testo`, `dati_usati` jsonb = blocco DATI, `model`, **`source` 'app'|'eval' migr 0080: le righe generate dall'harness scripts/cs-eval.mjs sono marcate 'eval' e si isolano con una query**); **`cs_faq`** seedata con 6 `esempio_tono` (migr 0067) + **12 `risposta_standard` IT/EN (migr 0069, Fase 3)** coi valori operativi confermati dall'owner (reso **15gg** dalla consegna dal 2026-07-23 migr 0071, riunione owner; corriere TWS, codice AMIMILANO10 (migr 0075, era PERTE), ritiro Via Plinio 43 provvisorio; NB: il sito policy dice ancora 14gg -> allineare il tema Shopify); i 3 `esempio_tono` con `[DA VERIFICARE]` (ritiro/sconto/reso) aggiornati coi valori. VINCOLO: la `categoria` delle `risposta_standard` DEVE essere una delle 14 stringhe ESATTE del classificatore `cs-classify` (senza emoji), altrimenti `cs-assist.faqTono` (che filtra `categoria === conv.categoria`) non le inietta. `A13 "Modifica / correzione indirizzo"` PROMOSSA a 14a categoria del classificatore il 2026-07-23 (cs-classify v5, OK owner): ora la riga si aggancia alle conversazioni classificate cosi'. A1 (Spedizione) non hardcoda piu' un link tracking generico (migr 0070): usa il link per-ordine dal BLOCCO DATI (mytws.it/tracking-status;ldv=, stessa logica della pipeline **amimi-ship**; NB: `ship-sync` NON e' una edge function e non lo e' mai stata, e' l'abbreviazione con cui i changelog chiamano `amimi-ship`, progetto Python che gira su GitHub Actions, vedi `amimi-ship/README.md`). Config in `app_flags`: `cs_enabled` (interruttore go-live), `cs_last_history_id` (cursore Gmail), `cs_gmail_sa_key`, `cs_noise_senders` (denylist rumore estendibile, 77 voci), `gemini_api_key` (classificatore+riassunto+bozza), 3 topic ntfy.
- **`loyalty_*` (loyalty via App Proxy, migr 0068, sottosistema NON-core GATED):** `loyalty_points` (`shopify_customer_id` PK, `points` int, `updated_at`) e `loyalty_events` (append-only: `id` uuid, `shopify_customer_id`, `delta`, `source`, `meta` jsonb, `created_at`; audit + base del cap anti-abuso). Scritte SOLO dalla edge `loyalty-proxy` (service_role) dopo verifica firma HMAC dell'App Proxy Shopify; NON passano da write-api (non toccano CE/stock/inventario/Qromo). RLS on **senza policy** + REVOKE ad anon/authenticated (§7): zero accesso diretto dal client, piu' chiuse delle `cs_*`. Canale LIVE dal 24-07 (config App Proxy + secret fatti dall'owner/Cowork).
- **`mimi_state` (personaggio Mimi, migr 0078, stesso sottosistema):** `shopify_customer_id` PK, `nanna` bool, `last_coccola` date, `last_memory` date, `worn` text, `updated_at`. Stato del profilo Premia per cliente: sacchettino/nanna, quale capo indossa Mimi, e le due attivita' a premio del giorno. **Le date `last_*` sono giorni Europe/Rome**, non UTC (le azioni nuove usano il giorno civile italiano; il vecchio `add` del clicker resta su UTC per retro-compat). Stessa postura di `loyalty_*`: scritta SOLO dalla edge `loyalty-proxy` col service_role, RLS on **senza policy** + REVOKE ad anon/authenticated (§7), verificato con test negativo. I PUNTI non stanno qui: restano su `loyalty_points`/`loyalty_events` (una sola fonte di verita' per il saldo e il suo audit).

## 5. Viste (logica derivata)

- **`v_inventory`**: giacenza = acquisti - shopify - qromo - regali - b2b_venduto + resi_rientrati + aggiustamenti; espone anche in_conto_vendita, disponibili_da_vendere, valore, last_sale, on_shopify (da `shopify_stock` LIVE, migr 0021; dal 0041 SOLO status active: le bozze non contano come pubblicate), image_url con fallback Shopify.
- **`v_ce_amimi`** / **`v_ce_amimi_summary`**: P&L brand per mese (online/offline/b2b netti /1.22, cogs, packaging, commissioni, logistica, resi /1.22 da migr 0038; MC1, MC2).
- **`v_ce_totale`** / **`v_ce_totale_summary`** (migr 0028, DI RECORD per il Totale): calcolo live + blocco `ce_totale_manual`.
- **`v_ce_drift`** (migr 0032): mesi in `ce_snapshots` con delta netto/mc2 tra congelato e live.
- **`v_health`** (migr 0023 + 0035): 14 detector: img_missing, stock_neg, cogs_missing, price_missing, orders_orphan, todo_products, lost_sales + shopify_orphan, qromo_orphan, dup_codice, period_mismatch, ce_drift_live e affini.
- **`v_expenses_review`** (migr 0032): coda spese pending o "da verificare" (sostituisce v_expenses_pending).
- **`v_products_todo`**: anagrafiche incomplete con bucket di priorita' (nuovo / costo_ricavo / pulizia). Dal **0047** la WHERE include anche i buchi `retail_price`/`cogs`, cosi' un prodotto GIA' verificato ma senza prezzo o COGS ricompare nel bucket `costo_ricavo`. Dal **0074** (brief D.2): bucket `nuovo` = stub app-ordine NON verificato CON attivita' collegata (QUALSIASI riga supplier_orders, anche WIP/qty NULL, o QUALSIASI componente di magazzino != 0, anche negativo); uno stub senza nulla scivola in `pulizia` con flag `stub_orfano` (nuova colonna in coda); la WHERE include anche la FOTO mancante per i prodotti app-born (prima un completo-senza-foto era invisibile a ogni coda).
- **`v_products_to_publish`** (migr 0074, brief D.1): l'UNICO segnale "pronto per Shopify" per il task `upload-prodotto` e il pannello Publish in-app. Criteri: `source='app-ordine'` + item/variant pieni + `retail_price>0` + `cogs>0` + foto + descrizione SOLO se `is_new_model` + codice non provvisorio (niente `_` finale) + **NESSUNA riga `shopify_stock` FRESCA per quel norm, QUALSIASI status** (le bozze contano: `on_shopify` vede solo le active e NON basta). "Fresca" = `synced_at` entro 2h dal max synced_at: il mirror e' upsert-only senza prune (23/245 righe stale al 23-07), cosi' una riga stale di un prodotto rimosso da Shopify non blocca per sempre, e se il sync e' fermo si blocca TUTTO (conservativo, mai doppioni). `pronto_stock` (disponibili>0) e' SOLO informativo: la bozza si prepara anche prima dell'arrivo (decisione owner 23-07). `modello_censito`+categoria/product_type/template_suffix/collections arrivano dal join con `models`.
- **`v_ordini_arrivo`**, **`v_fornitore_prodotti`**: monitor ordini fornitore e storico costi per fornitore. Dal **0062** `v_ordini_arrivo` espone `data_consegna_display = COALESCE(data_consegna, data_ultimo_arrivo)`: gli ordini creati in-app riempiono solo `data_ultimo_arrivo`, quindi la card "Gia' arrivati" legge il display e mostra la data d'arrivo quando manca la consegna (grezze `data_consegna`/`data_ultimo_arrivo` invariate, nessun UPDATE dati).
- **`v_shopify_align`**, **`v_stock_drift`** (migr 0034): disallineamenti app<->Shopify e azione di policy per l'autopush (ok / da_abbassare / da_alzare / hold_serve_conta).
- **`v_reorder`**, **`v_sku_availability`**: velocita' 60gg + giorni di stock; stato SKU (acquistabile / in_stock_non_pubblicato / pubblicato_esaurito). Dal 0041 v_reorder espone `riordino_archiviato` (flag su `products`, archivio riordino ripristinabile) e v_ordini_arrivo/v_fornitore_prodotti hanno il fallback immagini da shopify_stock + flag `wip`. Dal 0043 il CODICE e' TUTTO MAIUSCOLO in 12 tabelle (decisione owner 06-07; SKU Shopify legacy invariati, join case-insensitive); 0042 (solo server, dati non nel repo per privacy) ha backfillato i customer_name degli ordini #1001-#1179 dal Foglio Master.
- **`v_resi_mensile`**, **`v_ads_mensile`**, **`v_last_sale`**, **`v_conto_vendita_negozio`**.
- **`v_movimenti_14gg`** (migr 0044): riga singola col polso ecosistema ultimi 14gg vs 14 precedenti, stessa finestra del task Cowork `digest-salute-movimenti` (una sola fonte di logica): vendite online (shopify_line_items+orders su `created_at_shop`) e offline (qromo_sales) split e combinate, netto = lordo/1,22, ordini Shopify + AOV, movimenti fornitori (nuovi/arrivi/aperti), resi, catalogo (live/draft/soldout). SOLO aggregati: nessun PII, nessun segreto. Alimenta la pagina in-app "Salute & Movimenti".
- **`v_ops_flags`** (migr 0044, esteso 0057): SECURITY DEFINER, espone SOLO flag operativi non-segreti come colonne hard-coded: i 4 shopify (`shopify_write_enabled`, `shopify_autopush_enabled`, `shopify_hold_raises`, `shopify_expose_buffer`) da `app_flags`, piu' `ai_enabled` (booleano da `app_config`, gate dell'assistente AI, migr 0057). E' il modo corretto per far leggere ad anon un sottoinsieme sicuro di `app_flags`/`app_config` (che 0026 ha bloccato del tutto): i segreti gemini_api_key/mcp_token/qromo_webhook_*/pin_hash/shopify_token NON sono mai selezionati.
- **`v_digest_persone` + `v_digest_ordini_14gg` / `v_digest_pulizia_14gg` / `v_digest_spese_14gg` / `v_digest_log_attori_14gg` / `v_digest_versioni`** (migr 0045): alimentano la vista PER PERSONA della pagina "Salute & Movimenti" (Ginevra=ordini, Benedetta=catalogo/resi/spese, Dan[=Ale]=sistema). `v_digest_persone` e' la riga singola con tutti i KPI headline (finestra 14gg come 0044); le altre sono i drill-down (liste). Solo colonne di display: i drill su change_log espongono data/op/chi (+operazione/costo per le spese via join `expenses`), MAI i payload grezzi before/after. `v_digest_versioni` e' l'unica SECURITY DEFINER: legge lo schema riservato `supabase_migrations` ed espone SOLO `count(*)` + ultima versione (safe-subset, stesso pattern di v_ops_flags). NB: `gin_aov14` e' l'AOV ONLINE corretto (lordo online / ordini online); il campo `aov_lordo14` di v_movimenti_14gg divide invece il lordo TOTALE (incl. offline) per i soli ordini online e sovrastima -> non usarlo per l'AOV online.

- **`v_margine_sku`** + **`v_margine_ordine`** (migr 0083, brief A4): contribution margin per codice x anno x mese x canale e profitto per ordine online. Sono additive e in sola lettura: nessuna vista preesistente e' stata toccata, rollback = `drop view`. Formule, limiti dichiarati e riconciliazione col CE nella sezione 9.

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

## 9. Margine per SKU e per ordine (migr 0083, brief A4)

Due viste NUOVE e additive. Il CE non e' stato toccato: `v_ce_amimi`, `v_ce_amimi_summary`,
`v_ce_totale` e `v_inventory` hanno la stessa definizione byte per byte di prima
(md5 dell'insieme verificato identico prima e dopo: `0f1c8805edd8998da0d7673a9337bee3`).
Rollback = `drop view public.v_margine_ordine; drop view public.v_margine_sku;`.

### Convenzioni

- **Segno**: qui i costi sono POSITIVI e il margine li sottrae. Nel CE gli stessi costi sono
  negativi e vengono sommati. I due risultati coincidono.
- **Chiave di allocazione unica**: sconto, commissioni di incasso e quota fissa di packaging
  vivono sull'ORDINE e vengono allocati alla riga pro-quota sul valore riga
  (`quota = price*quantita / valore_ordine`). Valore ordine 0 -> quota 0: la riga resta
  (pezzi e cogs non si perdono) ma non riceve allocazioni. Al 2026-07-31 nessun ordine e' in
  questo caso.
- **Packaging**: non e' una categoria di spesa, e' una formula del CE. Vengono usate le STESSE
  costanti, **3,71 per pezzo piu' 1,00 per ordine online**. Se un domani il CE cambia quelle
  costanti vanno cambiate anche qui.
- **Quantita'**: queste viste moltiplicano SEMPRE per la quantita'. `cogs_snapshot`,
  `qromo_sales.prezzo` e `qromo_sales.cogs` sono valori UNITARI.

### Limiti dichiarati

- **Spedizione FUORI dal margine.** `shipping_total` e `free_shipping_amt` sono quello
  INCASSATO dal cliente; il costo vero del corriere sta in `expenses` categoria LOGISTICA e
  non e' attribuibile al singolo ordine. In `v_margine_ordine` la spedizione incassata e'
  esposta come colonna informativa, fuori dal margine.
- **Resi.** `returns` ha 0 righe e i rimborsi Shopify esistono solo a livello di ORDINE.
  Percio' `v_margine_ordine` sottrae il rimborso dal ricavo netto (MAI dal cogs) e un ordine
  interamente rimborsato esce a margine NEGATIVO, esplicito, non escluso.
  `v_margine_sku` NON alloca nessun rimborso alla riga: espone solo
  `pezzi_in_ordini_rimborsati`. **Il margine per SKU non sa se la merce e' rientrata**, perche'
  `returns` e' vuota: non assumere il rientro.
- **Fuori perimetro**: `b2b_movements` (0 righe) e `gifts_offline` (quirk noto: `prezzo` e'
  totale riga, `cogs` e' per unita'). Nessun dato personale del cliente nelle viste.
- **Arrotondamento**: ogni gruppo e' arrotondato a 2 decimali. Sommare le righe arrotondate di
  un mese differisce dal valore esatto di pochi centesimi (max 7 misurati su 6 mesi).

### Riconciliazione col CE (il test che conta)

`sum(margine_contribuzione)` di `v_margine_sku` contro `mc1` di `v_ce_amimi_summary`.
Non coincidono, e non devono: mc1 contiene voci non attribuibili al singolo SKU. Lo scarto e'
spiegato voce per voce, con residuo ZERO su tutti i mesi (2026, EUR):

| Mese | margine SKU | mc1 CE | scarto | spedizione esclusa | qta COGS | logistica var | resi | arrotond. |
|---|---|---|---|---|---|---|---|---|
| 02 | 1.629,04 | 1.612,25 | 16,79 | 11,15 | 0,00 | 0,00 | 5,66 | -0,01 |
| 03 | 5.501,09 | 4.866,59 | 634,50 | 238,11 | -28,66 | 425,07 | 0,00 | -0,03 |
| 04 | 6.314,89 | 6.143,45 | 171,44 | 151,48 | 20,00 | 0,00 | 0,00 | -0,04 |
| 05 | 7.831,90 | 6.482,97 | 1.348,93 | 58,11 | 0,00 | 1.015,42 | 275,41 | -0,01 |
| 06 | 12.016,69 | 11.380,01 | 636,68 | 168,95 | -4,00 | 0,00 | 471,72 | 0,01 |
| 07 | 11.218,01 | 11.124,19 | 93,82 | -191,80 | 0,00 | 0,00 | 285,69 | -0,07 |

Le quattro voci:

1. **Spedizione esclusa**: `(shipping_total + free_shipping_amt) / 1,22`. Il CE la include nel
   ricavo online, il margine no. A luglio la voce e' negativa perche' `free_shipping_amt` e'
   negativo: e' il candidato bug "free shipping sottratto due volte" gia' aperto in CONOSCENZA,
   non un effetto di queste viste.
2. **Qta COGS**: differenza tra COGS moltiplicato per la quantita' e COGS sommato grezzo.
3. **Logistica variabile**: spese di spedizione pagate, in mc1 e non nel margine di riga.
4. **Resi**: `refund_amount / 1,22`, in mc1 e non nel margine per SKU.

### Il CE conta il COGS senza la quantita' (SEGNALAZIONE, non corretto qui)

La voce 2 non e' una scelta di design del margine: e' un difetto del CE. `v_ce_amimi` somma
`shopify_line_items.cogs_snapshot` e `qromo_sales.cogs` **senza moltiplicarli per la quantita'**,
mentre entrambe le colonne sono unitarie (`shopify-sync/index.ts` scrive il COGS di anagrafica per
unita'; per Qromo lo conferma il match esatto con `products.cogs` sulla riga da 3 pezzi, 14,33 e
non 42,99). Con 843 righe di vendita su 845 a quantita' 1 il difetto era finora invisibile. I tre
casi reali:

- **marzo 2026**: vendita Qromo 3x `CHAIN_TIGER`, COGS contato 14,33 invece di 42,99.
  COGS sottostimato di **28,66**.
- **aprile 2026**: la riga Qromo neutralizzata dell'11-04 (quantita' 0, prezzo 0, nota "DOPPIONE
  rimosso") ha `cogs` 20,00 e il CE lo conta lo stesso. COGS sovrastimato di **20,00**.
- **giugno 2026**: ordine `#1394`, 2x `NINA_BAG_PEACH` a COGS 4,00 -> il CE conta 4,00 invece di
  8,00. COGS sottostimato di **4,00**.

Tutti e tre cadono in mesi CHIUSI (gen-giu 2026 in `ce_snapshots`). **L'owner ha autorizzato la
correzione il 2026-08-01**, che pero' comporta di rimettere mano a `v_ce_amimi` e `v_ce_totale` e
di RI-CHIUDERE i tre mesi: e' un lavoro a se', con brief dedicato
(`_CLAUDE_CODE_INBOX/2026-08-01_CLAUDE_CODE_BRIEF_ce_cogs_quantita.md`), non un fix di passaggio.
Effetto atteso su mc1: marzo 4.866,59 -> 4.837,93; aprile 6.143,45 -> 6.163,45;
giugno 11.380,01 -> 11.376,01.

### Il RICAVO offline invece e' giusto nel CE

`qromo_sales.prezzo` e' il **TOTALE della riga**, non il prezzo unitario: confermato dall'owner il
2026-08-01 sul caso reale (28-03, 3x `CHAIN_TIGER`, prezzo registrato 50,00 su listino 70,00,
incasso reale 50,00 in tutto). Qromo ha quindi lo stesso quirk gia' noto di `gifts_offline`:
**prezzo = totale riga, cogs = per unita'**. La prima versione di `v_margine_sku` (migr 0083)
seguiva la nota allora presente in CONOSCENZA ("prezzo per unita'") e gonfiava il margine di marzo
di 100,00 lordi: corretta dalla migr **0089**, e la nota di CONOSCENZA e' stata riscritta.
Su questo ricavo il CE era ed e' corretto.

## 10. Modulo shipping_status (migr 0086, brief stato_tws_in_app, 01-08)

- **`shipping_status`** (stato CORRENTE del corriere TWS per LDV, nessuno storico by design): `ldv` PK, `order_name` ('#NNNN'), `stato_tws` (UPPERCASE normalizzato), `stato_raw`, `shipped_date`, `delivered_at` (fissata alla PRIMA osservazione di CONSEGNATA, data Europe/Rome, approssimazione dichiarata), `updated_at`. Indice su `order_name`.
- **Sicurezza:** RLS on, SELECT solo `authenticated` (pattern cs_*), anon NEGATO (test `set role anon` -> permission denied); scritture SOLO service-role via edge `shipping-status-sync` (PIN-gated).
- **Chi scrive / chi legge:** scrive il sync spedizioni (Apps Script `SyncShopify.gs`, `pushShipStatusToApp_`, push clasp PENDENTE al 01-08); legge `cs-assist` v16 (BLOCCO DATI + caso indirizzo). Ciclo di vita stati: `NUOVA -> IN ATTESA DI AFFIDO -> IN PARTENZA TWS -> ... -> CONSEGNATA` (doc canonico: `Cowork12/docs/Spedizioni/Sistema_Spedizioni.md`).

## 11. Modulo sales-guard (migr 0087, brief A7, 01-08)

- **`alert_rules`** (soglie dei segnali, MAI hardcoded): `metrica` PK, `soglia`, `finestra_giorni`, `severity` (error/warn/info), `attivo`, `note`. 5 righe seed coi valori TARATI dal backtest 90gg (dettaglio nel changelog CODE 01-08). Ritaratura = UPDATE, zero redeploy. SELECT anon+authenticated (nessun segreto).
- **`v_sales_anomalie`** (ispezione a mano): righe correnti di best_seller_fermo / low_stock / esaurito_pubblicato / sconto_anomalo con `tipo, codice, dettaglio, valore`; legge le soglie da alert_rules (un solo posto).
- **`refresh_health_log()` aggiornata:** la pulizia giornaliera delle 06:00 ora esclude `sales\_%` e `shipping_status` oltre alle `ce\_%` (le chiavi scritte una volta al giorno/ora non spariscono piu' in silenzio). Provata invocandola.
- Flag: `app_flags.sales_guard_enabled` (default 'false'), `sales_guard_alert_state` (firma push), `ntfy_topic_sales` (opzionale, fallback `ntfy_topic`).

## 12. Viste clienti RFM e coorti (migr 0088, brief A8, 01-08)

> **DUE LIMITI STRUTTURALI, da ricordare prima di leggere qualsiasi numero:** (1) SOLO ONLINE: le 172 vendite Qromo hanno nome e cognome vuoti (172/172), l'identita' cross-canale non esiste e non e' costruibile a viste; (2) STORICO DAL 16-02-2026: recency/frequency strutturalmente sottostimate, per questo NON esiste il segmento "perso" (indistinguibile da "deve ancora ricomprare").

- **`v_clienti_rfm`** (una riga per email, 580 al 01-08): `email, primo_ordine, ultimo_ordine, recency_giorni, frequency, monetary, aov, segmento`. Resi: `frequency` conta TUTTI gli ordini con email (sum(frequency) = ordini con email, verificato 594=594); `monetary` esclude i `refunded` interi; i `partially_refunded` restano a gross_total pieno (l'importo parziale non e' a DB). Segmenti tarati sui dati (12 clienti ripetuti: quintili da manuale = classi assurde): `top` (monetary >= p90) > `ripetuto` (2+) > `nuovo` (1 ordine <= 60gg) > `dormiente` (> 120gg) > `una_tantum` (61-120gg, residuo). Test di allineamento: i 9 returning di luglio secondo ShopifyQL sono 9/9 in vista con frequency >= 2.
- **`v_clienti_coorti`** (per mese di primo acquisto): `coorte, maturita_giorni, clienti, ricomprato_30/60/90gg, netto_medio_cliente`. `maturita_giorni` esposta perche' le coorti giovani sembrano sempre peggiori solo per mancanza di tempo.
- **PII:** solo `email`, gia' esposta da `shopify_orders` (anon by design). Nessuna UI in questo giro: se un domani servira', la scelta anon-vs-login va presa esplicitamente (nota del brief).
