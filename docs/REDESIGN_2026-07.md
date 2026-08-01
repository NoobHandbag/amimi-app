# Redesign amimi-app — "Amimì su GEEIQ" (2026-07)

Doc di avanzamento del redesign look+UX dell'app (React PWA, deploy gh-pages).
Fonti di verità: `_CLAUDE_CODE_INBOX/_redesign_amimi_app/` (LOOP_PROMPT, PIANO_BUILD, BRIEF, design_system_final.html, mockup per schermata). Se PIANO e mockup divergono vince il PIANO; se mockup e design system divergono su un componente vince il design system.

Vincoli: solo frontend/design + la piccola aggiunta backend §6 (feed change_log + riepilogo Gemini). Scritture solo via write-api. Main diretto, git backup pre-deploy. Dummy test taggati `TEST_REDESIGN_DELETE`, mai su mesi chiusi, flag Shopify/Qromo OFF.

## Layer di design (tokens + font)

- **`web/src/styles/tokens.css`** = unica fonte dei design token GEEIQ (PIANO §2). Importato per primo in `main.tsx`.
  - Superfici/testo, interazione (viola), coral, esito (positive/negative/warning/info), secondary, sequenza grafici, gradienti, raggi/ombre, tipografia.
  - **Ruoli colore**: viola=interazione/nuovo, coral=accento/allarme + negativo, emerald=positivo, arancio=in lavorazione/attesa. Tertiary (Emerald/Cerulean/Azure) solo nei grafici salvo Emerald=positivo.
  - **Bridge nomi legaci**: `--rose`→`--interactive` (viola), `--accent`→`--warning` (arancio), `--dark`→`--ink`, `--card`→`--surface`, `--line`→`--border`, `--muted`/`--mut`→`--ink-muted`, `--green`→`--positive`, `--red`→`--negative`. Così tutta la `index.css` legacy adotta subito la palette; la rifinitura semantica precisa è schermata per schermata.
  - **Nota collisione**: il coral della design system è `--accent` nei mockup, ma qui `--accent` è il bridge legacy (arancio). Nei componenti NUOVI il coral è `--negative` / `--accent-coral`. Quando si porta la CSS di un mockup, tradurre il suo `var(--accent)` (coral) → `var(--negative)`.
- **Roboto self-hosted** via `@fontsource/roboto` (400/500/700, woff2 bundlati da Vite, nessun CDN). Importato in `main.tsx`. Numeri **tabellari** attivi su `body` (`font-feature-settings:"tnum" 1,"lnum" 1`) + classi `.num`/`.tabnum`.
- `index.css` `:root` non ridefinisce più la palette (solo font/color/scheme dai token).

## Componenti + icone

- **`web/src/styles/components.css`** = libreria design-system, classi **namespaced `ds-*`** (per NON collidere con la `index.css` legacy dove `.search`/`.pill`/`.seg`/`.kpi` esistono già con altro significato). Primitivi: `ds-btn` (primary/secondary/ghost/danger/full), `ds-pill` (pos/warn/info/neg), `ds-fp` (filter), `ds-seg` (segmented), `ds-kpi` (+.accent bordo-top), `ds-delta` (up/down/flat), `ds-card`, `ds-bars`. Home: `ds-search`, `ds-hero`, `ds-seclb`, `ds-quick`/`ds-qbtn`, `ds-manage`/`ds-mcard`, `ds-more`, `ds-bdg`. Le schermate adottano `ds-*` man mano.
- **`web/src/components/Icon.tsx`** riscritto: **icone a linea** (SVG stroke ~1.9, `currentColor`) al posto delle emoji. Stessa API `{name,size}` → sostituzione globale in tutta l'app (nav, tile, bottoni). Il colore lo dà il contenitore (tinta 700 su tile tint). Nome sconosciuto → cerchio neutro. L'unica emoji che resta è il 👋 del saluto e il badge "✨ Chiedi ad Amimì" (Assistenza, fuori scope).

## Stato schermate (Fase 1)

