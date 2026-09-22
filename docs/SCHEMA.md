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
- **`shopify_orders`** + **`shopify_line_items`**: ordini (gross/net/discount/shipping/fees/refund, financial/fulfillment status, `fulfilled_at`, `discount_codes`) e righe (codice risolto, `cogs_snapshot`). Idempotenti su order_id. **Dal 13-09 (migr 0117, incidente doppioni 12-09):** vincolo **UNIQUE `shopify_orders_order_id_key`** su `order_id` (prima c'era solo un indice NON unico e "idempotente" valeva finche' la select degli esistenti funzionava: 756 righe ordine e 884 righe d'ordine doppie in tre giri di cron); `shopify_line_items.shopify_line_id` (id riga Shopify, indice unico parziale dove non NULL; scritto all'ingest dalla v7, storico abbinato con `backfill_line_ids`); vista **`v_shopify_doppioni`** (righe ordine oltre i distinti, gruppi ripetuti non distinti da `shopify_line_id`, ordini dal 01-07 senza righe: letta da ce-guard `ce_shopify_doppioni`); backup pre-bonifica in `_bak_shopify_orders_2026_09_13` / `_bak_shopify_line_items_2026_09_13` (chiuse ad anon e authenticated: contengono email clienti); il rollback e' lo snippet `supabase/snippets/0117_rollback_shopify_dedup.sql` (a mano, decisione owner, cron in pausa e v6 ri-deployata: un `insert select *` dal backup non passa il vincolo). L'indice `shopify_orders_orderid_idx` e' stato tolto: lo sostituisce quello del vincolo.
- **`qromo_sales`** (vendite negozio): `prezzo` = TOTALE della riga gia' scontato (NON si moltiplica per la quantita'; confermato dall'owner 01-08 sul caso 3x CHAIN_TIGER, vedi §9), `cogs` = snapshot per UNITA' (si moltiplica per la quantita'; corretto nel CE dalla migr 0093), `resolver_status` (resolved/unresolved), `sale_id` con **UNIQUE parziale** `qromo_sales_live_saleid_uq` per source in (`qromo-direct`, `qromo-forward`) (migr 0036); i duplicati storici da ETL sono tollerati.
- **`b2b_movements`**: conto_vendita/wholesale, tipo invio/reso/venduto, stato (le righe `annullato` sono ESCLUSE dal CE, migr 0028), incassi generati.
- **`gifts_offline`**: regali/vendite offline; QUIRK: `prezzo` e' il TOTALE riga (non si moltiplica per qta) e **anche `cogs` e' il totale di riga** (la nota precedente diceva "per unita'" ed era sbagliata, corretta 01-08: vedi le prove in §9). Nel CE Totale non va moltiplicato per la quantita'.
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
- **`cs_conversations.gmail_thread_id`: NON e' sempre un id Gmail puro (dal 01-08, cs-sync v13).** La regola resta "una riga per thread", col vincolo UNIQUE INTATTO, ma una conversazione nata da una RAFFICA sul modulo del sito porta la chiave `<thread>#<gmail_message_id>`. Serve perche' due invii nello stesso minuto producono notifiche con oggetto identico che Gmail accoda nello stesso thread: senza chiave distinta finirebbero in una conversazione sola, con dentro due clienti. **Conseguenza per chi legge questa colonna: se la usi per chiamare l'API Gmail, il thread vero e' `split('#')[0]`, e le chiavi col cancelletto vanno saltate** (lo fa gia' `backfill_out`). Perche' non una colonna nuova: togliere il vincolo UNIQUE avrebbe aperto la condizione "due righe per thread", su cui si romperebbero cinque `.eq(...).maybeSingle()` di cs-sync, e quel percorso non e' provabile senza il token Gmail.
- **`cs_*` (tool assistenza clienti, migr 0053, Fase 1):** `cs_conversations` (una riga per thread Gmail, UNIQUE `gmail_thread_id`, vedi il caveat qui sopra sulla forma suffissata; `canale` email_diretta|form_contatto|form_evento|chat_notifica|rumore; `stato` da_fare|in_corso|fatto (workflow coda dal 24-07: `in_corso` con `stato_by`=chi la prende, scritture via cs-api `set_stato`); `parse_failed`; colonne AI `categoria`/`categoria_source`/`categoria_confidence`/`urgente`/`urgenza_motivo`/`lingua` + **`flags` jsonb (migr 0065, Fase 2)** riempite dal classificatore; `summary` NULL fino a Fase 3), `cs_messages` (UNIQUE `gmail_message_id`, `body_text` troncato ~20KB GREZZO E INTATTO, **`body_clean` migr 0081** = solo le parole del mittente pulite in modo deterministico da cs-sync `stripQuoted` — citazioni/firma/boilerplate Inbox rimossi; NULL = fallback su body_text in UI/prompt; backfill 31-07 completo, azione `backfill_clean`, `form_fields` jsonb, **`reply_to` migr 0100** = header Reply-To conservato all'ingest, fonte dell'email cliente INDIPENDENTE dal corpo: sul canale modulo Shopify lo valorizza qualunque sia la lingua del template, quindi la cintura cross-cliente non dipende piu' dal solo riconoscimento dello stampo; e' l'ULTIMA fonte di `emailCliente` dopo `form_fields.email` e `from_email`, cosi' non puo' cambiare un esito gia' corretto; storico riempito il 01-08 con l'azione `backfill_replyto`, 152 righe su 408, le altre non hanno l'header e restano NULL per davvero), `cs_events` (audit del tool, dominio separato da change_log; azioni `ingest`/`parse_failed`/`classify`/`categoria_edit`), `cs_drafts`/`cs_faq` (create vuote, uso in Fase 3). **RLS diversa dal resto dell'app** (§7): SELECT solo `authenticated`, scritture solo dalle edge service_role. Scritte da `cs-sync` (ingest), **`cs-classify` (categoria/urgenza, Fase 2)**, **`cs-api` (correzione manuale categoria dalla UI, JWT-gated, Fase 2)** e **`cs-assist` (`summary`/storia + `cs_drafts` bozze, Fase 3)**; mai da write-api. `categoria_source`: `ai` (>=0.6) | `ai_low` ("da confermare") | `manuale` (correzione UI). **`cs_drafts`** (Fase 3): bozze on-demand da `cs-assist` (`testo`, `dati_usati` jsonb = blocco DATI, `model`, **`source` 'app'|'eval' migr 0080: le righe generate dall'harness scripts/cs-eval.mjs sono marcate 'eval' e si isolano con una query**, **`rami` jsonb + `ramo_scelto` migr 0101**: col nuovo schema `rami` porta i titoli degli ESITI proposti e `ramo_scelto` quello che l'operatrice ha davvero usato, scritto all'INVIO da `cs-api` azione `draft_ramo` e non al click di anteprima, perche' una bozza guardata non e' una bozza scelta; `used` sale insieme e smette di essere la colonna morta prevista dalla migr 0053); **`cs_faq`** seedata con 6 `esempio_tono` (migr 0067) + **12 `risposta_standard` IT/EN (migr 0069, Fase 3)** coi valori operativi confermati dall'owner (reso **15gg** dalla consegna dal 2026-07-23 migr 0071, riunione owner; corriere TWS, codice AMIMILANO10 (migr 0075, era PERTE), ritiro Via Plinio 43 provvisorio; NB: il sito policy dice ancora 14gg -> allineare il tema Shopify); i 3 `esempio_tono` con `[DA VERIFICARE]` (ritiro/sconto/reso) aggiornati coi valori. VINCOLO: la `categoria` delle `risposta_standard` DEVE essere una delle 14 stringhe ESATTE del classificatore `cs-classify` (senza emoji), altrimenti `cs-assist.faqTono` (che filtra `categoria === conv.categoria`) non le inietta. `A13 "Modifica / correzione indirizzo"` PROMOSSA a 14a categoria del classificatore il 2026-07-23 (cs-classify v5, OK owner): ora la riga si aggancia alle conversazioni classificate cosi'. A1 (Spedizione) non hardcoda piu' un link tracking generico (migr 0070): usa il link per-ordine dal BLOCCO DATI (mytws.it/tracking-status;ldv=, stessa logica della pipeline **amimi-ship**; NB: `ship-sync` NON e' una edge function e non lo e' mai stata, e' l'abbreviazione con cui i changelog chiamano `amimi-ship`, progetto Python che gira su GitHub Actions, vedi `amimi-ship/README.md`). Config in `app_flags`: `cs_enabled` (interruttore go-live), `cs_last_history_id` (cursore Gmail), `cs_gmail_sa_key`, `cs_noise_senders` (denylist rumore estendibile, 77 voci), **`cs_stall_msg`** (cs-sync v18, 13-09: stato dello stallo in corso, JSON `{id, thread, dir, n, first_at, err}`; assente = nessuno stallo; la edge la scrive, la aggiorna e la cancella da sola, non va toccata a mano), `gemini_api_key` (classificatore+riassunto+bozza), **`cs_rami_enabled` (migr 0101, nata a `false`, ACCESA a `true` il 01-08 notte su decisione dell'owner)** = schema delle bozze: `false` tre varianti di TONO (breve/calda/formale), `true` fino a tre ALTERNATIVE DI CONTENUTO con titolo, piu' il blocco CASO in forma di rami ammessi (cs-assist v25). Accensione e rollback sono questo flag, **senza deploy**: a `false` prompt, contratto JSON e blocco CASO sono byte per byte quelli di prima. Il collaudo alla cieca del punto 6 della spec v17 (script `SIM_*` nel progetto Cowork, servono la chiave Gemini o un login @amimi.it) **non e' stato eseguito**: l'owner ha scelto di accendere e misurare sul campo. 3 topic ntfy.
- **`loyalty_*` (loyalty via App Proxy, migr 0068, sottosistema NON-core GATED):** `loyalty_points` (`shopify_customer_id` PK, `points` int, `updated_at`) e `loyalty_events` (append-only: `id` uuid, `shopify_customer_id`, `delta`, `source`, `meta` jsonb, `created_at`; audit + base del cap anti-abuso). Scritte SOLO dalla edge `loyalty-proxy` (service_role) dopo verifica firma HMAC dell'App Proxy Shopify; NON passano da write-api (non toccano CE/stock/inventario/Qromo). RLS on **senza policy** + REVOKE ad anon/authenticated (§7): zero accesso diretto dal client, piu' chiuse delle `cs_*`. Canale LIVE dal 24-07 (config App Proxy + secret fatti dall'owner/Cowork).
- **`mimi_state` (personaggio Mimi, migr 0078, stesso sottosistema):** `shopify_customer_id` PK, `nanna` bool, `last_coccola` date, `last_memory` date, `worn` text, `updated_at`. Stato del profilo Premia per cliente: sacchettino/nanna, quale capo indossa Mimi, e le due attivita' a premio del giorno. **Le date `last_*` sono giorni Europe/Rome**, non UTC (le azioni nuove usano il giorno civile italiano; il vecchio `add` del clicker resta su UTC per retro-compat). Stessa postura di `loyalty_*`: scritta SOLO dalla edge `loyalty-proxy` col service_role, RLS on **senza policy** + REVOKE ad anon/authenticated (§7), verificato con test negativo. I PUNTI non stanno qui: restano su `loyalty_points`/`loyalty_events` (una sola fonte di verita' per il saldo e il suo audit).

