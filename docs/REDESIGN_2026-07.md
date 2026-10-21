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

## Tema Amimì, fase 0: solo token (15-10-2026)

Richiesta owner: tenere l'estetica GEEIQ (Brand Toolkit e Brand Guidelines v01: regola 60/30/10, un colore per ruolo, card e gradienti come sopra) ma con i colori Amimì della palette v2 del 31-08 (branch `claude/amimi-v2-design-system-u6y25y`, mai mergiato: era un solo commit su base 05-08 e main nel frattempo e' andato avanti di 113 commit). Il lavoro e' a fasi, una PR piccola per fase, per non ripetere il branch unico che invecchia.

- **Fase 0 (questa)**: in `web/src/styles/tokens.css` cambiano solo i VALORI. Un blocco `--amimi-*` contiene gli unici hex (palette v2, piu' tre tinte derivate scritte come hex per non dipendere da `color-mix`); i token di ruolo del 23-07 (`--interactive`, `--accent-coral`, `--positive`, `--sec-*`, `--grad-*`, ...) ora puntano li'. Nomi invariati, quindi nessun componente cambia. Mappa: viola -> rosa antico `#8b5e6b`, Dark Amethyst -> aubergine `#2d2226`, coral (accento) -> caramello `#c4956a`, esiti -> salvia / terracotta / ocra, lavanda/cabaret/azure/cerulean -> prugna / caramello / ardesia / tortora. Gradiente hero da rosa antico a prugna. Roboto resta (struttura GEEIQ; il Fraunces della v2 non entra).
- Portati sui token anche gli ultimi colori GEEIQ scritti a mano: chip di stato e bottoni di Assistenza (`.cs-v-*`, `.cs-state-*`, `.cs-okbtn`, `.cs-noisebtn`, `.cs-chat`, `.cs-banner`, `.cs-inbox`), ombra di `.ai-send`, segnaposto lilla delle foto prodotto (`.ds-thumb`, `.ds-pcard-img`, `.ds-picked-img`, `FoglioOrdine`: token nuovi `--thumb-bg` / `--thumb-ink`). Legenda del trend nel Cruscotto: "Barre rosa antico ..., caramello = mese in corso".
- **Contrasto** (WCAG, prima -> dopo): testo azione su bianco 4,02 -> 5,37; bianco sul bottone primario 4,02 -> 5,37; bianco sul fondo del gradiente hero 2,94 -> 7,53; esiti 700 su tinta da 3,6-4,1 a 5,2-7,8; numeri `--accent` (giacenze, badge) 2,42 -> 3,85; MC1 verde su bianco 2,40 -> 6,09. Unico peggioramento: la barra del mese corrente (caramello) su bianco 3,32 -> 2,67, sotto il 3:1 degli oggetti grafici; resta distinta dalle barre rosa per tinta e luminosita' ed e' marcata anche nel testo. Da rivedere in fase 1 se serve.
- **Prima e dopo**: `web/e2e/tema-schermate.spec.ts` (vedi `TEST_INVARIANTS.md`), 18 schermate a 390 px sugli stessi dati finti, 18 su 18 sia prima sia dopo; e2e di Negozi 18 su 18 sia prima sia dopo.
- **Restano fuori (fasi successive)**: circa 180 hex nei `.tsx` e circa 130 nei CSS che NON sono della palette GEEIQ (rossi/verdi/marroni dell'era pre-luglio, `#fff`, ombre scure `rgba(46,32,77,...)`), concentrati in Negozi, Materiali, Assistenza, FoglioOrdine, Salute; i ~480 `style={{}}` inline. Fase 1 = componenti condivisi, fase 2 = una schermata per PR.

## Tema Amimì, fase 1: i colori rimasti passano dai token (15-10-2026 sera)

La fase 0 e' online dalle 20:03 del 15-10 (web `1b4f81b`, pubblicata dalla sessione della #68 insieme al suo lavoro). La fase 1 chiude il resto.

- **Classificazione**: 316 colori scritti a mano in `web/src`, letti uno per uno da un agente per file (o per pezzo di `index.css`), con un controllore indipendente per ciascuno. La mappa segue il SIGNIFICATO, non la tinta: errore/allarme -> `--negative`, ok -> `--positive`, attesa/avviso -> `--warning`, pannelli tenui -> `--surface-alt`, segnaposto foto -> `--thumb-bg` / `--thumb-ink`. Sostituiti 173 colori su 140 righe.
- **Lasciati apposta** (139), ognuno col motivo: testo bianco su fondo pieno, ombre e velature neutre, colori delle categorie materiali (`lib/matApi.ts`, sono dati), logo Google, torta dell'assistente e `fill` SVG di Premia (`var()` negli attributi SVG non e' affidabile su ogni browser; quei colori sono gia' della famiglia Amimì).
- **Gate 2** (fase 0 e fase 1, un revisore per area e due verificatori indipendenti per rilievo): 24 rilievi sopravvissuti, tutti di classe C, chiusi in `30d4c8f`. I principali sono questi.
  - Ultime ombre GEEIQ `rgba(46,32,77)` portate all'inchiostro Amimì.
  - Mese corrente del CE in caramello, come i grafici.
  - Seconda serie in ardesia (`--chart-4`) accanto al rosa antico.
  - In Home, Registra vendita e Pubblica in caramello, Reso in terracotta.
  - Badge "esaurito" con contorno terracotta.
  - Token nuovi: `--accent-coral-strong` (caramello derivato, 3,8:1, per contorni e grafici sottili) e `--interactive-tint-soft` (stati selezionati su card bianca).
  - Salute, freschezza delle fonti: "ferma" e "in ritardo" anche a parole, non solo col colore.
  - Predeploy: rifiuta un host diverso dal progetto vero e un bundle verso il progetto finto degli e2e.
- **Guardia**: `tests/tema_colori_guardie.mjs` (vedi `TEST_INVARIANTS.md`).
- **Restano**: i circa 480 `style={{}}` inline (struttura, non colore) e i 139 colori lasciati apposta. Una passata di UX/UI si decide con l'owner schermata per schermata.

## Tema A "Contrasto" con accento bordeaux (scelto il 21-10-2026)

Il 20-10 Dan ha detto che i colori di prima non gli piacevano e che l'app sembrava "vecchia scuola". Ha confrontato tre direzioni sulle stesse tre schermate (Home, Cruscotto, Magazzino), sulla pagina "Nuovo look Amimì" (artifact https://claude.ai/artifact/UxHm9cjMRZAMsNUr8J9k6X): A Contrasto, B Atelier, C Nativo. Ha scelto **A con l'accento Bordeaux** ("contrasto, bordeaux").

**Cosa vuol dire A**
- Fondo grigio freddo (`--bg` #f3f3f5) e superfici bianche senza bordo ne' ombra: i blocchi si staccano per contrasto.
- Testo e struttura in inchiostro (#0c0c10). Una sola card scura per schermata, col numero che conta (`--grad-hero` pieno, inchiostro).
- Un solo accento, bordeaux #7a2231: azione, tab attivi, focus, mese corrente nei grafici. Sopra il nero si usa il bordeaux chiaro #c39ca2 (`--interactive-on-dark`). Verde, arancio e rosso servono solo per gli esiti.
- Carattere Geist (`@fontsource/geist`, self-hosted; Roboto resta solo per l'entry del Villaggio). Titoli in minuscolo, numeri grandi e stretti (600, tracking negativo).
- Barra in alto: indietro come bottone tondo con l'icona, titolo piccolo al centro, azioni a destra (`components/AppBar.tsx`). Sparisce il link di testo "← Home".
- Barra in basso: pillola scura che galleggia; la sezione attiva si allarga e mostra il nome, le altre sono solo icone.

**Come e' fatto**
- `styles/tokens.css`: la palette di A e' l'unico blocco con gli hex (`--amimi-*`). I nomi di ruolo (`--interactive`, `--accent-coral`, `--sec-*`, `--grad-*`) restano e puntano li', quindi i componenti non cambiano. `--e1`/`--e2` sono ombre nulle; `--e-float` e' solo per cio' che galleggia.
- `styles/shell.css` (caricato per ultimo in `main.tsx`): la cornice condivisa. Contiene barra in alto, titoli, card e KPI, pillole, chip, selettori, bottoni, tessere della Home, barre dei grafici e barra in basso. Le regole di una sola schermata non vanno qui ma nella fase di quella schermata.
- `components/AppBar.tsx`: la barra in alto di ogni vista; `backLabel` dice dove si torna ed e' il nome accessibile del bottone ("Torna a Home").
- `pages/Home.tsx`: tessere neutre, solo la prima azione rapida nel colore d'accento.

**Fasi**: questa e' la fase "cornice", che cambia la faccia di tutte le schermate insieme. Seguono le singole schermate, ognuna con la sua PR e gli screenshot prima/dopo (`e2e/tema-schermate.spec.ts`). Il Villaggio ha uno stile suo e resta fuori.
