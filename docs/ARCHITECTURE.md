# Amimì App — Architettura (as-built, 2026-06-25; aggiornata 2026-07-06)

> # STATO REALE VERIFICATO IL 2026-07-31 - LEGGI QUESTO PRIMA DEL RESTO
>
> **Questo file e' rimasto indietro.** Le sezioni 5, 6, 7 e 9 qui sotto fotografano il 6 luglio 2026 e non descrivono piu' il sistema: mancano il tool Assistenza clienti, la loyalty Premia, l'assistente AI in-app e activity-digest. **Finche' non vengono riscritte fa fede questo blocco.** Le fonti aggiornate e affidabili sono `SCHEMA.md` (schema dati) e `EDGE_FUNCTIONS.md` (dettaglio per function).
> Verifica fatta da Cowork in sola lettura (`list_edge_functions`, `cron.job`, `cron.job_run_details`, `information_schema`) durante la ricerca software PMI del 31-07-2026.
>
> ### Edge functions: **17 attive**, non 8
> `write-api`, `shopify-sync`, `shopify-stock`, `qromo-webhook`, `ce-guard`, `ask-data`, `mcp`, `etl-load` (ritirata, risponde 410) - le 8 gia' documentate - piu' le **9 mai entrate in questo file**: `cs-sync`, `cs-classify`, `cs-api`, `cs-assist` (tool Assistenza clienti), `loyalty-proxy` e `loyalty-proxy-smoke` (Premia/Mimi), `assistant` e `corpus-load` (assistente AI in-app "Chiedi ad Amimi"), `activity-digest`.
> **ATTENZIONE al numero di versione:** il campo `version` di `list_edge_functions` e' un **contatore di deploy**, NON la numerazione `vN` scritta nei commenti in testa al codice e in `EDGE_FUNCTIONS.md`. I due numeri coincidono solo per coincidenza. Esempio verificato il 31-07: `cs-assist` risulta `version: 11` su Supabase mentre il sorgente e' `v13`. **Non trattare mai uno scarto fra i due come codice non deployato**: si verifica cercando le feature nel sorgente deployato, non confrontando numeri.
>
> ### Cron: **8 job attivi**, non 5
> Ai 5 documentati (`shopify-sync-hourly` :07, `shopify-stock-hourly` :17, `shopify-autopush-hourly` :27, `health-daily`, `ce-guard-daily`) si aggiungono i 3 del tool Assistenza: **`cs-sync-poll` `*/2`**, **`cs-classify` `*/5`**, **`cs-assist-summary` `*/7`** (tutti NO-OP se `app_flags.cs_enabled != 'true'`).
> **`ce-guard-daily` NON e' giornaliero: gira OGNI ORA.** Schedule reale `30 * * * *`, verificato su `cron.job_run_details` (**21 run il 31-07**, dalle 02:30 alle 22:30, tutte riuscite). Non e' una scoperta nuova: Claude Code se n'era accorto il 29-07 e il **design delle chiavi `ce_*` di `ce-guard` dipende da questo** (la delete di fine run filtra `k like 'ce_%'`; con chiavi nude il secondo giro del giorno collideva sull'unique `health_log(day, k)` e spegneva la guardia in silenzio dalle 07:30). Quindi **il cron e' giusto e la documentazione e' sbagliata**: sia questo file sia `OPERATIONS.md` scrivono ancora `30 6 * * *`. Resta all'owner una sola decisione, di costo e non di correttezza: 21 giri al giorno significano 21 riconciliazioni contro l'API Shopify. Il nome del job (`-daily`) andrebbe cambiato, ma rinominarlo tocca pg_cron ed e' lavoro di Claude Code.
>
> ### Frontend: **7 tab montate** in `App.tsx`, non 6
> `home`, `cruscotto` (Report), `salute`, **`assistenza`**, `registra` (Ingest), **`ordini`**, `magazzino` (Inventory), piu' l'overlay `AssistantPanel` presente su ogni schermata (si auto-nasconde se `ai_enabled` e' false). In `pages/` esistono anche `Prodotti.tsx` e `Tables.tsx`, raggiunte dall'interno di altre tab e non montate direttamente in `App.tsx`.
>
> ### Dati: **36 tabelle + 29 viste**
> Rispetto alla sezione 3 mancano qui: le 5 `cs_*` (`cs_conversations`, `cs_messages`, `cs_events`, `cs_drafts`, `cs_faq`), `loyalty_points`, `loyalty_events`, `mimi_state`, `models`, `app_guides`. **Sono le uniche tabelle dell'app con RLS**: dettaglio e postura di sicurezza in `SCHEMA.md` sezione 7.
>
> ### "Live" non vuol dire "usato"
> Al 31-07-2026 **`b2b_movements` e `returns` hanno 0 righe**, pur essendo deployate e funzionanti da mesi; **263 conversazioni su 268 sono ferme in stato `da_fare`**. Questo file, come tutta la doc, descrive cosa e' costruito: non dice nulla su cosa venga effettivamente compilato. Prima di progettare sopra uno di questi moduli, controllare i conteggi di riga.


> AGGIORNAMENTO 2026-07-04 (post-cutover). Dal 2026-07-03 il sistema di record per vendite, stock, inventario e CE e' amimi-app (https://noobhandbag.github.io/amimi-app + Supabase imszbjeyplaiovylhkgl); il webhook Qromo punta alla edge function qromo-webhook e il Foglio Master non riceve piu' le vendite Qromo (resta semi-attivo fino al congelamento). Stato corrente: amimi-app/docs/TRIGGER_MIGRAZIONE.md.

> AGGIORNAMENTO 2026-07-06 (consolidamento doc + remediation audit di sistema, commit a758756/0b0385d/a3b0306). Le sezioni §5/§6/§9 sono state RISCRITTE allo stato corrente (versioni edge verificate live il 06-07). Novita' strutturali dalla remediation: write-api blocca le scritture nei mesi chiusi (`ce_snapshots`) senza force+motivo; UNIQUE parziale su `qromo_sales(sale_id)` (migr 0036); detector estesi in `v_health` + banner rosso in Home (migr 0035); merge duplicati `codice_norm` + UNIQUE e REVOKE TRUNCATE (migr 0037). Doc operativi nuovi: `OPERATIONS.md` (runbook), `EDGE_FUNCTIONS.md`, `SCHEMA.md`. Dettaglio remediation: `audits/AUDIT_SYSTEM_2026-07-06.md`.

Stato reale del sistema costruito, non il piano. Il piano iniziale vive in
`Cowork12/projects/Amimi_App_Rebuild/ARCHITECTURE.md`; questo file fotografa **ciò che è
deployato e live**. Aggiornare qui a ogni cambio strutturale.

## 1. Cos'è
Replica DB-backed del gestionale Amimì (oggi su Google Sheet + Apps Script), usabile da telefono.
Tesi: spostare la logica derivata (inventario, P&L) da formule fragili del foglio a **viste SQL**,
eliminando la classe di bug "fallimento silenzioso" (arrayformula che collassano, CE letto per
indice riga, casing dei CODICE).

## 2. Stack
- **DB:** Supabase Postgres — project `imszbjeyplaiovylhkgl` (org Caprotti, eu-central-1).
  URL `https://imszbjeyplaiovylhkgl.supabase.co`. anon/publishable key pubblica (sola lettura).
- **Logica derivata:** viste SQL + 1 funzione (`ask_select`).
- **Write path:** edge function `write-api` (Deno/TS), PIN-gated, scrive con service-role, logga su `change_log`.
- **Scheduling:** `pg_cron` (5 job attivi, vedi §6).
- **Sync esterni:** edge functions in sola lettura (Shopify live; Qromo/Meta da seed).
- **Frontend:** React 19 + Vite 8 + TS, PWA, mobile-first. Deploy su GitHub Pages
  (`NoobHandbag/amimi-app`, base `/amimi-app/`), live https://noobhandbag.github.io/amimi-app/.

## 3. Dati — tabelle (sorgenti)
`products` (anagrafica, +`verificato`/`is_finalized`), `purchases` (ACQUISTI), `counts` (conte),
`gifts_offline` (regali), `b2b_movements` (conto-vendita/wholesale), `returns` (resi & cambi),
`supplier_orders` (ordini fornitore multi-borsa, +`gruppo`), `qromo_sales` (vendite negozio),
`shopify_orders` + `shopify_line_items` (vendite online), `shopify_catalog` (cosa è su Shopify),
`shopify_stock` (giacenze Shopify, popolata da shopify-stock), `expenses` (EXPENSES MASTER,
+`status` per approvazione), `meta_ads_daily` (ads), `ce_totale_monthly` (CE_TOTALE da foglio,
include gennaio), `suppliers`, `negozi`, `product_aliases` (nome Shopify→CODICE),
`non_product_codici`, `app_config` (pin_hash, shopify_token — service-role), `app_flags`
(feature flag + gemini_api_key — service-role), `change_log` (audit di ogni scrittura),
`stock_adjustments` (rettifiche da conta fisica, migr 0027), `ce_totale_manual` (blocco manuale
storico del Totale, migr 0028), `ce_snapshots` (mesi chiusi congelati, migr 0032),
`health_log` (esiti dei guardiani: v_health + ce-guard + stock autopush, migr 0024).
Colonne **generate, mai scrivere**: `codice_norm` (ovunque), `products.is_finalized`,
`expenses.amimi`/`categoria_valid`, `purchases.costo_totale`, `b2b_movements.incasso_amimi`/
`quota_negozio`/`retail_tot`.

## 4. Dati — viste (logica derivata)
- `v_inventory` — giacenza = acquisti − shopify − qromo − regali + resi_rientrati; +B2B, disponibili,
  valore, last_sale, on_shopify.
- `v_ce_amimi` / `v_ce_amimi_summary` — P&L brand (parità col foglio Feb/Mar al centesimo, Apr/Mag ~1%;
  dal 06-07 la riga resi e' nettata /1.22, migr 0038).
- `v_ce_totale` / `v_ce_totale_summary` — **P&L intera attivita', DI RECORD per il Totale** (nativa da
  migr 0028): calcolata dai dati vivi + blocco manuale `ce_totale_manual` (seed storico non-Amimi:
  gennaio 2026 pre-Amimi, rettifiche feb). La tabella `ce_totale_monthly` (copia dal Foglio) resta solo
  come riferimento storico e NON alimenta piu' il Cruscotto.
- `v_ce_drift` (drift mesi chiusi vs `ce_snapshots`), `v_health` (14 detector qualita' dati, migr 0035),
  `v_stock_drift` (policy autopush Shopify), `v_expenses_review` (coda approvazione spese).
- `v_conto_vendita_negozio`, `v_ordini_arrivo`, `v_fornitore_prodotti` (borse per fornitore),
  `v_products_todo` (da verificare), `v_expenses_pending` (spese da approvare),
  `v_shopify_align` (disallineamenti app↔Shopify), `v_reorder` (riordino, velocità 60g),
  `v_sku_availability` (acquistabili / non-pubblicati / esauriti), `v_ads_mensile`, `v_resi_mensile`.

## 5. Edge functions (8 al 2026-07-06; versioni verificate live, dettaglio per function in `EDGE_FUNCTIONS.md`)
- **`write-api`** (v14, verify_jwt off) — UNICO path di scrittura. PIN-gated (sha256(pin)==app_config.pin_hash;
  pin neutralizzato a `x`). Azioni: purchase, count, gift, b2b, product, order, order_multi, arrival,
  arrival_set, product_verify, expense_manual/propose/approve, sale_correct, return, qromo_sale.
  Ogni scrittura → change_log. Dal 06-07 BLOCCA le scritture nei mesi presenti in `ce_snapshots`
  senza `force`+motivo (risposta 409). Il COGS e' editabile via product_verify (Registra > Prodotti & prezzi).
- **`shopify-sync`** (v7) — pull SOLA LETTURA dei nuovi ordini Shopify (idempotente su order_id);
  dal 06-07 fallback resolver nome/CODICE/suffisso/SKU e re-sync rimborsi/stato (finestra 45gg);
  dal 13-09 (incidente doppioni, migr 0117) letture controllate che FERMANO il giro se falliscono,
  upsert sul vincolo UNIQUE(order_id), tetto 50 ordini nuovi per giro, telemetria `shopify_sync`.
- **`shopify-stock`** (v9) — sync giacenze Shopify → `shopify_stock` + push stock: `realign` manuale
  (gated `shopify_write_enabled`) e `realign_all` autopush (cron :27, gated `shopify_autopush_enabled`).
  Policy "specchio del reale": target = disponibili da vendere, buffer 0, rialzi e ribassi liberi;
  hold "non alzare senza conta" opt-in via `shopify_hold_raises` (default off). SKU non mappati mai
  toccati; push falliti contati in health_log con severity.
- **`qromo-webhook`** (v4) — ricevitore diretto Qromo→Supabase, LIVE dal cutover 2026-07-03 (in console
  Qromo il webhook e' "Amimi App Supabase"). Auth tripla: `?key=` nell'URL, oppure `body.auth` = secret,
  oppure token Qromo in `app_flags.qromo_webhook_token`. Idempotente (UNIQUE parziale su sale_id,
  23505 = skip benigno); errore vero su un item → risposta non-200 cosi' Qromo ritenta.
  Vedi `qromo_webhook_cutover.md` e TRIGGER_MIGRAZIONE.md §4b.
- **`ce-guard`** (v2) — guardiano contabile daily 06:30: drift mesi chiusi (vs `ce_snapshots`, etichetta
  con netto E mc2), vendite unresolved, COGS mancanti, giacenze negative, categorie spese, spese da
  verificare, riconciliazione ordini vs Shopify, token Shopify e freschezza sync. Esito in `health_log`
  (banner rosso in Home se error/warn). Azione `close_month` congela un mese in `ce_snapshots`.
- **`ask-data`** (v4) — NL→SQL: Gemini (`gemini-flash-lite-latest`) genera l'SQL, eseguito da
  `ask_select` (SECURITY DEFINER, solo SELECT, una query, max 200 righe). Key in app_flags.
  Dal 06-07 legge `v_ce_totale` live.
- **`mcp`** (v4) — server MCP JSON-RPC per Claude: tool read aperti (inventario, riordino, disponibilita',
  P&L, ads, ask_data) + 2 write (propose_expense, register_count) dietro Bearer `app_flags.mcp_token`,
  delegati a write-api.
- **`etl-load`** (v4) — RITIRATA: stub che risponde 410, era il loader one-off del re-seed 2026-07-01.

## 6. Scheduling (pg_cron) — 5 job attivi (verificati live 2026-07-06)
- `shopify-sync-hourly` — `7 * * * *` → shopify-sync (ordini).
- `shopify-stock-hourly` — `17 * * * *` → shopify-stock action `sync` (pull giacenze).
- `shopify-autopush-hourly` — `27 * * * *` → shopify-stock action `realign_all` (push stock).
- `health-daily` — `0 6 * * *` → funzione DB `refresh_health_log()`.
- `ce-guard-daily` — `30 6 * * *` → ce-guard action `run`.

Fuori pg_cron: backup GitHub Actions daily 03:17 UTC e snapshot Drive 05-06 Roma (vedi §13).

## 7. Frontend (7 sezioni)
- **Cruscotto** (`Report.tsx`) — P&L Amimì/Totale con filtro mesi, trend per canale, "Chiedi ai dati"
  (FLOW 6), card Meta Ads (vecchia serie mensile a livello campagna, `v_ads_mensile`, ferma al 01-07: lo dichiara
  e rimanda alla tab Ads), calcolatore offerte B2B.
- **Ads** (`Ads.tsx`, tab `ads`, dal 18-09) — reportistica Meta a livello CREATIVITA' dalle viste
  `v_ads_creative_status`, `v_ads_weekly_account`, `v_ads_set_inventory` (alimentate dall'edge `ads-sync`, cron
  06:07 UTC): azioni proposte in testa, KPI 7 giorni con semafori CPA (target 45 / breakeven 76,70), settimane
  con delta, creativita' ordinabili (spesa, acquisti, CPA/ROAS solo se ci sono acquisti, CTR vs settimana
  precedente e vs 90g, frequency giornaliera, fatica, product set risolti/OOS, azione), product set vs inventario,
  "Dati al ..." con avviso se il cron non gira, "Pull ora" (invoca `ads-sync`). Raggiungibile da `#ads` e dal
  bottone nella card Meta Ads del Cruscotto (persona finance); NON e' nella nav ridotta (decisione 06-07).
- **Salute & Movimenti** (`Salute.tsx`, tab `salute`, dal 06-07) — sola lettura: polso vendite online+offline
  14gg vs 14 precedenti, movimenti fornitori/resi, catalogo Shopify + flag operativi, semaforo salute da
  `health_log`. Numeri da `v_movimenti_14gg` (stessa finestra del digest Cowork); flag da `v_ops_flags`.
  Raggiungibile dalla Home (tile per Ale/Bene + "Tutte le azioni"). Dal 08-07 include una **vista per persona**
  (selettore Ginevra=ordini / Benedetta=catalogo·resi·spese / Dan[=Ale]=sistema): ogni KPI e' cliccabile e apre
  un drill-down (liste da `v_digest_*`, migr 0045). Aggregati headline da `v_digest_persone`; conteggio migrazioni
  LIVE da `v_digest_versioni` (le versioni delle 8 edge function sono un riferimento statico in `Salute.tsx`,
  aggiornato al rilascio). Riconciliazioni sui numeri (brief 08-07): l'AOV mostrato e' quello ONLINE
  (lordo online/ordini) non `aov_lordo14`; "aperti da evadere" usa `unfulfilledRecent` (=~32, non 0: i 181
  `unfulfilled` sono pre-migrazione, esclusi).
- **Inserisci** (`Ingest.tsx`) — conta, acquisto, reso/cambio, regalo, B2B, nuovo prodotto, spesa.
- **In arrivo** (`Arrivi.tsx`) — ordini fornitore multi-borsa, arrivi parziali/totali.
- **Verifica** (`Verifica.tsx`) — dettagli prodotto, approvazione spese, correzione vendita, pubblica (gated).
- **Inventario** (`Inventory.tsx`) — Magazzino, Riordino, Disponibilità, Nei negozi, Shopify, Valore.
- **Villaggio** (`Villaggio.tsx`, tab `villaggio`, dal 16-10) — ordini e magazzino come isola 3D in stile
  FarmVille/Animal Crossing (three.js 0.169.0, chunk caricato solo aprendo la scheda). Una vista parallela, non un
  secondo modo di scrivere: LEGGE `v_ordini_arrivo` e `v_inventory` con `fetchOrdiniGruppi`/`fetchInventory`,
  SCRIVE solo con i componenti di Ordini, cosi' come sono: `ArrivoRow` (arrivi con le sue conferme, `arrival_set`, e
  "Elimina riga", `order_delete`) e `SupplierOrderForm` (ordine nuovo, `order_multi`, con la sua "Compila" AI se
  `ai_compila_enabled` e il login del team); con le Paillettes (sotto) anche `CountForm` di Magazzino (`count`, giro di
  conta) e le tre azioni nuove `villaggio_presenza`, `fornitore_verifica` e `villaggio_conta_completa`. Magazzino: una pedana per modello e una pila per variante (1 lastra = 2 pezzi, anello giallo
  1-2 pezzi, borsa trasparente = finita ma in arrivo, anello rosso = negativa). Laboratori: un capannone per
  fornitore con righe aperte (max 6 sull'isola, gli altri solo nei pannelli), un carrello per riga con la pila di
  quanto deve ancora arrivare, bandierina rossa se in ritardo. Lo "studio delle borse" (modello = sagoma,
  finitura = materiale, colore) e' in `web/src/lib/villaggio/catalogo.ts`, funzioni pure con alias per i nomi
  incoerenti fra ordini e magazzino; le righe d'ordine prendono l'aspetto dalla variante di magazzino con lo stesso
  codice. Ingressi: tile per Ale e Ginevra, "Tutte le azioni", `#villaggio`, bottone "Apri il Villaggio" nel
  Cruscotto, e app a se' `/amimi-app/villaggio/` (secondo ingresso Vite `web/villaggio/index.html`, logica in
  `VillaggioApp.tsx`, manifest proprio con `id` e `scope` `/amimi-app/villaggio/` e un'icona sua (il fienile sulla collina, nello stile della DA dashboard; scelta di Dan del 18-10): non si contende i link con l'app
  intera; installata, la Home apre l'app intera in una finestra sua). Chi scrive: nell'app intera si sceglie in Home e
  nel Villaggio si vede soltanto; nell'app a se' c'e' il menu "scrive" nell'HUD, salvato in `amimi_chi` (stesso valore
  dell'app intera nello stesso browser; su iPhone l'app installata ha uno storage suo). Dal 18-10 (fase 3) l'app a se'
  senza `amimi_chi` chiede la persona alla prima apertura (tre bottoni, una volta per telefono) invece di partire da
  Ginevra; installata, la sua Home apre l'app intera con `?chi=<persona>`, che `App.tsx` legge una volta (solo un nome di
  `PEOPLE`), salva in `amimi_chi` e toglie dall'indirizzo: su iPhone quella finestra ha uno storage suo e partirebbe da
  'Ale'. Il default dell'app intera per chi non arriva da li' resta 'Ale'.
  Interruttore `app_flags.villaggio_enabled` (migr 0162, vista `v_villaggio_settings`, SCHEMA.md sez. 17): a flag
  spento spariscono tile e bottone del Cruscotto, e `#villaggio` e l'app a se' dicono solo "non attivo". three.js e i font del villaggio (`@fontsource/fredoka`, `@fontsource/nunito`, niente
  Google Fonts) stanno nel chunk del Villaggio; `ErrorBoundary` intorno al chunk (un import fallito dopo un deploy
  mostra "Ricarica", non l'app bianca) e messaggio dedicato se manca il WebGL. Pannelli: `lib/backnav` (il gesto
  indietro chiude il pannello) ed Esc fuori dai campi; il modulo dell'ordine gia' toccato chiede conferma prima di
  chiudersi (X, Esc, indietro, Home, etichette, barra) e la mappa al passo 4 non lo chiude. Il ritardo usa SOLO
  `data_consegna` (in Ordini "Consegna prevista" mostra `data_consegna_display`, che senza data ricade sull'ultimo
  arrivo: le due viste possono dire cose diverse sulla stessa riga). Costo del disegno: le mesh ferme (staccionata,
  erba, sassi, decori, gusci di magazzino e capannoni) sono fuse per materiale (da ~1.250 a ~930 draw call: il resto
  sono pile e carrelli, che si ricostruiscono), le ombre si ricalcolano solo quando si muove
  un oggetto, e dopo 20 s senza tocchi ne' dati nuovi l'isola va a riposo e non ridisegna piu'. Il modello dai dati
  (`costruisci`, `arriviFra`) e' in `catalogo.ts`, provato da `tests/villaggio_catalogo.mjs`; e2e in
  `web/e2e/villaggio.spec.ts` (progetto finto, sempre con il percorso della spec). Dal 18-10 li esegue anche la CI
  (`amimi-app-tests.yml`, Gate 1 automatica, amimi-app #83).
  **Paillettes** (fase 2, dal 16-10, migr 0164, SCHEMA.md sez. 17): la gamification del Villaggio. Gioca solo la
  giocatrice (`app_flags.villaggio_paillettes_chi`, oggi Ginevra); interruttore `villaggio_paillettes_enabled`, nato
  'false': spento non c'e' niente di questa fase (pillola, stella, bottoni, presenza, letture degli eventi). Si parte da
  zero: `villaggio_paillettes_dal` (da quando la vista conta gli eventi) al go-live e' il giorno in cui si accende il flag
  (Dan 17-10), quindi niente storico regalato. App e VillaggioApp leggono tutte le chiavi con `fetchVillaggioSettings`
  (paillettes e dal grezzi, senza trim, come li confrontano la write-api e la vista) e passano alla pagina `paillettes` e
  `giocatrice`. I punti NON si scrivono: a ogni `load()` la pagina rilegge `v_villaggio_eventi` (`fetchVillaggioEventi`,
  a pagine) e li ricalcola con le funzioni pure di `web/src/lib/villaggio/paillettes.ts` (`calcola(eventi, oggi)`,
  `missioni`, `differenza`, tetti contro le ripetizioni, 7 livelli da Stagista a Executive Queen of Fashion Production).
  La lettura degli eventi parte con quella di ordini e magazzino ma si aspetta dopo: HUD, carrelli e pannelli non attendono
  le sue pagine; un suo errore lascia il punteggio dell'ultima lettura buona, mai zero. Dopo ogni lettura la differenza
  col prima: "+n" dorato su Ginni e toast (accodato al messaggio dell'azione, largo quanto il testo), medaglia nuova =
  toast. Festa del livello (scintille `Mondo.festa`, fumetto "Sei diventata ...!"): l'ultimo livello festeggiato sta sul
  telefono (`amimi_paillettes_livello`); si festeggia solo un livello piu' alto di quello, anche se preso fuori dal
  Villaggio (quindi anche alla prima lettura), e al primo avvio assoluto si prende nota del livello senza festa. Il premio
  sull'isola (`Mondo.setLivello`: aiuole, fontana, lampioni, chiosco, mongolfiera, corona e tappeto rosso) segue il
  livello di Ginni per tutti. HUD: pillola "1.240 · Coordinator" con la barra del livello (tocco = pannello percorso:
  scala dei livelli, oggi, serie e pallini lun-ven, medaglie, ultime 15 voci, come si guadagnano) e la stella delle
  missioni col numero di quelle da fare (al massimo 3: verifica del laboratorio piu' in ritardo, conta dei negativi, date
  mancanti, dal 20 del mese la conta completa; Ginni le presenta alla prima presenza del giorno). I negativi della
  missione sono quelli della prima lettura del giorno (`amimi_paillettes_negativi`, per data): contati, la missione resta
  e si vede fatta, anche riaprendo. Le tre sole scritture nuove passano dalla write-api (v29): `segnaPresenza` (una al
  giorno, guardia `amimi_villaggio_presenza` sul telefono e una sola POST in volo, server idempotente; parte dopo la
  prima lettura), `verificaFornitore` (pannello del laboratorio con fornitore, "Verifica con ...": una riga per riga
  aperta con interruttore "confermata" e data di consegna, evidenziata se manca, piu' una nota; un campo data svuotato su
  una riga che la data l'aveva la lascia com'e', perche' la verifica mette o corregge, non toglie; bottone spento mentre
  salva, poi si torna al laboratorio; se una rilettura fa sparire il laboratorio di una verifica toccata, il pannello si
  chiude con un avviso) e `registraContaCompleta`. Giro di conta (dal Magazzino "Giro di conta completo": tutti i codici
  con giacenza diversa da 0, negativi, poi pila per pila, poi i modelli non disegnati; o dalle missioni: i negativi, o la
  conta completa del mese): camera sulla pila (`focusPila` ricorda la vista e chiudendo il giro torna quella di prima),
  `CountForm` di Magazzino col codice gia' scelto, contato si passa al prossimo (`onDone`), "Salta" o "Avanti" se gia'
  contato oggi, barra "2 / 98". La conta completa e' REGISTRATA, non calcolata: in fondo al giro completo la giocatrice
  preme "Registra la conta completa di <mese>" (bottone spento mentre salva; "gia' registrata" se l'evento del mese
  c'e'), write-api `villaggio_conta_completa` `{codici}` (i codici del giro con una conta di oggi), una riga in
  `vil_conte_complete` (PK chi + mese di Roma): +500 una volta al mese; le singole conte restano +2 per codice al giorno.
  Verifica e giro toccati hanno la stessa guardia del modulo dell'ordine (conferma prima di X, Esc, indietro, Home,
  etichette, barra) e la mappa non li chiude. Chi non e' la giocatrice vede la pillola con le paillettes di Ginni e il
  percorso, senza presenza ne' missioni; verifica e giro restano a tutti (la riga porta il suo chi, i punti contano solo
  per la giocatrice), ma la registrazione della conta completa no. Prove: `tests/villaggio_paillettes.mjs` (logica pura)
  e `tests/paillettes_guardie.mjs` (write-api).
  **Fase 3** (18-10, migr 0167, write-api v30, scelte di Dan: proposte 1, 2, 3, 4, 7 e 8 della ricerca del 18-10).
  *Scheda della pila* (tocco su una pila nel mondo, `Mondo.ev.onPila`, o sulla sua tessera nel pannello Magazzino):
  foto vera (`v_inventory.image_url`, se no la miniatura 3D), i codici della pila con la giacenza (taglie separate),
  vendite degli ultimi 6 mesi a barre (`venditePerMese`) e le ultime 5 (negozio o online, senza nomi dei clienti), righe
  ancora in arrivo, ultimi arrivi (laboratorio, pezzi, costo) e ultime conte e rettifiche; ogni lettura
  (`fetchSalesByCodice`, `fetchPurchasesByCodice`, `fetchAdjustmentsByCodice`, per codice e poi unite) e' della scheda,
  che si rimonta per pila, e se lancia dice "Non riesco a leggere ...", mai "zero" (le tre letture guardano `error`;
  vendite fino a 300 righe per codice, perche' `created_at` di Shopify e' l'ora di import e con 40 si perdevano mesi). "Ordina ancora" apre il passo 4 di
  Ordina con il codice (`SupplierOrderForm` con `initialCodice`: fornitore e costo dall'ultimo acquisto; Ginni decide i
  riordini), "Conta" il giro di conta sui codici della pila. *Sta finendo* (niente punti, niente missione): `load()` legge
  `v_reorder` (`fetchReorder`) insieme a ordini e magazzino, `staFinendo()` di catalogo.ts (vende almeno 3 pezzi in 60
  giorni, meno di 30 giorni di stock, nessuna riga d'ordine viva, cioe' aperta e mossa negli ultimi 60 giorni (data d'ordine o ultimo arrivo, `data_ultimo_arrivo`); archiviati del Riordino fuori) da' codici e pile: le
  pile finite e senza arrivi, che il villaggio non disegna, si aggiungono a quelle da disegnare, poi
  `Mondo.setAvvisiPile` mette la bandierina arancio; chip "sta finendo" nella scheda e sulle tessere. Una lettura
  fallita del Riordino non ferma il villaggio, tiene l'ultima buona e si dice nel Magazzino e nella scheda della pila
  ("Non riesco a leggere i riordini ..."). *Verifica che sistema*: ogni riga ha "Non arriva
  piu'" con la conferma nella riga stessa (dice cosa succede: "La riga si chiude con i 4 pezzi gia' arrivati: gli altri 6
  non arrivano piu'"), mandata come `righe[].chiudi: true` solo sulle righe da chiudere; con piu' righe senza data, in
  cima "una data per tutte" le riempie (poi si corregge riga per riga). Il testo dice che la verifica vale le paillettes
  solo se sistema qualcosa, e il toast dice date aggiornate e righe chiuse (o, se la write-api in linea e' ancora la
  v29 e non risponde `righe_chiuse`, che le righe sono rimaste aperte). *Ritocchi per l'iPhone*: la riga d'arrivo del
  laboratorio mostra della `ArrivoRow` solo il modulo (intestazione e barra nascoste dal CSS sotto `.v-arrivo.solo`, in
  Ordini non cambia niente) e con una riga aperta il pannello sale al 90%; dopo un salvataggio (la rilettura mostra la
  riga cambiata) la riga si richiude. Con la tastiera aperta il pannello si appoggia sopra (`visualViewport`, classe
  `kb`, variabili `--v-kb` e `--v-vvh`) e porta in vista il blocco del campo. Bottoni da 44 px (Home, "?", X, "< Cambia
  ...", bottoni dei pannelli e della riga d'arrivo) e nessun testo sotto i 12 px nel Villaggio; campi a 16 px (Safari non
  ingrandisce); le stesse misure, solo sotto `.vil .v-form`, per i moduli di Ordini e Magazzino aperti nel Villaggio
  (passo 4 dell'ordine, giro di conta). Errori di rete in italiano: nel Villaggio "Sei senza rete o la rete non risponde",
  e `writeApi` di lib/api.ts traduce un fetch fallito per tutti i moduli ("Connessione interrotta: non so se e' stato
  salvato. Ricarica e controlla prima di riprovare": la connessione puo' cadere dopo l'invio), al posto di "Load failed". Primo
  avvio: dopo la presenza si rileggono solo gli eventi (`leggiEventi`, contatore suo), e i fumetti di Ginni in coda hanno
  "Salta". L'arrivo o la modifica scritti in una riga del laboratorio hanno la stessa guardia del modulo dell'ordine
  (`lascia()`: "Lasci la riga a meta'?", anche cambiando riga). *Isola che racconta*: `web/src/lib/villaggio/meteo.ts`
  calcola stagione (mese di Roma) e momento del giorno (sole vero di Milano) e legge il meteo di Milano da Open-Meteo
  (cache 30 minuti, errore = sereno, mai bloccante); la pagina chiama `Mondo.setAmbiente` all'apertura (subito, col meteo
  in cache), ogni 15 minuti a scheda visibile e al ritorno in primo piano. La camera dall'alto vede il mare e non il
  cielo, quindi il colore del momento lo porta anche il mare (`LUCI[momento].mare`): al tramonto rosato. Fumetti sopra
  l'etichetta del capannone, al centro (a sinistra del nome allargavano l'etichetta e a 375 px si coprivano; `updateLabels`
  conta il fumetto nell'ingombro e mette l'etichetta piu' lontana sopra il fumetto di quella davanti), dei laboratori con
  fornitore (`Mondo.setFumetti`): cuore se verificato negli ultimi 3 giorni (anche con le date ancora passate), se no
  punto di domanda per righe senza data, orologio per righe oltre la data; il tocco apre la verifica di quel laboratorio
  (a Paillettes spente il laboratorio). La legenda "?" spiega bandierina arancio e fumetti.
  *Prova sull'iPhone di Ginni* (la fa Dan, 15 minuti, chiude CASI_APERTI n.40 b): installare `/amimi-app/villaggio/`
  dalla Home di Safari e alla prima apertura scegliere Ginni; registrare una consegna di 3 righe da un laboratorio
  (la tastiera non copre "Segna arrivati", la riga si richiude da sola); aprire una pila dal Magazzino e provare "Conta"
  su un codice; una verifica con "Non arriva piu'" e "una data per tutte" (senza salvare se non serve); "Salta" sui
  fumetti del mattino; Home dell'HUD: l'app intera deve dire "Ginni" e non "Ale"; dopo 10 minuti con l'isola aperta,
  telefono caldo o no; alla fine chiedere a Ginni quali 2 o 3 idee di gioco le piacciono.

## 8. Sicurezza (posture rilassata, per scelta)
anon = sola lettura (grant revocati in scrittura; TRUNCATE revocato dal 06-07, migr 0037). Scritture
solo via `write-api` (PIN, service-role), che dal 06-07 blocca anche i mesi chiusi (`ce_snapshots`).
Segreti **mai nel bundle**: shopify_token in `app_config`, gemini_api_key in `app_flags` (entrambi
solo service-role). PIN neutralizzato a `x` di proposito. Scritture su Shopify dietro i flag
`shopify_write_enabled` / `shopify_autopush_enabled` (autopush ON dal 03-07). APERTO (owner):
rotazione segreti + chiusura esfiltrazione ask_select (audit A1/A2, vedi `audits/AUDIT_SYSTEM_2026-07-06.md`).

## 9. Integrazioni — stato reale
| Sistema | Stato nell'app |
|---|---|
| **Shopify** ordini | **LIVE** (shopify-sync, ogni ora, sola lettura) |
| **Shopify** giacenze | **LIVE automatico** (shopify-stock v9: cron :17 sync + :27 realign_all autopush; era on-demand/gated fino al 03-07) |
| **Qromo** vendite | **LIVE** via edge `qromo-webhook` v4 dal cutover 03-07 (il path Apps Script/Foglio e' rollback a secco; smoke test prima vendita reale ancora aperto al 06-07). Vedi §10 e TRIGGER_MIGRAZIONE.md §4b |
| **Meta Ads** | da seed (`meta_ads_daily`); nessun pull live |
| **Gemini** | live (ask-data) |
| **Google Sheet** | nessun sync automatico app↔foglio (app seedata una volta dal foglio) |

## 10. App vs Foglio — i due mondi e i ponti
> SUPERATO il 2026-07-03: l'app e' il sistema di record per vendite, stock, inventario e CE; il Foglio
> resta semi-attivo (Shopify DB Fetch, GA4) fino al congelamento e NON riceve piu' le vendite Qromo.
> Il resto della sezione vale come storico.

App e Foglio sono oggi **paralleli**. L'app è stata seedata dal foglio una volta; Shopify entra
nell'app in autonomia. Tutto il resto (Qromo, spese, regali, acquisti) nell'app è **fermo allo
snapshot**. Ponti previsti:
- **Qromo→app:** forwarder in `SyncImportToDBQromo` (Apps Script) che POSTa le righe risolte di
  DB_QROMO a `write-api` (azione `qromo_sale`). Tiene vivi sia foglio che app. *(in costruzione)*
  (SUPERATO il 2026-07-03: costruito e andato live, poi pensionato dal cutover; resta installato
  a secco come rollback.)
- **Cowork→app:** Cowork esegue Python/Node, quindi può leggere (REST anon) e scrivere (`write-api`,
  pin `x`) l'app via HTTP — niente auth Google. Helper: `integrations/cowork_amimi.py`.
- **Refresh dal foglio:** ricarica periodica di Qromo/spese/regali/acquisti da un export `(NN)` del
  Master (oggi manuale, vedi NIGHT_LOG).

## 11. Cosa manca / gated / da decidere
- Qromo live (ponte §10) — **da costruire/deployare**. (SUPERATO il 2026-07-03: Qromo e' live via
  edge `qromo-webhook`, non via ponte.)
- Realign Shopify e pubblica-prodotto: **gated** finché non si abilita `shopify_write_enabled`.
  (SUPERATO il 2026-07-03: realign automatico live via cron, policy specchio del reale.)
- Feature progettate non costruite (dipendono da feed esterni): triage servizio clienti, analytics
  ritiri in negozio. Vedi `FEATURE_BACKLOG.md`.
- Decisione strategica: l'app sostituisce il Foglio? In tal caso migrare i task Cowold sheet-bound a
  pg_cron + edge functions (vedi NIGHT_LOG / questa §).

## 12. Deploy & test
- Frontend: `npm run build` in `web/` → `npx gh-pages -d dist`.
- Edge functions: via Supabase MCP `deploy_edge_function` (no CLI link). Migrazioni in `supabase/migrations/`.
- Test: `node tests/flows.mjs` (34 API checks), `node tests/features.mjs` (15 logica+viste),
  `npx playwright test` in `web/` (9 E2E). 58 check totali, tutti verdi al 2026-06-25.

## 13. Backup (aggiunto 2026-07-04)
- **GitHub Actions `db-backup.yml`**: daily 03:17 UTC, dump JSON del DB come artifact (retention 90gg),
  pensato per il restore.
- **Apps Script "Amimi App Snapshot Drive"** (dal 2026-07-04): daily 05-06 Roma, scrive un Google Sheet
  datato nella cartella Drive "Amimi App Snapshots" (24 fonti + tab RIEPILOGO), retention 30gg,
  mail a info@amimi.it su errore, trigger self-healing, rilancio manuale via `/exec?k=`.
  Sorgente: `amimi-app/scripts/appsscript-snapshot/`.
- **Dump completo cifrato** (dall'11-10-2026): ogni notte `db-backup.yml` fa anche `supabase db dump`
  dei dati di TUTTE le tabelle (public, auth, storage; esclusa solo `app_config`, che tiene pin_hash e
  shopify_token), piu' ruoli, struttura e storico migrazioni, e lo cifra (gpg AES256, secret
  `BACKUP_PASSPHRASE`) perche' il repo e' pubblico. Nessun elenco di tabelle da tenere aggiornato: la
  guardia `scripts/backup-full-check.mjs` manda in rosso la Action se una tabella `public` dello schema
  manca nel dump. La passphrase vive fuori da GitHub (l'owner la custodisce): senza, il dump non si apre.
- **Archivio mensile permanente** (dal 2026-08-01, rifatto l'11-10-2026): Release `backup-AAAA-MM`, che non
  scade, con due asset: `amimi-backup-AAAA-MM.tar.gz` (24 tabelle JSON + `schema.sql`, in chiaro) e
  `amimi-backup-AAAA-MM-full.tar.gz.gpg` (dump completo). La crea il primo run riuscito del mese (prima:
  solo il run del giorno 01); un asset gia' pubblicato non si sovrascrive mai. Presenti: `backup-2026-08`,
  `-09`, `-10` (ottobre: JSON del 01-10, dump completo dell'11-10).
- **Copia mensile su Drive** (dall'11-10-2026; script pushato via clasp e provato la sera stessa: agosto, settembre e ottobre sono in Drive):
  lo snapshot Drive copia i due asset del mese in "Amimi App Snapshots/Mensili (permanenti)" (ricontrolla
  gli ultimi 3 mesi a ogni run, mail dal giorno 3 se manca il mese corrente) e tiene per sempre il primo
  foglio di ogni mese. Test: `node tests/snapshot_drive_mensile.mjs`.
- **Prova di restore (11-10-2026, superata):** archivio di ottobre scaricato, decifrato e applicato a un
  Postgres Supabase 17 vuoto in Docker: 74 tabelle, 70 viste, 25 funzioni `public`; righe identiche al live
  su products 203, purchases 322, shopify_orders 885, expenses 440, qromo_sales 256. Restano errori solo
  dove l'immagine nuda non ha i servizi Supabase (23 policy su `auth.jwt()`, 8 tabelle auth/storage): in un
  progetto Supabase nuovo esistono gia'. Procedura in `OPERATIONS.md`.