## 5. Viste (logica derivata)

- **`v_inventory`**: giacenza = acquisti - shopify - qromo - regali - b2b_venduto + resi_rientrati + aggiustamenti; espone anche in_conto_vendita, disponibili_da_vendere, valore, last_sale, on_shopify (da `shopify_stock` LIVE, migr 0021; dal 0041 SOLO status active: le bozze non contano come pubblicate), image_url con fallback Shopify.
- **`v_ce_completezza`** / **`v_vendite_orfane`** (migr 0126/0127, 14-09): guardiani di CONSERVAZIONE letti da ce-guard v7. `v_ce_completezza`: per mese nativo, `spese_scoperte` = spese approvate meno (righe-spesa del CE + esclusioni COGS + PACKAGING); != 0 = una spesa senza bucket (come fu la logistica). `v_vendite_orfane`: righe di vendita con year/month NULL/invalido, invisibili al CE. Entrambe devono restare a 0.
- **`v_ce_totale`**: dal 14-09 (migr 0123, audit gate B48) `logistica_var` = `COALESCE(m.logistica_var, ex.logistica_var, 0)`: le spese LOGISTICA con sottocategoria 'Spedizioni' entrano nel Totale anche da marzo in poi (prima solo gen/feb dal blocco manuale; logistica_mag continua a escludere le sped). Mar/apr ri-chiusi in ce_snapshots; maggio ha solo lo scostamento del caso 16.
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
spiegato voce per voce, con residuo ZERO su tutti i mesi (2026, EUR; valori dopo la correzione
del COGS della migr 0093):

