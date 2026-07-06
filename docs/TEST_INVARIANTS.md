# Catalogo invarianti e mappa di copertura (post-audit 2026-07-06)

> Scritto 2026-07-06 da Claude Code su richiesta owner. Ogni invariante e' una proprieta' del
> sistema che deve restare vera; e' mappata sul reperto dell'audit (`audits/AUDIT_SYSTEM_2026-07-06.md`)
> che ne ha mostrato la violazione o il rischio. Scopo: (a) sapere in ogni momento CHI difende ogni
> invariante (vincolo DB, write-api, guardia quotidiana, test); (b) essere la lista dei test di
> regressione da costruire quando nasce l'ambiente di test isolato (design separato, da fare).
> Stato remediation di riferimento: header dell'audit, aggiornato 06-07 sera.

## Legenda colonne

- **DB**: vincolo/struttura Postgres che rende la violazione impossibile (la difesa piu' forte).
- **Runtime**: check nel write path (write-api / edge) che rifiuta o corregge al volo.
- **Guardia**: detector quotidiano (`v_health` via health-daily, `ce-guard` 06:30, guardia backup)
  che rende la violazione VISIBILE se accade comunque.
- **Test**: regressione automatica in `tests/` (oggi `flows.mjs` + `features.mjs`, girano contro il
  DB LIVE con marker ZZZTEST; l'ambiente isolato non esiste ancora).
- Stato: `OK` difeso, `DET` solo rilevato (non impedito), `APERTO` scoperto, `OWNER` attende azione
  dell'owner, `GAP` mai verificato.

## 1. STOCK (la giacenza dice il vero)

| ID | Invariante | Origine | DB | Runtime | Guardia | Test | Stato |
|---|---|---|---|---|---|---|---|
| S1 | Nessuna giacenza negativa | audit (verde) | - | - | v_health `stock_neg` | - | OK/DET |
| S2 | Ogni riga Shopify ha codice risolto (o allarme): una riga orfana incassa senza scalare stock | A5, C25 | - | shopify-sync v4: fallback resolver SKU/codice_norm | detector `shopify_orphan` (0035) | da scrivere: riga con nome ignoto resta orfana MA rilevata | OK |
| S3 | Ogni vendita Qromo mappa a `products` o alla whitelist `non_product_codici` | A8 | - | fallback COGS/resolve in write-api e webhook | detector `qromo_orphan` sulla condizione reale (codice non in products) | da scrivere | DET + OWNER (2 prodotti da creare: Agata_Bag_Beads_Pink, Lola Bag Orange) |
| S4 | Un cambio merce scala il sostituto (reso rientra, rimpiazzo esce) | A9 | - | write-api (dal v14): `stock_adjustments` -qty su `sostituito_con` | - | da scrivere (flow return con sostituto + verifica v_inventory) | OK |
| S5 | Le conte convergono: ri-contare non accumula delta | by-design count | - | delta ricalcolato server-side su giacenza live | - | parziale in `flows.mjs` (small/big delta) | OK (sequenziale); concorrente vedi G1 |
| S6 | Dopo un arrivo, stock e riga ordine sono coerenti (il purchase esiste sse qty_arrived cresce) | B16 | previsto: `purchases.order_id` + ricalcolo | previsto: inversione insert-poi-update | - | da scrivere (replay + crash simulato) | APERTO, design in `DESIGN_IDEMPOTENZA_WRITE_API.md` §4.5 |
| S7 | Un solo writer dello stock Shopify, gate `shopify_write_enabled`/`autopush` rispettati | Regola Ferrea 15 | - | flag check in shopify-stock | `stock_autopush` in health_log con severity reale (v9, B19) | da scrivere: push fallito produce severity != ok | OK |
| S8 | Un push stock fallito non resta verde ne' si ri-emette per sempre identico | B19, C32 | - | v9: contatore failed + severity | health_log | da scrivere | OK (autopush); C32 (endpoint `realign` risponde ok anche su fallimenti parziali) APERTO, basso: export frontend morto |

## 2. CE (il P&L dice il vero e i mesi chiusi restano chiusi)

| ID | Invariante | Origine | DB | Runtime | Guardia | Test | Stato |
|---|---|---|---|---|---|---|---|
| C1 | Nessuna scrittura datata in un mese chiuso senza force esplicito | A3 | `ce_snapshots` (0032) | write-api (dal v14, live v16): 409 su tutte le vie datate (verificato live) | `v_ce_drift` + ce-guard | da scrivere: ogni azione datata in mese chiuso prende 409; con force passa | OK |
| C2 | Un drift di mese chiuso e' etichettato col delta vero (mc2, non solo netto) | A4 | - | - | ce-guard v2 | - | OK |
| C3 | Ogni riga venduta ha un COGS snapshot | C24, A5 | - | fallback COGS in qromo-webhook/write-api/shopify-sync | detector `cogs_missing` esteso | da scrivere | OK/DET |
| C4 | Ricavi e resi nel CE sono al NETTO IVA (/1.22) | C23 | - | viste (migr 0038 per i resi) | - | da scrivere: assertion su v_ce_amimi con fixture nota | PARZIALE: /1.22 fatto; storno COGS del reso rientrato NON implementato (latente, 0 resi live) |
| C5 | `year`/`month` == extract da `data` su ogni tabella vendite/spese | B18, C31 | previsto: colonne GENERATED (proposta audit, non fatta) | derivazione server-side (expenses si', gift/b2b ancora client-side: C31) | detector `period_mismatch` (0035) | da scrivere | DET + OWNER (restatement 4 righe giu/apr + ri-chiusura) |
| C6 | Una sola fonte del CE: ask-data, Cruscotto e report leggono la stessa vista | B20 | - | ask-data v4 su `v_ce_totale` | - | da scrivere: confronto ask-data vs v_ce_totale su un mese | OK |
| C7 | Rimborsi/modifiche ordini post-ingest arrivano nel CE | A7 | - | shopify-sync v4: re-sync rimborsi | ce-guard riconcilia i CONTEGGI; riconciliazione a IMPORTO non ancora | da scrivere quando c'e' l'ambiente (serve mock Shopify) | OK runtime, guardia PARZIALE |
| C8 | Il restatement di un mese chiuso passa da correzione + RI-chiusura esplicita | A3/B18 | - | force + ce_snapshots | v_ce_drift mostra il delta finche' non ri-chiuso | - | OWNER (giu/apr da correggere e ri-chiudere) |

## 3. DEDUP / IDEMPOTENZA (ogni evento conta una volta sola)

| ID | Invariante | Origine | DB | Runtime | Guardia | Test | Stato |
|---|---|---|---|---|---|---|---|
| D1 | Un `sale_id` Qromo vive una sola volta sulle vie live | A6, B14 | UNIQUE parziale `qromo_sales_live_saleid_uq` (0036) | webhook v4 + write-api gestiscono il 23505 | - | da scrivere: doppia delivery stesso sale_id -> 1 riga | OK |
| D2 | Webhook diretto e forwarder non doppiano la stessa vendita | A6 | stesso UNIQUE (copre entrambe le source live) | - | proposta audit: check ce-guard su (data,codice,prezzo,qty) ravvicinate, non fatta | da scrivere | OK (DB), guardia APERTA |
| D3 | Ogni azione write-api con effetto soldi/stock e' replay-safe (`op_id`) | B13 | previsto: UNIQUE parziali op_id | previsto: lookup precoce + 23505 -> duplicate | - | da scrivere: per OGNI azione, stesso op_id x2 -> 1 riga + `duplicate:true` | APERTO, design in `DESIGN_IDEMPOTENZA_WRITE_API.md` |
| D4 | Ordini Shopify idempotenti su order_id | by-design | - | shopify-sync skip existing | - | - | OK (ma vedi C7 per gli update) |
| D5 | Un replay ripara i parziali (reso senza adjustment, arrivo senza update) | B13/B16 | - | previsto (design §4.3/§4.5) | - | da scrivere: crash simulato tra le due scritture, replay completa | APERTO (stesso design) |

## 4. ANAGRAFICA / RESOLVE (la join key regge)

| ID | Invariante | Origine | DB | Runtime | Guardia | Test | Stato |
|---|---|---|---|---|---|---|---|
| R1 | Ogni alias punta a un prodotto esistente | B12 | - | previsto dall'audit: resolved solo se esiste | detector `sales_orphan`/`dup_codice` | da scrivere | OK (dedup fatto 0037), enforcement runtime da verificare in implementazione |
| R2 | `codice_norm` unico in products | B12 | UNIQUE (0037) | - | detector `dup_codice` | - | OK |
| R3 | Un CODICE non finalizzato (termina `_`) non si carica | Regola Ferrea 4 | GENERATED `is_finalized` | validate() write-api | v_products_todo | in `flows.mjs` (validazioni) | OK |
| R4 | La rinomina codice alla verifica cascata su TUTTE le tabelle transazionali | product_verify | - | cascata su 8 tabelle in write-api | - | da scrivere: verify con rinomina -> nessuna riga orfana residua | OK runtime, test mancante |

## 5. OSSERVABILITA' (i guardiani sono vivi e raggiungono un umano)

| ID | Invariante | Origine | DB | Runtime | Guardia | Test | Stato |
|---|---|---|---|---|---|---|---|
| O1 | ce-guard vivo ogni giorno: chiavi `ce_*` di oggi presenti | B22 | - | - | freshness per-famiglia (ce-guard v2) | - | OK |
| O2 | La liveness dei cron non si deduce da `cron.job_run_details` | A10 | - | - | detector freschezza `max(synced_at)` + token check | - | OK |
| O3 | Un errore severo raggiunge uno schermo umano | A3 | - | - | banner rosso in Home su health_log != ok | - | OK (banner); mail su error non fatta, OWNER minore |
| O4 | Il backup copre tutte le tabelle critiche e fallisce rumorosamente se salta qualcosa | A11, C34 | - | - | guardia completezza in db-backup (+ce_snapshots, shopify_catalog, non_product_codici) | - | OK |
| O5 | Un restore non silenzia i detector (ce_snapshots ripristinata) | A11 | - | - | inclusa nel backup | da scrivere: runbook/test di restore | OK backup; test restore mai fatto (GAP) |
| O6 | Uptime monitor esterno (se i cron muoiono, qualcuno se ne accorge) | C33 | - | - | - | - | OWNER (uptime.yml da pushare, scope workflow) |

## 6. SICUREZZA (postura no-login difesa in profondita')

| ID | Invariante | Origine | DB | Runtime | Guardia | Test | Stato |
|---|---|---|---|---|---|---|---|
| SEC1 | anon non scrive nulla, da nessuna via | verde audit | REVOKE (0026) + default privileges (0037) | - | - | da scrivere: assertion anti-grant periodica (proposta B21) | OK, ma senza seconda linea: il test/assertion E' la seconda linea |
| SEC2 | `app_flags`/`app_config` illeggibili da qualunque via pubblica (inclusa ask-data/ask_select) | A1 | grant service-role only | ask_select senza allowlist: la falla | - | da scrivere post-fix: coercizione LLM non restituisce flag | **APERTO/OWNER: fix A1 non applicata** |
| SEC3 | Segreti ruotati; vecchia key Qromo da' 401 | A2 | - | - | - | verifica manuale post-rotazione | **OWNER, urgente: secret ancora in git pubblico e valido** |
| SEC4 | TRUNCATE revocato ad anon/authenticated | C27 | REVOKE (0037) | - | - | assertion nel test SEC1 | OK |
| SEC5 | PII esposta = solo la baseline accettata (no-login by-design) | C28 | - | - | - | - | ACCETTATO owner |

## 7. GAP dichiarati (l'audit non li ha verificati: servono test in ambiente isolato)

| ID | Cosa | Origine | Come testarlo |
|---|---|---|---|
| G1 | TOCTOU concorrenza reale: doppio submit simultaneo su `count` e `qromo_sale` | audit §gap | ambiente isolato + fire concorrente (Promise.all x N); con op_id (D3) il caso retry sparisce, resta la conta doppia da 2 device |
| G2 | Burst Shopify > 250 ordini (cap senza paginazione: ritardo, non perdita) | audit §gap | mock/fixture con 300 ordini, verificare recupero al run successivo |
| G3 | Commissioni stimate (~2.2%+0.25) vs payout reali Shopify/Stripe | audit §gap | riconciliazione mensile a importo (candidata a check ce-guard, vedi C7) |
| G4 | Tastiera IT (virgola decimale) su input number in browser mobile reale | audit §gap | test manuale su device o Playwright device-emulation |
| G5 | Interazione conta/reso: conta applicata prima di registrare un reso dello stesso periodo puo' doppio-aggiungere | C26 (sospetto) | riprodurre in ambiente isolato; se confermato, regola operativa o fix in v_inventory |
| G6 | Restore end-to-end del backup (non solo il download) | O5 | prova di restore su progetto/branch separato, mai su prod |

## 8. Copertura test ATTUALE (per non riscrivere cio' che c'e')

`tests/flows.mjs` (contro DB live, marker ZZZTEST): ordini fornitore multi-riga + stub + arrivi
parziali/completi + validazioni; product verification; expenses manual/propose/approve; sale
correction (revert-safe); returns & exchanges; smoke third-flow e ask-data; integrita' Cruscotto.
`tests/features.mjs`: pricing/SEO helpers puri; correttezza `v_ads_mensile`, `v_reorder`,
`v_sku_availability` contro ground truth.

Non coprono: replay/idempotenza (D3/D5), mesi chiusi (C1), concorrenza (G1), resolver orfani
(S2/S3), cascata rinomina (R4), sicurezza (SEC1/SEC2). Sono i primi test da scrivere.

## 9. Ordine di lavoro suggerito

1. **OWNER, subito e senza modello**: SEC3 rotazione segreti + fix SEC2/A1 (e' l'unico APERTO
   sfruttabile da chiunque legga il repo); restatement C8; creazione dei 2 prodotti (S3).
2. **Implementare il design idempotenza** (D3, D5, S6): chiude B13+B16 e rende scrivibili i test replay.
3. **Test senza ambiente isolato** (si possono scrivere OGGI in `tests/`, pattern ZZZTEST):
   C1 (409 mese chiuso su mese sintetico chiuso ad hoc? NO su prod: usare force+cleanup con cautela,
   meglio aspettare l'ambiente), D1 (doppia delivery ZZZTEST poi cleanup), R4 (rinomina ZZZTEST),
   SEC1/SEC4 (sola lettura, sicuri da subito), C6 (confronto sola lettura).
4. **Ambiente isolato** (design da fare: Supabase branch o stack locale + seed dal backup JSON):
   sblocca C1 senza rischio, S2/S3 con fixture orfane, G1/G2/G5/G6, e la CI su ogni push.