| Schermata | Stato |
|---|---|
| Layer design (token+font+bridge) | FATTO (Fase 0 core) |
| Componenti base (`components.css` ds-*) | FATTO (primitivi + Home; si estende per-schermata) |
| Icone a linea (`Icon.tsx`, sostituzione globale emoji) | FATTO |
| Home | FATTO |
| Cruscotto | FATTO |
| Magazzino | FATTO (tab Disponibilità rimosso; lenti; sync_now ri-esposto). Ritocchi feedback owner 24-07 (commit `1570084`): bottone sync compatto in header (in alto a destra, tooltip col dettaglio), filtri chip Modello (scroll orizzontale, `ds-lens scrollx`) + stato Shopify (Pubblicato/Esaurito online/Da caricare, col filtro attivo si parte da tutto l'inventario perché gli esauriti fermi >60g stanno fuori da `alive`), lente Giacenza ordina per pezzi decrescente, sottotitolo riga "N a magazzino · 🌐 N su Shopify · conto N" come pre-redesign |
| Registra | FATTO (ProductPicker condiviso: giacenza + filtri linea; toggle GiftForm) |
| Prodotti & prezzi | FATTO (lista margine/Da-completare; edit segmented+reco) |
| Nomi Title Case display (`prettyName`) | FATTO (fix globale: display Title Case, storage MAIUSCOLO) |
| Ordini in arrivo | FATTO (card fornitore, barra avanzamento, stepper, cestino). Ritocchi feedback owner 24-07 (commit `91fe295`): stepper arrivi 128→172px + padding input ridotto (la quantità era invisibile, ~4px utili), lista "Già arrivati" ordinata per data di consegna decrescente (senza data in fondo) |
| Form "Nuovo ordine fornitore" (SupplierOrderForm) | FATTO (brief search-first 31-07, commit `e11c94c`+`021d01e`): via la griglia "Borse di {forn}", si aggiunge SOLO dalla ricerca (`ds-search`, storico fornitore in testa con thumbnail e "già ordinata N volte · ultimo €X", righe `ds-prow`); toast + flash riga carrello + focus che resta sulla barra; quantità default = ultima `qty_ordered` da supplier_orders (`fetchLastOrder`), mai più 5 hardcoded, mai ordinata = vuoto; step fornitore = ricerca + chip attivi (`ds-fp`) + "Crea fornitore {testo}"; zero migrazioni/edge, `order_multi` intatta. Il picker modello di "+ Borsa nuova" resta con le classi legacy (flusso invariato, Regola 4) |
| Spese | FATTO (fornitore estratto, conferma 1-tap, ricodifica segmented+toggle) |
| Salute & Movimenti | FATTO (voci cliccabili, barretta, feed attività + riepilogo Gemini §6) |
| Tabelle | FATTO (DataTable: header+1ª col fissi, ordinamento, colonne vuote nascoste, conteggi) |
| Assistenza | FATTO (solo tema: viola/AI + token, struttura invariata). **Vista thread RIDISEGNATA 31-07** (mockup `DESIGN_Redesign_Thread_Assistenza_2026-07-31.html` approvato owner, commit `e11c94c`): testata compatta con pill urgenza (`--negative`), categoria chip-select, "Non è un cliente" nel menu overflow "⋯"; strip "fatti" scorrevole (card Ordine con link admin/data/totale/riga, Cliente, Tracking con warn "[DA VERIFICARE]"); "In breve" su `ds-aisum` (grad-ai) sopra la Conversazione; bolle `in`/`out` con corpo = `body_clean` + expander "Email completa" (grezzo mono, solo se clean ≠ raw); testata compressa in modalità bozza. Flusso Fase 3 e vista Rumore invariati; solo token, zero hex nuovi |
| Regressione Fase 2 | **COMPLETO il 2026-08-01** (brief `frontend_rete_di_sicurezza` parte 2). Le 10 schermate rendevano gia' dal 23-07; ora i **quattro flussi di scrittura sono stati provati dal frontend LIVE**, uno per uno, con verifica della riga a DB dopo ogni gesto: conta fisica (`count`), regalo (`gift`), prezzo/COGS (`product_verify`), ordine fornitore + arrivo (`order_multi`, `arrival_set`), spesa (`expense_manual`, che dalla UI nasce gia' `approved`). Provato anche l'**avviso anti-duplicato dell'arrivo**: al secondo arrivo dello stesso codice in giornata compare, cita codice, pezzi, ora e persona, e rifiutando non scrive nulla. Tutte le righe di prova **cancellate con `row_delete`** e conteggi tornati ai valori di partenza (purchases 269, supplier_orders 61, expenses 279, gifts_offline 137, giacenze 797, CE agosto e drift dei mesi chiusi invariati). |
| Deploy web (gh-pages) | **FATTO** (OK owner "deploy" 2026-07-23; `gh-pages` HEAD `7275fbd` con asset nuovi `index-BBbVhsJ-`/`DnHIktf2`; CDN GitHub Pages in propagazione ~min) |
