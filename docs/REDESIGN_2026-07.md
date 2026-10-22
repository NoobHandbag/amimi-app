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
**Verifica della cornice (21-10)**
- La migrazione verso `AppBar` e' passata da 8 agenti, uno per gruppo di pagine, ciascuno con un revisore indipendente. In tutto circa 45 viste.
- Gate 2: 4 lenti (navigazione, cascata dei token, impaginazione su telefono, accessibilita' e test), 72 agenti, 30 rilievi sopravvissuti, nessuno di classe A. Sono stati chiusi tutti nella Gate 3:
  - "Chiedi ad Amimi'", avvisi e banner alzati sopra la barra flottante, anche nella zona sicura dell'iPhone;
  - gli stati "attenzione" tornano arancio (`--warning-700`), perche' in A `--accent` e' il nero dell'enfasi;
  - chip, filtri, lenti e KPI dentro le card bianche hanno il fondo grigio;
  - il KPI selezionato in Salute ha un anello;
  - la fascia prezzi in Negozi distingue Amimi' dal negozio;
  - l'anello di focus si vede sulla barra scura;
  - nelle viste annidate resta una sola barra in alto (`.appbar:has(~ * .appbar)`);
  - "indietro" in Registra si chiama "Indietro" (`backAria`);
  - contrasti AA (grigio #666671, rosso #c4271b, verde #137537, barre dei grafici #8e8e99).
- Il contrasto ora e' controllato in automatico da `tema_colori_guardie` (sezione 6).

## Cornice 2 (22-10-2026)

I tratti vecchi che tornavano su piu' di dieci schermate sono sistemati una volta sola, in `styles/shell.css` (sezione "Cornice 2"), prima delle PR per schermata. Confronto prima/dopo sulle 29 schermate di `e2e/tema-schermate.spec.ts`, stessi dati finti.

**Cosa c'e'**
- Token `--warning-on-dark` (#fdba74) e `--negative-on-dark` (#fca5a5). Sopra una card scura testo ed esiti usano solo il bianco (`--surface`, anche a opacita' ridotta), questi due, `--ink-faint` e `--interactive-on-dark`; mai le tinte chiare come `--negative-tint`. Oggi le card scure sono il KPI scuro (`.ds-kpi.hero`) e `.ds-hero`; cassetto del prodotto, "Il sistema dice" della Conta, verdetto di Assistenza e Salute sono ancora chiari e diventano scuri con le loro PR, che da allora seguono la stessa regola. La guardia controlla i contrasti dei token (sezione 6) e che le regole CSS con `.hero` o `.ds-hero` non usino altri colori di testo (sezione 7); il colore scritto nel TSX non lo vede.
- Icona `close` (due linee incrociate) per i bottoni chiudi: cassetto del prodotto (nome "Chiudi"), "pulisci" della ricerca in Home (ora con la sua classe `.ds-search-x`, tondo da 30 px con tocco da 44 px, non piu' `.drawerx`), cassetto del CE, pannello dell'assistente. `Icon` accetta `className`.
- KPI scuro (`.ds-kpi.hero`): largo quanto la griglia e per primo, numero a 40 px, bianco anche quando e' un esito. Se gli altri KPI restano dispari, l'ultimo prende la riga intera (Cruscotto e CE: tre sotto il KPI scuro); sul desktop, KPI scuro piu' tre, la griglia passa a tre colonne. Usa `:has()`: dove manca resta la cella vuota.
- Tabelle: intestazioni in minuscolo, 12 px, grigie; niente riga sotto l'ultima. Il CE (`table.cedt`) e Tabelle (`.ds-dt`) tengono le loro regole.
- Moduli: etichette `.fl` in minuscolo; i campi del kit (`input.txt`, `input.num`, `input.search`, `select.txt`, `select.num`, `textarea.txt`) pieni, senza bordo, alti 48 px, in Geist, a 16 px; grigi dentro le superfici bianche, segnaposto in `--ink-muted` (il grigio del browser scendeva a 3,9:1 sul grigio). Un campo a confidenza bassa dell'AI (`.mat-low`, Materiali e foglio d'ordine) ha un anello interno arancio di 2 px: senza bordo il suo contorno sarebbe sparito. Passo tondo, scelte a pillola (nera quella scelta), "aggiungi" come pillola col testo bordeaux, box AI bianco sul fondo.
- I campi fuori dal kit restano sotto i 16 px e su iPhone ingrandiscono ancora la pagina al tocco (era cosi' anche prima): ricerca `.ds-search input` (14,5 px, Home e le altre barre di ricerca), mese del Cruscotto `.dethead select` (14), data dell'ordine `.datepick input` (13), data d'arrivo `.ds-recvdate` in Ordini (13), ricodifica `.ds-expsel` in Spese (14), il select del modello in "Ordine da foglio" (`FoglioOrdine.tsx`, 13 scritto nel `style`, che ora prende anche i 48 px del kit), i campi di Assistenza e Outreach (`.cs-fld`, `.or-form`, `.or-comp`, `.cs-catedit`, `.cs-case-row`, 13-14) e la griglia azioni dell'assistente (`.ai-action-grid`, 14,5). Li sistema la PR della loro schermata.
- Bottone secondario bianco sul fondo e grigio dentro le card (grigio su grigio spariva); badge della barra in alto bianchi; `.appbar-r .exp.busy` fa girare l'icona, ferma con "riduci movimento".
- Pezzi pronti per le schermate: `.askhead` e `.tgl` (freccia che ruota; quella di `.askhead` e' `--ink-muted` e non `--ink-faint` come diceva il piano, che sulle superfici chiare stava a 2,1-2,5:1), `.ds-more` (titolo di sezione con l'interruttore in bordeaux, alto almeno 44 px per il tocco), `.ds-group` (righe in una sola superficie, separatori rientrati con `--sep-inset`; l'anello di focus dentro il gruppo e' disegnato all'interno, altrimenti `overflow: hidden` lo taglia), `.hscroll` (chip che scorrono fino al bordo dello schermo).
- Sincronizza e aggiorna useranno `recycle` sull'azione tonda `.appbar-r .exp` con `.busy`, l'archivio del Riordino `inbox`: la CSS c'e', i bottoni no. Oggi restano 🗄️ (Riordino), "↻ Aggiorna" (Assistenza) e "Aggiorna" (Negozi). Fatto nella Cornice 3, tranne Negozi.
- Velature e ombre in inchiostro invece del prugna ritirato; cassetto con gli angoli a 24 px; ingresso con PIN o email (`.cs-login`, `.cs-logo`, `.cs-or`) e `.cs-btn` in Geist; riepilogo AI (`.ds-aisum`) pieno, titolo in minuscolo.

**Regola per le schermate (vale dalla PR 3)**
- Ogni schermata ha il suo file `web/src/styles/screens/<nome>.css`, importato dal modulo della pagina, come `villaggio.css`. `App` e' importata dopo `shell.css`, quindi a parita' di specificita' vince la pagina.
- Ogni regola sta sotto una sola classe radice `scr-<nome>`, sul div `.screen`: `scr-home`, `scr-mag`, `scr-registra`, `scr-ordini`, `scr-assist`, `scr-b2b` (al posto di `.home`, `.inv`, `.registra`, `.scr-ordini`, `.cs-screen`, `.b2b` usati nelle revisioni).
- Negozi e Outreach: `b2b.css` importato da `main.tsx`, regole agganciate con `:has()` ai loro figli unici, cosi' il loro TSX non si tocca.
- Cio' che serve a piu' schermate resta in `shell.css`; una regola di una schermata sola va nel suo file. Il Villaggio vince sempre: dentro `.vil` le sue regole restano piu' specifiche.

**Resta alle PR per schermata**: avvolgere le righe in `.ds-group` (non in Home, decisione di Dan del 22-10 nella Cornice 3); spostare i bottoni di sincronizzazione su `.appbar-r .exp` con `recycle` e `.busy` (Cruscotto, Magazzino, Ads, Negozi, Assistenza; fatto nella Cornice 3 tranne Negozi); archivio del Riordino da 🗄️ a `inbox` (fatto nella Cornice 3); il bottone Google e il divisore `.cs-or` nelle pagine d'ingresso; portare a 16 px i campi fuori dal kit elencati sopra (in Ordini anche il select del foglio, e togliere il `marginTop: 8` scritto su "Gia' arrivati"); i cassetti, la Conta e il verdetto che diventano scuri usano i colori on-dark.

**Cruscotto (PR 5, 22-10)**: `pages/Report.tsx` con `scr-crusc` e `styles/screens/cruscotto.css`. Numeri, letture, ordinamenti ed export CSV invariati (il CSV nasce da `rows`, non dalla tabella).
- MC1 (KPI e colonna del CE) e' neutro e diventa rosso solo se negativo: positivo lo e' quasi ogni mese, il verde non diceva niente. MC2 resta verde o rosso, e' l'utile. Il KPI scuro in cima lo faceva gia' la Cornice 2.
- CE mensile: titolo in minuscolo, "Vedi dettaglio" come pillola piccola con la freccia che non va a capo, quattro colonne invece di sei (la % su netto sta sotto MC1 e MC2), celle allineate sulla prima riga. Nei mesi esclusi dai totali (riga a opacita' .6) la % e' in inchiostro: in grigio sarebbe scesa a 2,5:1.
- Dettaglio mese: selettore a pillola pieno a 16 px (era uno dei campi sotto i 16 px elencati sopra), "Costi variabili" e "Costi fissi" in minuscolo, totali senza la riga doppia e con l'importo a 16 px sulla stessa linea di base dell'etichetta. Il totale perde la riga solo prima di un gruppo, di una nota o in fondo: nel calcolatore B2B la riga fra "Wholesale: ricavo" e "COGS totale" resta.
- Grafici senza bordeaux sui dati: imbuto e fasce ordine in grigio, l'utile in inchiostro; canali online inchiostro, offline grigio (`--chart-bar`), B2B grigio medio (`--ink-muted`, 5,7:1 sul bianco; `--ink-faint` era 2,5:1 e quasi uguale all'offline), legenda a righe con quota e importo. Fra i segmenti 2 px di bianco; un segmento a zero non si disegna e, se il periodo non ha incassi, torna la traccia grigia. Il bordeaux resta solo al mese in corso.
- Top prodotti: il venduto in inchiostro, non piu' bordeaux scritto nel `style`.
- "Apri il Villaggio" e "Apri Ads per creativita'" da chip nera a pillola secondaria con la freccia (`e2e/villaggio.spec.ts`: le due righe col nome del bottone senza la freccia di testo). Avviso della serie Ads vecchia in una fascia arancio tenue, senza emoji; la colonna "Sconto" non e' piu' rossa (uno sconto non e' un esito).
- Calcolatore B2B: `.askhead` con la freccia, senza emoji; "Aggiungi prodotto" pieno col testo bordeaux, campi pieni a 16 px, "togli" con l'icona `close` e il nome "Togli".
- Stampa: il PDF del Cruscotto usciva bianco, come quello di ogni schermata con il bottone PDF. Non veniva da questa PR (il `@media print` del report dell'assistente in `index.css`, 22-07, nascondeva `#root` in ogni stampa) ed e' corretto nella Cornice 3, sotto. `cruscotto.css` tiene imbuto e trend come a schermo anche senza "grafica di sfondo" (`print-color-adjust: exact`), nasconde la freccia del calcolatore e, dalla Cornice 3, il Villaggio. Il resto sta in `shell.css`: il KPI scuro resta scuro, la barra e la legenda dei canali tengono i loro colori, bottoni e calcolatore chiuso non si stampano. I separatori sono bordi, non ombre (la stampa toglie ogni ombra). Provato su un PDF di Chromium con la correzione simulata: KPI scuro col testo bianco, imbuto, trend e barra dei canali visibili, CE a quattro colonne, pillole nascoste.
- Prima e dopo sulle 29 schermate, stessi dati finti: cambia solo il Cruscotto (in Home la riga della versione).

**Resta sul Cruscotto**: la tabella degli sconti ha ancora sei colonne e a 390 px scorre dentro la card; i nomi dei top prodotti restano in maiuscolo; il paragrafo del Villaggio tiene il suo `style`. Fatti nella Cornice 3 (sotto): "Sincronizza Shopify" come azione tonda nella barra (via il badge "replica"), la stampa, la stampa del KPI scuro in `shell.css`, la guardia dei colori dei grafici. Candidati per `shell.css`, se servono anche altrove: la pillola piccola con la freccia, la fascia `.note.warn`.

## Cornice 3 (22-10-2026)

Una PR condivisa dopo il Cruscotto: la stampa di ogni schermata e l'azione tonda per sincronizzare. Confronto prima/dopo sulle 29 schermate di `e2e/tema-schermate.spec.ts`, stessi dati finti, piu' le viste di stampa nuove.

**Stampa**
- Causa: dal 22-07 (commit `b69171b`, "Salva come report" dell'assistente) il `@media print` di `index.css` nascondeva `#root` in ogni stampa, non solo col portale del report. Ogni bottone PDF (Cruscotto, CE dettagliato, Margini, Clienti, Ordini, Magazzino) dava un foglio bianco: prima della correzione le sei viste di stampa erano di un solo colore e i sei PDF una pagina senza testo.
- Regola: `body:has(> .ai-print-portal) > #root`. Il portale sta in `body` solo mentre si stampa il report: con lui si stampa solo il report, come prima; senza, la schermata. Provato con un portale finto: senza, `#root` resta visibile; col portale e' nascosto e il PDF ha solo il report.
- Fuori dal foglio (`index.css` e `shell.css`, sezione "Cornice 3"): barra in basso e la sua velatura (`.app::after`); "Chiedi ad Amimi'" (bottone, pannello e velatura sono fixed e tornerebbero su ogni foglio); avvisi e banner; i bottoni della barra in alto (restano il titolo, a sinistra come intestazione, e i badge, che sono dati); la riga di stato; i bottoni del kit (`.ds-btn`); le ricerche vuote; le sezioni chiuse (`.askhead` con `aria-expanded=false`); archivia e ripristina sulle righe del Riordino (`.rio-arch`).
- Selettori e filtri (`.ds-seg`, `.ds-fp`, `.ds-lp` e i filtri vecchi `.fchip` del Riordino): resta solo la scelta attiva, in nero, perche' dice cosa mostra il foglio (Totale, i mesi, la lente). Senza "grafica di sfondo" il bianco sulla pillola nera usciva grigio chiaro, piu' tenue delle opzioni non scelte.
- Con `print-color-adjust: exact` in `shell.css`, cioe' stampati coi loro fondi anche senza grafica di sfondo: KPI scuro e `.ds-hero` (Cruscotto e CE, restano scuri col testo bianco); le barre a segmenti `.ds-chbar` con la legenda (canali nel Cruscotto, segmenti in Clienti coi pallini scritti nel `style`: prima sul foglio restava un buco); la pillola "da riprodurre" (`.hot`, bianco sul bordeaux). Imbuto e trend del Cruscotto restano in `cruscotto.css`.
- Due difetti visti solo nei PDF. `#root` alto `100svh` in stampa vale un foglio: Ordini aveva una seconda pagina bianca. Le tabelle larghe erano tagliate dal riquadro che scorre: il CE dettagliato si fermava a luglio. Ora in stampa il riquadro non taglia e Chromium rimpicciolisce il foglio, ma al massimo di 1,5 volte: coi margini di default (circa 1 cm, foglio di 718 px) oltre 1.077 px taglia a destra. Il CE dettagliato ha un mese in piu' ogni mese, quindi sul foglio perde la colonna Trend (i numeri ci sono) e ha celle piu' strette e la colonna delle voci a 140 px: oggi, 10 mesi, e' largo circa 915 px ed esce intero a 0,79; ogni mese aggiunge circa 68 px, a dicembre circa 1.050 px, ancora dentro. Le file di chip che arrivano al bordo (`.hscroll`, `.ds-lens.scrollx`) non allargano piu' il foglio.
- Fogli quasi vuoti: `index.css` tiene ogni card intera su un foglio, e una card lunga saltava tutta al foglio dopo (CE, Riordino, "Tutti i clienti"). Una card con 12 righe o piu' (tabella o lista) ora scorre sui fogli; le righe non si spezzano, l'intestazione della tabella si ripete, il titolo resta con quello che segue. Le card piu' corte restano intere: nel Cruscotto ognuna da "Dettaglio mese" in giu' comincia un foglio, per questo i fogli sono 6.
- `.bar > .seg`, la barra del mix canali in Salute, ora si stampa: il vecchio elenco nascondeva ogni `.seg` come se fosse un selettore.
- Come si controlla: `e2e/tema-schermate.spec.ts` salva per le sette viste col bottone PDF (le sei schermate e il Riordino) anche `<nome>-stampa.png` (media print, 718 px, cioe' un A4 coi margini di default) e `<nome>-stampa.pdf` (A4 con 1 cm di margine e senza grafica di sfondo, come la stampa di default di Chrome; senza `margin` `page.pdf` mette i margini a zero e impagina a 794 px, piu' largo del vero, come nella prima versione dello spec). Il PNG mostra i fondi e non rimpicciolisce: cio' che sparisce senza i fondi e la tabella larga si vedono solo nel PDF. Oggi: Cruscotto 6 pagine, CE 2, Margini 2, Clienti 3, Ordini 1, Magazzino 2, Riordino 2.

**Sincronizza e aggiorna (OK di Dan del 22-10)**
- Azione tonda `.appbar-r .exp` con l'icona `recycle`, prima del PDF; con `.busy` l'icona gira (ferma con "riduci movimento") e il bottone e' disabilitato. Il testo che stava sul bottone (Sincronizzo..., l'esito) va in una riga di stato sotto la barra, `<p className="note appbar-st" role="status">`. La riga c'e' sempre ed e' vuota quando non c'e' niente da dire, cosi' un lettore di schermo sente il cambio. Gestori, condizioni e messaggi identici.
- Cruscotto: "Sincronizza Shopify"; via il bottone largo e il badge "replica". Magazzino: "Aggiorna Shopify", solo nella vista Magazzino come prima; il tooltip tiene il dettaglio del giro (feedback del 24-07) e l'esito resta nel toast. Ads: "Pull ora", era la chip accanto a "Dati al"; il nome resta perche' `docs/ARCHITECTURE.md` e il commento di `pullAds` in `lib/api.ts` la chiamano cosi' (il tooltip aggiunge "aggiorna i dati Ads"). Assistenza: "Aggiorna", dalla riga del saluto alla barra.
- Riordino: l'archivio usa l'icona `inbox` al posto di 🗄️ (bottone della riga, nota, intestazione "Archivio riordino"). L'emoji nella nota faceva da soggetto e un lettore di schermo lo leggeva; l'icona e' nascosta ai lettori, quindi la nota dice "il bottone Archivia (icona) la sposta nell'archivio". Il bottone della riga prende il nome dal suo `title` ("Archivia (es. pelle finita)..."). Le due sezioni che si aprono in Magazzino (sell-through e archivio) dicono se sono aperte con `aria-expanded`.
- Restano fuori Negozi e Outreach: il loro "Aggiorna" in `Negozi.tsx` resta com'e' (ci lavorano altre sessioni) e passa all'azione tonda con la loro PR.

**Decisione di Dan (22-10)**: la Home TIENE le tessere per Gestione e Altro. La PR della Home cambia solo hero, ricerca e avviso; nessuna lista raggruppata (`.ds-group` resta per le altre schermate).

**Guardia**: `tests/tema_colori_guardie.mjs`, sezione 8: ogni segno dei grafici (barre dei canali e del trend, i quattro colori dell'imbuto) regge 3:1 sul bianco della card. Nessuna coppia nuova nella sezione 6: i token dei segni e dell'icona dell'azione tonda (`--ink`, `--ink-muted` su `--surface`) ci sono gia' a 4,5:1, piu' severo, e `--chart-bar` a 3:1; mancava il controllo che i segni usino quei token. Prova inversa: barra B2B e utile dell'imbuto a `--ink-faint` danno 2 KO.

**Prima e dopo**: cambiano Cruscotto, Magazzino, Riordino, Ads e Assistenza (barra in alto, riga di stato, icona dell'archivio) e in Home la riga della versione; nelle altre al piu' qualche pixel di antialiasing su un angolo (barra in basso, una card in Ordini). Nessuna pagina scorre di lato.

**Resta**: senza grafica di sfondo spariscono altri colori fatti di sfondo (fondi delle tessere di stato in Magazzino; il testo resta): li sistema la PR della schermata con `print-color-adjust`. Il CE in A4 verticale oggi esce a circa 7,4 pt e a dicembre a circa 6,4 pt; se un mese con numeri piu' lunghi supera i 1.077 px taglia di nuovo a destra: un foglio orizzontale (`@page` con nome) e' una scelta per la sua PR, che oggi non ha un file di schermata. In Magazzino il foglio ripete "Magazzino" sotto il titolo (la scheda scelta). Negozi e Outreach come sopra.

## Home (22-10-2026)

**Home (PR 3, 22-10)**: `pages/Home.tsx` con `scr-home` e `styles/screens/home.css`, dove sta anche lo stile dell'avviso `components/HealthBanner.tsx` (lo usa solo la Home). Letture, numeri, gestori e navigazione invariati. Per decisione di Dan cambiano solo card scura, ricerca e avviso.
- Card scura in una colonna. In alto l'etichetta e "Cruscotto" come pillola piena con la freccia: prima, a 10.300 €, il bottone usciva dal bordo destro. Poi il netto a 40 px come il KPI scuro, l'esito a pari giorni come pillola piena verde o rossa col segno e senza ▲▼, il confronto in bianco tenue e la linea larga quanto la card in `currentColor`. In fondo "Utile (mesi chiusi)" su una riga con l'importo a destra (prima l'etichetta andava a capo su due righe accanto al netto). Sullo scuro il testo e' solo bianco: sul verde 5,8:1, sul rosso 5,7:1, e i due fondi reggono 3,4:1 sul nero. Provata a 320, 390, 620 e 820 px: la pillola resta sempre dentro.
- Ricerca: campo a 16 px (iOS non ingrandisce piu' la pagina al tocco) e alto 48 px come i campi del kit; "Nessuna azione trovata." ha la sua classe al posto dello `style`. "Pulisci" era gia' `.ds-search-x` dalla Cornice 2.
- Avviso dei controlli contabili: pieno in tinta rossa senza bordo, titolo a 600, intestazione `.askhead` con la freccia che ruota (`aria-expanded`), un controllo per riga con l'etichetta a sinistra e il conteggio a destra, separatori rientrati. Via ⚠ e ▲▼. Stesse letture, stesso filtro, stessi conteggi; resta in fondo alla pagina.
- Restano per decisione di Dan: tessere di Gestione e Altro (niente `.ds-group`) e l'interruttore "Altro" com'e', azioni rapide con le tinte di `tileTint`, selettore di persona, emoji del saluto e conteggio accanto ad "Azioni rapide".
- Prima e dopo sulle 29 schermate, stessi dati finti: cambia solo la Home (100 px piu' alta: circa 85 la card scura, 5 la ricerca a 48 px, 10 l'avviso; e la riga della versione); nelle altre al piu' un pixel di antialiasing, le viste di stampa identiche.

**Resta sulla Home**: a 320 px la pagina scorre di lato di 24 px per le azioni rapide (quattro colonne che non scendono sotto la parola piu' lunga, "dettagliato"), non per la card scura; nessuna regola di questa PR le tocca e le tessere restano per decisione di Dan. La guardia dei colori non ha ancora le coppie bianco su `--positive` e su `--negative` della pillola dell'esito.