| Mese | margine SKU | mc1 CE | scarto | spedizione esclusa | logistica var | resi | arrotond. |
|---|---|---|---|---|---|---|---|
| 02 | 1.629,04 | 1.612,25 | 16,79 | 11,15 | 0,00 | 5,66 | -0,01 |
| 03 | 5.501,09 | 4.837,93 | 663,16 | 238,11 | 425,07 | 0,00 | -0,03 |
| 04 | 6.314,89 | 6.163,45 | 151,44 | 151,48 | 0,00 | 0,00 | -0,04 |
| 05 | 7.831,90 | 6.482,97 | 1.348,93 | 58,11 | 1.015,42 | 275,41 | -0,01 |
| 06 | 12.016,69 | 11.376,01 | 640,68 | 168,95 | 0,00 | 471,72 | 0,01 |
| 07 | 11.218,01 | 11.124,19 | 93,82 | -191,80 | 0,00 | 285,69 | -0,07 |
| 08 | 70,76 | 70,76 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |

Le tre voci:

1. **Spedizione esclusa**: `(shipping_total + free_shipping_amt) / 1,22`. Il CE la include nel
   ricavo online, il margine no. A luglio la voce e' negativa perche' `free_shipping_amt` e'
   negativo: e' il candidato bug "free shipping sottratto due volte" gia' aperto in CONOSCENZA,
   non un effetto di queste viste.
2. **Logistica variabile**: spese di spedizione pagate, in mc1 e non nel margine di riga.
3. **Resi**: `refund_amount / 1,22`, in mc1 e non nel margine per SKU.

