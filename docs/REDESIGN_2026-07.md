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
| Magazzino | FATTO (tab Disponibilità rimosso; lenti; sync_now ri-esposto) |
| Registra | FATTO (ProductPicker condiviso: giacenza + filtri linea; toggle GiftForm) |
| Prodotti & prezzi | FATTO (lista margine/Da-completare; edit segmented+reco) |
| Nomi Title Case display (`prettyName`) | FATTO (fix globale: display Title Case, storage MAIUSCOLO) |
| Ordini in arrivo | FATTO (card fornitore, barra avanzamento, stepper, cestino) |
| Ordini in arrivo | da fare |
| Spese | da fare |
| Salute & Movimenti (+ Attività/Gemini §6) | da fare |
| Tabelle | da fare |
| Assistenza | solo tema (fuori scope redesign) |
