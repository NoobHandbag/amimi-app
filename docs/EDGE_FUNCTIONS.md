# Amimì App - EDGE FUNCTIONS (riferimento)

> Una scheda per ogni edge function Supabase (project `imszbjeyplaiovylhkgl`). Creato 2026-07-06 dal codice in `supabase/functions/` + verifica live (`list_edge_functions`).
> Le VERSIONI cambiano a ogni deploy: quelle qui sotto sono lo stato al 2026-07-06 sera (round feedback cofounder); per la verita' live usare Supabase MCP `list_edge_functions`. Tutte le functions hanno `verify_jwt=false`.
> Deploy: SOLO via Supabase MCP `deploy_edge_function` (niente CLI link); e' territorio Claude Code (Regola Ferrea 16). I valori dei segreti NON vanno mai riportati nei doc (repo pubblico).

Pattern comuni: auth "PIN" = `body.pin` -> sha256 -> confronto con `app_config.pin_hash` (PIN neutralizzato a `x` per scelta owner: e' design, non sicurezza). Scritture con service-role key da env. Audit su `change_log`, telemetria su `health_log`.

## write-api (v20) - UNICO path di scrittura dati

- **Scopo:** ogni scrittura dati dell'ecosistema (app, Cowork, MCP) passa da qui.
- **Auth:** PIN.
- **Azioni:** `purchase`, `gift`, `b2b`, `product`, `order` (insert generici con validazione), `order_multi` (ordine fornitore multi-riga, un `gruppo`; dal v15 righe `wip:true` con qty 0 ammesse e stub prodotto con item/variant MAIUSCOLI), `arrival` (arrivo su ordine: aggiorna `qty_arrived` + inserisce in `purchases`), `arrival_set` (correzione qty_arrived con delta; dal v15 accetta `costo_unitario` opzionale e RISOLVE le righe WIP: ordinato = arrivato totale, wip=false), `count` (conta fisica: delta calcolato LATO SERVER da `v_inventory`, scrive `counts` + `stock_adjustments`), `product_verify` (completa anagrafica, accetta anche `cogs`; dal v15 item/variant forzati MAIUSCOLI lato server; dal v16 alla PRIMA verifica il CODICE si RIGENERA dai Modello+Variante finali di Benny — il codice dell'ordine di Ginni e' provvisorio — con rename a cascata su 8 tabelle e guardia anti-collisione), `expense_manual` / `expense_propose` / `expense_approve` (spese: dirette, in coda, approvazione con eventuale ricategorizzazione), `sale_correct` (riassegna una vendita Shopify/Qromo a un CODICE corretto, ri-snapshotta il COGS), `return` (reso/cambio; `sostituito_con` scala anche il sostituto; dal v15 `importo_rimborsato` e' CON SEGNO: negativo = il cliente paga la differenza), `qromo_sale` (forward idempotente, fallback COGS da `products`), `order_delete` (v15: elimina una riga ordine fornitore; 409 se ha arrivi registrati, salvo force), `reorder_archive` (v15: flag `products.riordino_archiviato` on/off), `product_delete` (brief 14-07, LIVE dal v20 19-07: elimina UNA riga di `products` con guardrail — 404 se assente; 409 se giacenza o conto vendita != 0, se ordini fornitore agganciati, o se riga in `shopify_stock` senza `force`; con movimenti storici serve `add_to_non_product:true` che inserisce il codice in `non_product_codici` cosi' i detector non si accendono e le vendite passate tengono il COGS snapshot; MAI tocca `product_aliases`; audit `change_log` op `product_delete` con before completo. Primo caso reale, doppione `LEA_BAG_DARK_ZEBRA`, eseguito il 19-07 con effetto identico via migr `0052`).
- **Protezioni:** blocco MESI CHIUSI (anno/mese presente in `ce_snapshots` -> 409 `closed_month`, si supera solo con `force` + motivo; ECCEZIONE v15: `expense_approve` con edit di sola nota su spesa gia' approved passa, il CE non si muove — era il bug 'le spese non si confermano'); validazioni input (CODICE senza spazi, quantita' > 0); idempotenza `qromo_sale` su `sale_id`; ogni op scrive `change_log` con `chi` e source.
- **Tocca:** legge `app_config`, `v_inventory`, `products`, `supplier_orders`, `expenses`; scrive `purchases`, `counts`, `stock_adjustments`, `products`, `expenses`, `returns`, `qromo_sales`, `shopify_line_items` (solo sale_correct), `gifts_offline`, `b2b_movements`, `supplier_orders`, `change_log`.

## shopify-sync (v5) - pull ordini Shopify

- **Scopo:** ingest SOLA LETTURA degli ordini Shopify nuovi + aggiornamento rimborsi/stato.
- **Auth:** PIN. Token Shopify da `app_config.shopify_token` (Admin API 2024-01).
- **Azioni:** default = pull ordini nuovi (idempotente su order_id) + re-sync `refund_amount`/`financial_status`/`fulfillment_status` degli ordini aggiornati negli ultimi 45gg (mai gli importi/righe); `backfill_meta` = aggiorna `fulfilled_at` + `discount_codes` + `customer_name` (dal v5, feedback 06-07 item 9; eseguito il 06-07: 273 ordini aggiornati) su righe esistenti; `dryRun` = preview senza insert.
- **Resolver (dal 06-07):** alias esatto -> `codice_norm` -> nome base senza suffisso " - Senza/Con Catena" -> SKU; una riga che non risolve entra con codice NULL e la intercetta il detector `shopify_orphan`.
- **Note:** payment fees ~2.2% + 0,25 EUR stimate sugli ordini live (i mesi storici da seed sono al centesimo); errori per-item raccolti e ritornati (max 5), mai silenzio.
- **Limite noto (06-07):** 179 ordini della replica (16-feb -> 07-mag) sono del VECCHIO store e non esistono sull'API dello store attuale: per quelli `customer_name` non e' recuperabile via Shopify (eventuale fonte: DB Shopify del Foglio Master legacy).

## shopify-stock (v12) - giacenze e push stock

- **Scopo:** specchio giacenze Shopify (`shopify_stock`) + push dello stock reale verso Shopify.
- **Auth:** PIN. Token Shopify da `app_config`.
- **Azioni:** `sync` (default, pull di tutti i prodotti/varianti: SKU -> codice via alias + codice_norm + fallback SKU; gestisce i dual-variant SC/CC = un codice, piu' `inventory_item_ids`; dal v10 salva anche `shopify_status` e quando PIU' prodotti Shopify mappano allo stesso codice titolo/immagine/status vengono dal migliore: attivo batte bozza, SKU esatto batte alias — fix immagine Savana/Leopardo, feedback 06-07 item 19); `realign_all` (autopush cron :27, gated `app_flags.shopify_autopush_enabled`; target = disponibili da vendere - buffer, oggi buffer 0; hold rialzi senza conta fresca <=30gg se `shopify_hold_raises='true'`; `dryRun` disponibile); `realign` (push manuale per codici scelti, gated `app_flags.shopify_write_enabled`, logga `chi`); `sync_now` (**dal v12**, brief 17-07: giro orario completo on-demand = `sync` -> `realign_all`, stesso codice dei cron via helper `doSync`/`doRealignAll`; il pulsante "Sincronizza Shopify adesso" nella tab Shopify dell'Inventario lo invoca con `chi`; audit `change_log` op `stock_sync_now`; **cooldown server-side 45s** anti doppio-click, superabile con `force:true`; se il pull Shopify fallisce il giro ABORTA senza riallineare su mirror stantio; flag sovrani invariati — con autopush spento il realign viene saltato e il client lo segnala).
- **Protezioni:** SKU non mappati MAI toccati (azzerarli nasconderebbe un prodotto live); push falliti VERI NON mascherati (ritornati come `failedCodici` + `health_log` chiave `stock_autopush` severity 'warn'); location da `app_flags.shopify_location_id`.
- **Untracked (dal v11):** un set fallisce anche quando l'`inventoryItem.tracked=false` (Shopify rifiuta la scrittura stock su un item non tracciato): NON e' un guasto, e' assenza di tracking magazzino. In `realign_all` un set fallito viene diagnosticato via GraphQL (`inventoryItem.tracked` + `variant.product.isGiftCard`, endpoint `2024-01/graphql.json`, stesso token): se untracked e non gift card finisce nel bucket **`untracked`** (non `failed`), riportato a parte nel summary/health_log e senza alzare la severity (niente warn perenne). Dietro flag `shopify_autoenable_tracking` (default off) l'autopush riaccende il tracking (`inventoryItemUpdate(tracked:true)`) e ritenta, **MAI su gift card**. `change_log` `stock_autopush` ora si scrive anche nei run con soli fallimenti/untracked. (Brief 08-07; caso reale `AGATA_BAG_PINK_CRYSTAL_BEADS` risolto a mano prima del deploy. Le 3 `GIFT CARD Amimì` restano `tracked:false` by design ma senza SKU non entrano in `shopify_stock`.)

## qromo-webhook (v5) - ricevitore vendite POS

- **Dal v5 (06-07):** se il payload Qromo porta un cliente (customer/client/customer_name), nome e cognome finiscono in `qromo_sales.nome/cognome`; le vendite POS restano di norma anonime.
- **Scopo:** riceve la vendita dalla console Qromo (webhook "Amimi App Supabase") e la scrive in `qromo_sales` (source `qromo-direct`). LIVE dal cutover 2026-07-03.
- **Auth (tripla, senza PIN):** `?key=` nell'URL, oppure `body.auth` = secret, oppure token Qromo in `app_flags.qromo_webhook_token`. Valori in `app_flags`, mai nei doc.
- **Comportamento:** POST only (GET risponde `online`); estrae l'ordine da body.order/data.order/payload.order; un record per item con paid=true; `sale_id` = order_id + indice item (stabile); prezzo = PAGATO per unita'; COGS snapshot da `products` se risolto, altrimenti `resolver_status='unresolved'` con nome raw in nota (mai perso).
- **Protezioni:** idempotenza via UNIQUE parziale `qromo_sales_live_saleid_uq` (23505 = re-delivery benigna, skip); errore vero su un item -> risposta non-200 cosi' Qromo RITENTA; item senza flag paid = skip segnalato.

## ce-guard (v3) - guardiano contabile

- **Scopo:** sorveglianza del CE e della qualita' dati; esiti in `health_log` (chiavi `ce_*`), letti dal banner rosso in Home.
- **Auth:** PIN. Cron **ORARIO** (`30 * * * *`, migr 0051; era daily 06:30 fino al 2026-07-09).
- **Notifiche ntfy (v3, 2026-07-09):** al termine del `run`, se cambia l'insieme delle CHIAVI dei problemi **error** (non i conteggi), pubblica una push sul topic ntfy del titolare (`https://ntfy.sh`, JSON, tag `warning`/`white_check_mark`, click alla app). "Solo su cambio" -> niente spam orario. Il topic vive in `app_flags.ntfy_topic` (service-role; se assente -> no-op); lo stato ultimo-notificato in `app_flags.ceguard_alert_state`. Le WARN (cogs mancanti, spese da verificare) NON notificano.
- **Azioni:** `run` (default) = 10 check: invarianti MC1/MC2 (tolleranza 0,02 EUR), `ce_qromo_unresolved`, `ce_cogs_mancanti` (warn), `ce_giacenze_negative`, `ce_expenses_categoria`, `ce_expenses_da_verificare` (warn), `ce_drift_mesi_chiusi` (da `v_ce_drift`, etichetta con netto E mc2), `ce_shopify_reconcile` (conteggio ordini API vs DB, mese corrente + precedente), `ce_shopify_token`, `ce_sync_freshness` (warn se `shopify_stock.synced_at` > 120 min). `close_month` (year, month, chi) = congela il CE del mese in `ce_snapshots` (UNIQUE, mai sovrascrive) + `change_log`. `status` = health_log `ce_*` di oggi.
- **Nota:** cancella e riscrive SOLO le chiavi `ce_*` di oggi (le altre sono di `refresh_health_log()`).

## ask-data (v4) - NL -> SQL

- **Scopo:** "Chiedi ai dati" del Cruscotto: Gemini (`gemini-flash-lite-latest`, temperature 0) genera una SELECT sullo schema esposto, eseguita da `ask_select` (SECURITY DEFINER: solo SELECT, singolo statement, max 200 righe, timeout 5s).
- **Auth:** PIN. Key Gemini in `app_flags.gemini_api_key` (se assente risponde `needs_key`).
- **Dal 06-07:** interroga `v_ce_totale` live (non piu' la copia storica).
- **APERTO (audit A1):** `ask_select` non ha allowlist di viste e ask-data e' pubblica: via di esfiltrazione segreti finche' l'owner non ruota i segreti e si chiude la falla.

## mcp (v4) - server MCP per Claude

- **Scopo:** pilotare l'app da Claude (JSON-RPC 2.0, supporto SSE).
- **Auth:** tool read APERTI (`list_inventory`, `what_to_reorder`, `sku_availability`, `pnl_summary`, `ads_summary`, `ask_data`); tool write (`propose_expense`, `register_count`) dietro `Authorization: Bearer` = `app_flags.mcp_token`, delegati alla write-api con `chi='Claude-MCP'`.

## cs-sync (v1) - tool assistenza clienti, FASE 0 (solo diagnostica)

- **Scopo:** fondamenta del tool assistenza clienti (design: `Cowork12/projects/Servizio_Clienti_2026-06/DESIGN_Tool_Assistenza_Amimi_V1_2026-07-20.md`). La v1 e' SOLO diagnostica: zero scritture DB, zero tabelle `cs_*` (arrivano in Fase 1).
- **Auth:** PIN. Chiave service account Google in `app_flags.cs_gmail_sa_key` (service-role only): se assente risponde `needs_key` (pattern ask-data), si inserisce DOPO senza redeploy.
- **Azioni:** `ping` = con chiave assente `{ok:false, needs_key:true}`; con chiave presente fa OAuth 2.0 JWT grant (RS256, impersonazione `info@amimi.it`, scope `gmail.readonly`) + `messages.list` (maxResults=1) + `messages.get` (format=metadata) e ritorna `{ok:true, subject, from, date}` dell'ultimo messaggio della casella (NIENTE body, NIENTE log del contenuto). `status` (default) = `{cs_enabled, key_present (boolean), last_history_id}` senza mai esporre i valori dei segreti.
- **Caveat Fase 0 (da chiudere in Fase 1):** il PIN e' neutralizzato (`x`), quindi quando la chiave SA sara' inserita `ping` esporra' subject/from/date dell'ultimo messaggio a chiunque conosca l'URL. Accettabile finche' e' solo metadata di diagnostica; dalla Fase 1 le letture del tool passano dietro JWT Supabase Auth (utenti @amimi.it, signup OFF).
- **Accessi (fatti col co-pilota browser il 21-07):** signup pubbliche SPENTE (toggle dashboard, verificato `disable_signup:true` + `POST /auth/v1/signup` -> 422 `signup_disabled`); utenti Supabase Auth creati per `info@amimi.it` e `support@amimi.it` (auto-confirm, password digitate SOLO dall'owner, mai transitate da AI). Login = solo cancello: l'identita' Benny/Ginni vive nel selettore del tool (design 3.4).
- **Prerequisito esterno residuo (owner):** service account GCP con domain-wide delegation su `info@amimi.it` (sessione Cowork guidata a parte); la chiave JSON va poi in `cs_gmail_sa_key` via SQL editor dashboard, quindi `ping` deve tornare l'ultimo messaggio reale (criterio 2 Fase 0).

## etl-load (v4) - RITIRATA

- Stub che risponde 410 Gone: era il loader one-off del re-seed 2026-07-01. Nessuna azione. Candidata alla cancellazione.

## Flag e config di riferimento

- `app_config`: `pin_hash`, `shopify_token`, `iva_rate` (0.22), `parity_tolerance_cents`.
- `app_flags`: `shopify_write_enabled`, `shopify_autopush_enabled`, `shopify_expose_buffer` (oggi 0), `shopify_hold_raises`, `shopify_autoenable_tracking` (default off: riaccende il tracking magazzino su item fisici untracked prima del set, mai gift card, dal v11), `shopify_location_id`, `qromo_webhook_secret`, `qromo_webhook_token`, `gemini_api_key`, `mcp_token`. Entrambe le tabelle sono service-role only (lockdown migr 0026); i flag si cambiano SOLO con decisione owner (Regola 15/16).
- Chiavi `cs_*` (tool assistenza, dal 2026-07-20, Fase 0): `cs_enabled` ('false' = sync spento), `cs_last_history_id` (cursore Gmail, vuoto), `cs_gmail_sa_key` (chiave JSON service account, vuota finche' l'owner non la inserisce via canale sicuro), `cs_ntfy_topic_benny` / `cs_ntfy_topic_ginevra` / `cs_ntfy_topic_ale` (topic ntfy con suffisso random generato direttamente nel DB: i valori NON sono mai transitati in repo, doc o chat e sono da trattare come segreti). Inserite via SQL one-off, NON via migrazione (repo pubblico).