Fino al 2026-08-01 servivano DUE voci in piu', "qta COGS" e "qta Qromo", che non erano scelte di
design del margine ma difetti del CE e delle prime viste del margine. Sono sparite entrambe: la
loro scomparsa e' la prova incrociata che le correzioni (migr 0089 e 0093) sono giuste.

### Il CE contava il COGS senza la quantita' (CORRETTO il 2026-08-01, migr 0093)

`v_ce_amimi` e `v_ce_totale` sommavano `shopify_line_items.cogs_snapshot` e `qromo_sales.cogs`
**senza moltiplicarli per la quantita'**, mentre entrambe le colonne sono unitarie
(`shopify-sync/index.ts` scrive il COGS di anagrafica per unita'; per Qromo lo conferma il match
esatto con `products.cogs` sulla riga da 3 pezzi, 14,33 e non 42,99). Con 843 righe di vendita su
845 a quantita' 1 il difetto era rimasto invisibile per mesi. Trovato il 31-07 costruendo
`v_margine_sku`, corretto il 01-08 su autorizzazione esplicita dell'owner.

I tre casi reali e l'effetto su mc1, identico sui due CE:

- **marzo 2026**: vendita Qromo 3x `CHAIN_TIGER`, COGS contato 14,33 invece di 42,99 -> **-28,66**.
- **aprile 2026**: la riga Qromo neutralizzata dell'11-04 (quantita' 0, prezzo 0, nota "DOPPIONE
  rimosso") portava comunque 20,00 di COGS -> **+20,00**.
- **giugno 2026**: ordine `#1394`, 2x `NINA_BAG_PEACH` a COGS 4,00, contati 4,00 invece di 8,00
  -> **-4,00**.

I tre mesi erano CHIUSI e sono stati **ri-chiusi** dalla migr 0094 (3 mesi x 2 CE = 6 righe,
`closed_by = 'reclose-cogs-quantita-2026-08-01'`), con guardia sull'invariante del ricavo netto:
`delta_netto` e' rimasto 0,00 su tutte le righe, perche' la correzione tocca solo il COGS.
`v_ce_drift` dopo la ri-chiusura e' 0 sia su netto sia su mc2.

**`gifts_offline.cogs` NON e' stato toccato** (compare solo in `v_ce_totale`) e la sezione 3 di
questo documento, che lo descriveva come "per unita'", era **sbagliata**: si comporta da TOTALE di
riga. Prove: `ANNIE_BAG_PERSONALIZZAZIONE_MATRIMONIO` ha 14 pezzi e `cogs` 210,00, e anche
`products.cogs` vale 210,00, cioe' il costo del LOTTO (moltiplicare darebbe 2.940,00); e 13 righe
hanno quantita' 0 con `cogs` > 0 perche' sono rettifiche di conta per pezzi mancanti, dove il costo
e' una perdita reale che moltiplicare azzererebbe. Su gifts il CE e' quindi corretto com'e'.

### Il RICAVO offline invece e' giusto nel CE

`qromo_sales.prezzo` e' il **TOTALE della riga**, non il prezzo unitario: confermato dall'owner il
2026-08-01 sul caso reale (28-03, 3x `CHAIN_TIGER`, prezzo registrato 50,00 su listino 70,00,
incasso reale 50,00 in tutto). Qromo ha quindi lo stesso quirk gia' noto di `gifts_offline`:
**prezzo = totale riga, cogs = per unita'**. La prima versione di `v_margine_sku` (migr 0083)
seguiva la nota allora presente in CONOSCENZA ("prezzo per unita'") e gonfiava il margine di marzo
di 100,00 lordi: corretta dalla migr **0089**, e la nota di CONOSCENZA e' stata riscritta.
Su questo ricavo il CE era ed e' corretto.

## 10. Modulo shipping_status (migr 0086, brief stato_tws_in_app, 01-08)

- **`shipping_status`** (stato CORRENTE del corriere TWS per LDV, nessuno storico by design): `ldv` PK, `order_name` ('#NNNN'), `stato_tws` (UPPERCASE normalizzato), `stato_raw`, `shipped_date`, `seen_delivered_at` (migr 0095, era `delivered_at`: e' la data Europe/Rome in cui il sync ha OSSERVATO il passaggio a CONSEGNATA, NON la data del corriere, che TWS non espone; NULL se la riga era gia' consegnata alla prima osservazione), `updated_at`. Indice su `order_name`.
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

## 11. Modulo invio Fase 4: cs_sends (migr 0092, brief cs_fase4_invio_dallapp, 01-08)

