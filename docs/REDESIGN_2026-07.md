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
- Sincronizza e aggiorna useranno `recycle` sull'azione tonda `.appbar-r .exp` con `.busy`, l'archivio del Riordino `inbox`: la CSS c'e', i bottoni no. Oggi restano 🗄️ (Riordino), "↻ Aggiorna" (Assistenza) e "Aggiorna" (Negozi).
- Velature e ombre in inchiostro invece del prugna ritirato; cassetto con gli angoli a 24 px; ingresso con PIN o email (`.cs-login`, `.cs-logo`, `.cs-or`) e `.cs-btn` in Geist; riepilogo AI (`.ds-aisum`) pieno, titolo in minuscolo.

**Regola per le schermate (vale dalla PR 3)**
- Ogni schermata ha il suo file `web/src/styles/screens/<nome>.css`, importato dal modulo della pagina, come `villaggio.css`. `App` e' importata dopo `shell.css`, quindi a parita' di specificita' vince la pagina.
- Ogni regola sta sotto una sola classe radice `scr-<nome>`, sul div `.screen`: `scr-home`, `scr-mag`, `scr-registra`, `scr-ordini`, `scr-assist`, `scr-b2b` (al posto di `.home`, `.inv`, `.registra`, `.scr-ordini`, `.cs-screen`, `.b2b` usati nelle revisioni).
- Negozi e Outreach: `b2b.css` importato da `main.tsx`, regole agganciate con `:has()` ai loro figli unici, cosi' il loro TSX non si tocca.
- Cio' che serve a piu' schermate resta in `shell.css`; una regola di una schermata sola va nel suo file. Il Villaggio vince sempre: dentro `.vil` le sue regole restano piu' specifiche.

**Resta alle PR per schermata**: avvolgere le righe in `.ds-group`; spostare i bottoni di sincronizzazione su `.appbar-r .exp` con `recycle` e `.busy` (Cruscotto, Magazzino, Ads, Negozi, Assistenza); archivio del Riordino da 🗄️ a `inbox`; il bottone Google e il divisore `.cs-or` nelle pagine d'ingresso; portare a 16 px i campi fuori dal kit elencati sopra (in Ordini anche il select del foglio, e togliere il `marginTop: 8` scritto su "Gia' arrivati"); i cassetti, la Conta e il verdetto che diventano scuri usano i colori on-dark.

**Cruscotto (PR 5, 22-10)**: `pages/Report.tsx` con `scr-crusc` e `styles/screens/cruscotto.css`. Numeri, letture, ordinamenti ed export CSV invariati (il CSV nasce da `rows`, non dalla tabella).
- MC1 (KPI e colonna del CE) e' neutro e diventa rosso solo se negativo: positivo lo e' quasi ogni mese, il verde non diceva niente. MC2 resta verde o rosso, e' l'utile. Il KPI scuro in cima lo faceva gia' la Cornice 2.
- CE mensile: titolo in minuscolo, "Vedi dettaglio" come pillola piccola con la freccia che non va a capo, quattro colonne invece di sei (la % su netto sta sotto MC1 e MC2), celle allineate sulla prima riga. Nei mesi esclusi dai totali (riga a opacita' .6) la % e' in inchiostro: in grigio sarebbe scesa a 2,5:1.
- Dettaglio mese: selettore a pillola pieno a 16 px (era uno dei campi sotto i 16 px elencati sopra), "Costi variabili" e "Costi fissi" in minuscolo, totali senza la riga doppia e con l'importo a 16 px sulla stessa linea di base dell'etichetta. Il totale perde la riga solo prima di un gruppo, di una nota o in fondo: nel calcolatore B2B la riga fra "Wholesale: ricavo" e "COGS totale" resta.
- Grafici senza bordeaux sui dati: imbuto e fasce ordine in grigio, l'utile in inchiostro; canali online inchiostro, offline grigio (`--chart-bar`), B2B grigio medio (`--ink-muted`, 5,7:1 sul bianco; `--ink-faint` era 2,5:1 e quasi uguale all'offline), legenda a righe con quota e importo. Fra i segmenti 2 px di bianco; un segmento a zero non si disegna e, se il periodo non ha incassi, torna la traccia grigia. Il bordeaux resta solo al mese in corso.
- Top prodotti: il venduto in inchiostro, non piu' bordeaux scritto nel `style`.
- "Apri il Villaggio" e "Apri Ads per creativita'" da chip nera a pillola secondaria con la freccia (`e2e/villaggio.spec.ts`: le due righe col nome del bottone senza la freccia di testo). Avviso della serie Ads vecchia in una fascia arancio tenue, senza emoji; la colonna "Sconto" non e' piu' rossa (uno sconto non e' un esito).
- Calcolatore B2B: `.askhead` con la freccia, senza emoji; "Aggiungi prodotto" pieno col testo bordeaux, campi pieni a 16 px, "togli" con l'icona `close` e il nome "Togli".
- Stampa: **oggi il PDF del Cruscotto esce bianco**, come quello di ogni schermata con il bottone PDF. Non viene da questa PR: il `@media print` del report dell'assistente in `index.css` (22-07) nasconde `#root` in ogni stampa, non solo quando c'e' il portale. `cruscotto.css` ha gia' le regole per quando la stampa tornera': KPI scuro e grafici come a schermo anche senza "grafica di sfondo" (`print-color-adjust: exact`), bottoni che portano altrove e freccia del calcolatore nascosti. I separatori sono bordi, non ombre (la stampa toglie ogni ombra). Provato su un PDF di Chromium con la correzione simulata: KPI scuro col testo bianco, imbuto, trend e barra dei canali visibili, CE a quattro colonne, pillole nascoste.
- Prima e dopo sulle 29 schermate, stessi dati finti: cambia solo il Cruscotto (in Home la riga della versione).

**Resta sul Cruscotto**: il bottone "Sincronizza Shopify" e il badge "replica" (diventano l'azione tonda `recycle` nella barra con la PR unica dei bottoni di sincronizzazione, dopo l'OK dell'owner); la tabella degli sconti ha ancora sei colonne e a 390 px scorre dentro la card; i nomi dei top prodotti restano in maiuscolo; il paragrafo del Villaggio tiene il suo `style`. **Stampa, PR condivisa** (fuori dai file di questa schermata): in `index.css` nascondere `#root` solo col portale (`body:has(> .ai-print-portal) > #root`); nella stessa PR nascondere in stampa anche il pannello dell'assistente e il suo bottone (`.ai-panel`, `.ai-fab`: sono `fixed` e coprirebbero ogni pagina dalla seconda in poi), il bottone "Sincronizza Shopify" e i filtri dei mesi; poi una prova con `emulateMedia({ media: 'print' })`. In `tests/tema_colori_guardie.mjs` manca una coppia per i colori dei grafici del Cruscotto (es. `ink-muted`/`surface` a 3:1): oggi un ritorno a `--ink-faint` non farebbe fallire niente. Candidati per `shell.css`, se servono anche altrove: la stampa del KPI scuro (c'e' anche nel CE), la pillola piccola con la freccia, la fascia `.note.warn`.