- **`cs_sends`** (registro dell'idempotenza dell'invio, una riga per CONFERMA): `send_key` uuid PK (la genera la UI all'apertura del dialog), `conversation_id` FK, `chi`, `to_email`, `testo_sha`, `status` sending|sent|error, `gmail_message_id`, `gmail_thread_id`, `error`, `created_at`, `updated_at`. Indice su (`conversation_id`, `created_at desc`).
- **A cosa serve:** `cs-send` RIVENDICA la chiave con un INSERT **prima** di chiamare Gmail. Un doppio click o un retry di rete arrivano con la stessa `send_key`, trovano la riga e ricevono `already_sent` invece di produrre una seconda email. La riga e' anche l'audit dell'esito (con il motivo, se `error`).
- **Sicurezza:** stessa postura delle altre `cs_*` (§7): SELECT solo `authenticated`, nessuna policy di scrittura, `revoke all` da anon/authenticated. Test negativo eseguito: `set role anon; select from cs_sends` -> permission denied.
- **Nota di lettura:** `cs_messages.is_via_tool` e `sent_by`, previste dalla migr 0053 e mai valorizzate fino ad oggi, si popolano da qui: `is_via_tool=true` distingue le risposte partite dall'app da quelle scritte a mano in Gmail e ingerite da `cs-sync`.

## 13. `shopify_catalog` — da seed morto a mirror vivo (migr 0097, brief cs_assist_migliorie, 01-08)

- **Cos'e':** il mirror del catalogo Shopify per codice — `codice` (PK), `handle` (lo slug della scheda, con cui si costruisce `https://amimi.it/products/<handle>`), `on_shopify` (la scheda e' `active`), `synced_at`. **Non e' la fonte dello stock:** quella e' e resta `shopify_stock`.
- **Il difetto che ha reso necessaria la migrazione:** la tabella era stata seminata UNA volta (94 righe, migr 0008 del 24-06) e non l'aveva piu' aggiornata nessuno. La migr 0021 l'aveva gia' dichiarata stale a giugno e aveva spostato `v_inventory.on_shopify` sul mirror vivo, ma la tabella era rimasta li'. Dal 24-07 `cs-assist` ci costruisce sopra il link alla scheda prodotto **nelle risposte alle clienti**, e una tabella ferma e' diventata un problema che si vede: **67 handle su 99 prodotti**, in peggioramento a ogni prodotto nuovo, e proprio sugli esauriti (dove il link "avvisami quando torna disponibile" serve di piu'). Conteneva anche codici morti (i vecchi nomi colore `MUSTARD_ROSE`, `PINK_OLIVE`, `REED`).
- **Chi la scrive ora:** SOLO `shopify-stock` (`doSync`, cron orario `:17`), dallo stesso pull di `products.json` che gia' faceva — aggiunto `handle` ai `fields`. **Nessuno scope Shopify nuovo, nessuna chiamata in piu', lo stock non cambia.** Si comporta come `shopify_stock`: upsert di cio' che si vede e prune di cio' che non c'e' piu' (solo a pull completo e non vuoto).
- **Regole:** entrano solo i codici **con** un handle (senza handle non c'e' URL, e un URL inventato finirebbe in una mail, Regola 1); `on_shopify` e' vera solo per le schede `active`, perche' linkare una bozza manda la cliente su una pagina che non esiste per lei.
- **Chi la legge:** solo `cs-assist`, con join case-insensitive su `upper(codice)` e filtro `on_shopify`. **Nessuna vista la usa** (verificato su `information_schema.views` prima di toccarla): CE, inventario e le 4 viste protette dalla Regola 19 non sono in gioco.
- **`synced_at` serve a farla vedere:** e' rimasta indietro cinque settimane senza che nessuno se ne accorgesse. Con una data sopra, una tabella ferma si nota.
- **Misurato il 01-08 dopo il primo giro:** 94 righe -> **224**, 93 righe morte rimosse, **copertura link da 67/99 a 99/99**, zero doppioni case-insensitive, cinque URL nuovi provati a mano (200). Secondo giro consecutivo: `catalogoPruned: 0`, idempotente. Impronta di `shopify_stock`, giacenze (798) e CE di agosto **identici** prima e dopo.

## 14. Modulo lead_* : ricerca negozi B2B e outreach (migr 0111, 2026-09-08)

Modulo additivo (Regola Ferrea 19) per la ricerca di negozi e gruppi multimarca da contattare (piano in `Cowork12/projects/B2B_Prospecting_2026-09/`). Core toccato solo in LETTURA (`negozi` via FK `lead_accounts.negozio_id`, valorizzata solo al primo ordine). Flag `app_flags.lead_enabled` = `false` (oggi non gata nulla: nessun cron).

- **Tabelle**: `lead_accounts` (negozio/gruppo, `stato_ricerca` seed->enriched->scored->reviewed|rejected, `tier` deciso da persona, `gancio`), `lead_contacts` (persone, `opt_out`), `lead_evidence` (append-only: `tipo`, `payload` jsonb, `asset_path` nel bucket), `lead_scores` (valutazioni versionate, `rubrica_version`, `criteri` jsonb con prova per criterio, `totale`, `tier_proposto`), `lead_reviews` (decisione umana), `lead_runs` (ogni giro di collector/judge), piu' `lead_touches`, `lead_drafts`, `lead_knowledge` create vuote per la Fase 2 (outreach).
- **Trigger** `lead_reviews_apply` (security definer): un INSERT in `lead_reviews` aggiorna `lead_accounts` (tier/reviewed, rejected con motivo, ricontrolla -> seed, nota).
- **Viste** (security_invoker): `v_lead_dossier` (account + ultimo score + ultima review + ultimi screenshot e payload IG/Maps/brand/prezzi), `v_lead_pipeline`.
- **Sicurezza**: RLS su tutte, SELECT solo `authenticated` con email `@amimi.it`, anon zero (test negativo `set role anon` = permission denied, verificato 08-09). Unica scrittura applicativa: INSERT su `lead_reviews` dall'utente loggato. Bucket Storage **`lead-assets` privato** (screenshot), lettura via URL firmati dalla PWA.
- **Chi scrive**: il collector `amimi-app/workers/lead/` (Node + Playwright, service_role letta a runtime dalla Management API, mai su disco) scrive `lead_*` e il bucket; la sessione Claude Code scrive `lead_scores` con `judge_write.mjs`. Nessuna scrittura via write-api: e' telemetria del modulo, non dati core (lettura della Regola 19 data anche a cs-* e sales-guard).
- **UI**: pagina "Negozi B2B" nella PWA (`web/src/pages/Negozi.tsx`, `lib/leadApi.ts`), login con lo stesso client dell'Assistenza.
- **Test di non regressione 08-09**: `sum(giacenza_attuale)` = 865 e `mc1` settembre 2026 = 2825,73 prima e dopo la migrazione.
- **Migr 0112 (08-09 sera)**: `v_lead_dossier` ricreata (DROP + CREATE: le colonne cambiano posizione) con in piu' `ig_posts` (12 post scaricati nel bucket, date, cadenza), `site_products` (foto prodotto da `products.json`, prezzo, vendor, flag borsa), `maps_reviews`, `stampa` (DuckDuckGo), `site_meta`, `about_text`, `shot_maps_photos` e `thumb` (primo post IG, miniatura di lista). Solo vista, nessuna tabella nuova.
- **Migr 0113 (10-09)**: verdetto umano su `lead_accounts` (`verdetto` da_contattare/forse/no, `verdetto_motivo`, `verdetto_chi`, `verdetto_at`) scritto via `lead_reviews` con azione `verdetto` (trigger aggiornato).
- **Migr 0114 (10-09), outreach tappa 1**: `lead_accounts` + `prossima_azione`, `prossima_azione_at`, `owner_outreach`; `lead_touches` + `esito`, `prossima_azione`, `prossima_azione_at`, `sequenza_tocco`, INSERT concesso ad `authenticated` @amimi.it (stesso canale controllato di `lead_reviews`); trigger `lead_touches_apply` (stadio automatico: out da da_contattare -> contattato, in -> risposto; `stage_dopo` esplicito vince; esito opt_out -> stadio opt_out + `lead_contacts.opt_out`); tabella `lead_sequences` (4 tocchi IT + EN da `Sequenze_Outreach_IT_EN.md`, segnaposto `{{nome_negozio}} {{referente}} {{gancio}} {{firma}}`); vista `v_lead_outreach` (negozi con verdetto da_contattare o gia' in lavorazione, ultimo tocco, giorni, `scaduta`, `da_gestire`, thumb, contatti dalle evidenze). **Migr 0115**: `v_lead_settings` (proprieta' postgres, sola lettura authenticated) espone da `app_flags` solo `lead_enabled`, `lead_firma`, `lead_tetto_giornaliero`.
- **Migr 0139 (22-09), bozze AI e invio dall'app**: `lead_drafts` + `oggetto`, `to_email`, `sequenza_tocco`, `model`, `send_key`, `sent_at`, `sent_by`, `gmail_message_id`, `gmail_thread_id`, `errore`, `updated_at`; stati `proposta|approvata|in_invio|inviata|errore|scartata`; indici unici `send_key`, (account, tocco) sulle bozze `in_invio|inviata`, e `lead_touches` (account, tocco) sui tocchi email in uscita. Flag `lead_outreach_ai_enabled` (OFF) e `lead_linesheet_url` (vuoto), entrambi esposti da `v_lead_settings`. Scrive solo la edge `lead-outreach` (service_role dopo JWT @amimi.it); la UI legge `lead_drafts` e non ci scrive.

## 15. Modulo Meta Ads a livello creativita' (migr 0128-0134, 2026-09-18/20)

- **Perche'**: `meta_ads_daily` (livello campagna, 130 righe `source='etl'`) era ferma al 01-07 senza ingest (caso #12). Il nuovo modulo e' ADDITIVO: `meta_ads_daily` e `v_ads_mensile` restano come sono.
- **Tabelle (migr 0128, RLS ON senza policy + grant SOLO a `service_role`: le legge solo l'edge `ads-sync`)**: `meta_ads_creative_daily` (una riga per ad per giorno, `unique (date, ad_id)`; metriche insights level=ad, `purchases`/`purchase_value` gia' consolidate sulle forme omni/offsite; `ad_status`/`creative_id` riservati, null in v1), `meta_ad_creative` (PK `ad_id`: `creative_id`, `product_set_id`, `catalog_id`, `link`, `url_tags`, `thumbnail_url`, `effective_status`, `first_seen`/`last_seen`), `meta_product_set_map` (`unique (product_set_id, retailer_id)`: `retailer_id` = variant id Shopify, `codice_norm` risolto o NULL, `product_name`, `availability`). Un blocco `do $$` verifica i vincoli dopo il `create table if not exists` (C2). `app_config.meta_token` (text, segreto, solo service-role) per il token System User.
- **Viste (migr 0129, 0130; owned da postgres, `grant select` ad anon/authenticated come `v_ads_mensile`)**: `v_ads_set_inventory` (per `product_set_id`: `prodotti_nel_set`, `prodotti_risolti`, `prodotti_oos`, `prodotti_low_stock` (1-2), `prodotti_non_su_shopify`, `pct_oos` calcolata sui RISOLTI; join a `v_inventory` su `codice_norm`); `v_ads_creative_windows` (per ad: `as_of` = max(date), somme su ultimi 7 / 8-14 / 90 giorni, `giorni_attivi_90`, **`freq_media_giornaliera_7` = media della frequency giornaliera, NON la frequency a 7 giorni**); `v_ads_creative_status` (per ad: nome recente dall'anagrafica, `effective_status`, `product_set_id`, `spend_7`, `purchases_7`, `ctr_7`/`ctr_prev7`/`ctr_90`, `cpm_7`, `cpa_7`, `roas_7`, inventario del set, `stato_fatica` alta/media/ok con soglie **tarate sui dati reali nella 0130** (alta >= 1,7 e CTR sotto la media 90g; media >= 1,4 e CTR sotto la settimana prima), `azione_suggerita` ("set scoperto" SOLO con >= 3 risolti e >= meta' del set e >= 30% OOS, col rapporto risolti/nel_set nel testo; "rinfresca la creativita'" sulla fatica alta)); `v_ads_weekly_account` (settimana ISO: spend, purchases, value, cpa, roas, `spend_wow`, `purchases_wow`).
- **Cron (migr 0131)**: `ads-sync-daily` alle `7 6 * * *` UTC (dopo `refresh_health_log` delle 06:00 che cancella le chiavi non ce_*), `net.http_post` con PIN, `source: cron`. Riga in `change_log` op `cron_create`.
- **Chi scrive**: solo l'edge `ads-sync` con service role. La PWA leggera' dalle viste (tab Ads, Fase 2). Nessuna scrittura via write-api (telemetria di modulo, come lead_* e cs_*).
- **Gotcha**: `retailer_id` del catalogo Meta = variant id Shopify, e `shopify_stock.variant_id` tiene UNA variante per codice (dual SC/CC): la variante sorella cade sul fallback per nome. Misurato il 18-09 dopo la v1.1: 309/517 righe risolte (59,8%), il resto sono prodotti del catalogo Meta assenti dal mirror (archiviati/rimossi): non giudicabili a stock, e va bene cosi'. La `pct_oos` e' sui risolti, per questo il gate di copertura nell'azione.
- **Non regressione 18-09**: nessuna tabella/vista esistente modificata; `tests/features.mjs` 17/17 prima e dopo le migrazioni; 4 backfill live senza errori (623 righe ad-giorno, 90 giorni).
- **Redesign 19-09 (migr 0132/0133)**: tabella `meta_ad_freq7` (frequency VERA a 7g per ad, RLS on, service_role; punto 6); colonna `meta_ad_creative.image_url` (immagine grande dell'asset); viste `v_ads_set_modelli` (modelli nel product_set con borse live) e `v_ads_catalogo_modelli` (borse totali/su Shopify/live per modello) grant anon; `v_ads_creative_windows` + adset_name (in coda: create or replace e' append-only); `v_ads_creative_status` v2 (DROP+CREATE: +adset_name/object_type/image_url/freq_7g, fatica sulla freq reale tarata alta>=2,5 media>=1,8 con fallback sulla media giornaliera). Gotcha modello: lo stesso `item` compare su categoria BAG e ALTRO (categoria nulla), quindi il frontend somma per modello.
- **0134 (20-09)**: colonna `meta_ad_creative.frame_url` (fotogramma GRANDE del video, risolto lato server dall'edge: poster `video_data.image_url`/`asset_feed_spec.videos`, o il thumbnail piu' grande dal nodo video) esposta in `v_ads_creative_status` (DROP+CREATE, +`c.frame_url`); il frontend la usa prima di `image_url`/`thumbnail_url`. Il `thumbnail_url` 64px resta come ultimo fallback (renderizza, non e' 403-bloccato).
- **Da fare**: refresh di `schema.sql` (dump): le tabelle/viste di questo modulo non ci sono ancora.

## 16. Modulo mat_* : materie prime, catalogo fornitori (migr 0140, 2026-09-22)

Registro SEPARATO dal core (Regola 19): le materie prime non hanno CODICE_AMIIMI, giacenza ne' CE, quindi non stanno in `supplier_orders`/`purchases`. Brief: `Cowork12/docs/Codice_e_Automazione/BRIEF_fornitori_materie_prime_catalogo_2026-09-22.md` (+ brief Cowork 17-09). Doc operativo: `Cowork12/docs/Codice_e_Automazione/Materie_Prime_Catalogo.md`.

- **`mat_suppliers`** (9): anagrafica fornitori di pelli/tessuti/nastri/accessori; `core_supplier_id` FK opzionale a `suppliers` (solo lettura, oggi NULL ovunque); UNIQUE `lower(nome)`.
- **`mat_items`** (31): UNA riga per materiale + colore (1:1 col Notion di Ginevra); `categoria` check su 11 valori; UNIQUE (`supplier_id`, `lower(materiale)`, `lower(coalesce(colore,''))`).
- **`mat_offers`** (18): listini e offerte nel tempo; `prezzo` numerico SOLO se valore singolo e certo, `prezzo_text` fedele per range e scaglioni (Regola 1); UNIQUE (item, data, fonte).
- **`mat_orders`** (6) + **`mat_order_lines`** (13): acquisti (testata con totali verificati dai documenti, righe con imponibile); `stato` default `ordinato` (non tracciato in Fase 1); UNIQUE (fornitore, numero) e (ordine, item). Somma imponibili righe = 4.769,08 (check del seed).
- **`mat_assets`** (23): path nel bucket privato **`mat-assets`** + `tipo` (foto, scheda_tecnica, proforma, documento, campione) e aggancio a item (colore), materiale (tutti i colori), ordine (proforma) o solo fornitore; `path` UNIQUE.
- **`mat_events`**: audit del modulo (service_role); non usa `change_log`.
- Viste (security_invoker, solo `authenticated` @amimi.it): **`v_mat_catalogo`** (item + ultima offerta + ultimo acquisto + prima foto, `prezzo_rif`/`prezzo_rif_text`/`unita_rif`, `acquistato`), **`v_mat_fornitori`**, **`v_mat_acquisti`**, **`v_mat_assets`**. **`v_mat_settings`** (owner postgres, leggibile anche da anon) espone SOLO `app_flags.mat_enabled`: la Home nasconde la tile a flag spento.
- Sicurezza: RLS + REVOKE come `lead_*` (anon: niente; authenticated: SELECT con email @amimi.it; `mat_events` nemmeno a authenticated); bucket privato con policy SELECT @amimi.it (URL firmati dal client). Nessun grant di scrittura ai ruoli applicativi in Fase 1.
- Scritture Fase 1: SOLO `etl/seed_mat.mjs` (service_role via Management API, dry-run di default, `--apply`), idempotente per chiave naturale (rilancio = 0 righe nuove, provato il 22-09). Fase 2: edge `mat-api` (postura cs-api) per form e foto dalla PWA.
- Flag `mat_enabled` = `false` (rollback = flag OFF). Guardie sul sorgente: `tests/mat_guardie.mjs` (25).
- **Migr 0144 (23-09), Fase 2**: `ai_compila_log` (ogni chiamata a Gemini dello strato "Compila": chi, target, n_immagini, input_hash, testo, output jsonb, modello, ms, `esito` proposta|confermato|modificato|scartato|errore, ref alla riga confermata; RLS ON e nessun privilegio ai ruoli applicativi: lo legge e scrive solo il service_role); trigger `updated_at` su `mat_suppliers` e `mat_items`; policy Storage `mat_assets_ins` = INSERT per authenticated @amimi.it SOLO sotto `inbox/` (il file caricato non e' un dato finche' mat-api non lo registra); flag `mat_write_enabled` (OFF: sezione in sola lettura), `ai_compila_enabled` (OFF: niente bottone Compila), `ai_compila_model` (default `gemini-flash-lite-latest`); `v_mat_settings` espone i tre flag non sensibili. Scritture dei dati SOLO via edge `mat-api` (audit in `mat_events`); l'AI (edge `ai-compila`) non scrive nulla tranne il proprio log. Guardie: `tests/mat_guardie.mjs` (55), golden set `tests/mat_ai_golden.mjs` (a mano, con la chiave).
