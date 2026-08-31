# Design System Amimì v2 — adozione in `amimi-app`

Data: 2026-08-31 · Contratto: [`DESIGN.md`](../DESIGN.md) alla root del repo
Sostituisce: la palette GEEIQ (viola/coral) di `docs/REDESIGN_2026-07.md`

Questo documento racconta **cosa è cambiato nel codice**. Le regole del sistema
(token, spec dei componenti, principi) stanno in `DESIGN.md`: se le due cose non
concordano, vince `DESIGN.md`.

---

## 1. In una riga

La palette GEEIQ è uscita dal sistema. Al suo posto c'è la palette brand reale —
rose `#8B5E6B`, aubergine `#2D2226`, caramel `#C4956A` — più il fondo fotografico
`#E8E4DE`, che è il valore esatto generato da Claid sulle foto prodotto. Gli
heading passano a Fraunces, i numeri restano in Roboto tabellare, le emoji
spariscono dall'interfaccia.

Solo design e theming: nessuna modifica a dati, viste, edge function o logica.

## 2. Dove vive il colore

`web/src/styles/tokens.css` è **l'unico** file che definisce colori. Contiene:

1. il blocco `:root` copiato integralmente da `DESIGN.md` §2.5;
2. la `@font-face` "Amimi Numerals" (§4 qui sotto);
3. un **bridge** di nomi legacy (`--bg`, `--card`, `--line`, `--dark`, `--muted`,
   `--rose`, `--green`, `--red`) ripuntati ai token v2, così la `index.css`
   storica ha adottato la palette senza essere riscritta riga per riga.

Il bridge è un ponte, non un'estensione: nel codice nuovo si usano i nomi v2 e
non si aggiungono alias.

Nomi ritirati e rinominati ovunque in questa run:

| prima | adesso |
|---|---|
| `--interactive`, `--interactive-700`, `--interactive-tint` | `--brand`, `--brand-hover`, `--brand-tint` |
| `--info`, `--info-700`, `--info-tint` | `--brand`, `--brand-hover`, `--brand-tint` (non esiste un colore "info") |
| `--accent-coral*` | `--negative*` |
| `--sec-lavender*`, `--sec-cabaret*`, `--sec-azure`, `--sec-cerulean` | `--accent*`, `--negative*`, `--chart-4` |
| `--positive-700`, `--negative-700`, `--warning-700` | `--positive-ink`, `--negative-ink`, `--warning-ink` |
| `--border-strong` | `--edge` |
| `--surface-alt` | `--surface-sunken` |
| `--grad-hero`, `--grad-brand`, `--grad-action`, `--grad-ai` | rimossi: niente gradienti decorativi |

## 3. Bordi: `--hairline` e `--edge` non sono intercambiabili

È la modifica meno vistosa e la più importante per l'usabilità.

* `--hairline` `#E7E0DB` misura **1.24:1** su canvas. Non passa WCAG 1.4.11
  (soglia 3:1). Vale solo come separatore decorativo: righe di lista, righe di
  tabella, divisori dentro una card.
* `--edge` `#95867F` misura **3.34:1** su canvas e **3.50:1** su bianco. È il
  bordo di tutto ciò che l'utente deve vedere per operare: input, textarea,
  select, checkbox, radio, traccia del toggle, chip non selezionati, bottoni
  secondari, celle editabili.

In `index.css` sono passati a `--edge` tutti i campi (`.search`, `.num`, `.txt`,
`.qbox`, `.cbox`, `.dbox`, `.pinmini`, `.datepick`, le select, le textarea
dell'Assistenza), le chip (`.chip`, `.fchip`, `.kpichip`, `.cs-chip`,
`.cs-fpill`), i segmentati (`.seg`, `.scopetoggle`, `.cs-seg`) e i bottoni
bordati (`.exp`, `.stepbtn`, `.drawerx`, `.minibtn`, `.hit`, `.supcard`).
Una regola in coda a `index.css` fa da rete: ogni `input`/`textarea`/`select`
prende `--edge` anche se una regola vecchia dicesse altro.

## 4. Tipografia: come i numeri restano fuori da Fraunces

Fraunces è self-hosted via `@fontsource-variable/fraunces`, nella sotto-famiglia
a **solo asse `wght`**: gli assi `SOFT` e `WONK` sono quindi a 0 per costruzione,
come chiede il brief, e il font pesa 36 KB invece dei 121 KB del file a quattro
assi. Il valore resta comunque dichiarato in `--display-vf` per il giorno in cui
si passasse al file completo.

Il punto delicato è la regola "mai un numero in Fraunces". Gli heading dell'app
sono composti a runtime e contengono cifre — `Ordini evasi — 128`,
`Log totali — 4.310`. Affidarsi a chi scrive il markup avrebbe funzionato finché
qualcuno se ne fosse ricordato. Per questo la regola è **strutturale**:

```css
@font-face {
  font-family: 'Amimi Numerals';
  src: local('Roboto'), url('@fontsource/roboto/files/roboto-latin-400-normal.woff2') format('woff2');
  unicode-range: U+0025-002F, U+0030-0039, U+003A, U+0024, U+00A3, U+20AC;
}
--font-display: "Amimi Numerals", "Fraunces Variable", Georgia, serif;
```

`Amimi Numerals` punta a Roboto e copre **solo** cifre, separatori e simboli di
valuta. Messa prima di Fraunces nello stack, vince su quei codepoint e cede tutto
il resto al serif. Dentro un `h3`, le lettere sono Fraunces e le cifre Roboto,
senza che nessuno debba avvolgerle in uno span.

Resta disponibile `.num` per i blocchi interamente numerici (valore di un KPI,
cella di tabella), che impone famiglia sans e cifre tabellari.

`h2` ha smesso di essere un'etichetta maiuscola in rose: adesso è un heading
serif da 19px. Il ruolo "etichetta piccola maiuscola" è passato alla classe
`.eyebrow`, in Roboto.

## 5. Product tile

Ovunque l'app mostri l'immagine di un prodotto, il contenitore è
`--surface-photo` (`#E8E4DE`), senza bordo, senza ombra, senza gradiente. Vale
per `.pimg` (griglia picker), `.invimg` (riga magazzino), `.tdimg` (thumbnail in
tabella), `.ds-thumb`, `.ds-pcard-img`, `.ds-picked-img` e `.ai-pc-im` (card
dell'assistente). Prima tre di questi avevano un gradiente
`linear-gradient(160deg, #f3eee6, #efe7f7)`, cioè un rettangolo che stampava
sotto la borsa un fondo diverso da quello dello scatto.

Una regola in coda a `index.css` tiene il vincolo anche se una regola futura
provasse a rimetterci un bordo.

## 6. Emoji

Non ce ne sono più. Ogni pittogramma è un'icona a linea di
`web/src/components/Icon.tsx`: `viewBox 0 0 24 24`, `stroke-width: 1.75`,
`stroke: currentColor`, `fill: none`. Il set è passato da 24 a ~70 nomi per
coprire tutto quello che le emoji dicevano.

Due mappe di dati sono cambiate di forma, non di contenuto:

* `CS_CATEGORIES` in `web/src/lib/csApi.ts` — il campo `emoji` è diventato
  `icon` e `catEmoji()` è diventato `catIcon()`. **I `label` non cambiano**: la
  tassonomia dell'Assistenza resta bloccata come da design 6.2, e i valori
  salvati a DB non sono toccati.
* `META` / `OPMETA` in `web/src/components/RecentFeed.tsx` — il primo elemento
  della tupla è ora il nome di un'icona.

Dove l'emoji era decorazione dentro una frase ("tutto pulito 🎉") è stata tolta e
basta. Le frecce dentro un testo (`Stock → Shopify`) restano: sono punteggiatura,
non pittogrammi.

Il logo Google multicolore del login Assistenza era l'ultima tavolozza estranea
al sistema ed è stato sostituito dall'icona `mail`; il bottone dice già "Accedi
con Google".

## 7. Componenti

Allineati alle spec di `DESIGN.md` §5:

* **Button** — `primary` / `secondary` / `quiet` / `destructive`. Il `primary`
  non ha più il gradiente viola né l'ombra colorata: è rose piatto con hover e
  active dai token. `.ghost` e `.danger` restano come alias delle schermate non
  ancora rinominate.
* **Input** — `--edge`, `font-size: 16px` (niente zoom su iOS), altezza minima 44px.
* **Card** — bordo `--hairline`, `--e1`, hover `--e2` sulle card interattive.
* **KPI card** — valore in Roboto tabellare 25px. Niente delta per-KPI, barra vs
  obiettivo o confronto mese-su-mese: pattern già scartati dalla titolare.
* **Status badge** — tint + ink della famiglia, sempre con un testo accanto.
* **Filter chip** — `--edge` a riposo, `--brand` pieno da selezionato.
* **Table** — header `--surface-sunken` sticky, celle separate da `--hairline`,
  colonne numeriche `tnum`.
* **Chart** — serie da `--chart-1..8`, corrente `--chart-current`.
* **Icon tile** — `--brand-tint` di base, con varianti `.pos` `.neg` `.warn`
  `.accent` `.quiet`.
* **Navigation** — voce attiva `--brand`, inattiva `--ink-muted`, 44px.

## 8. Ergonomia

* **Focus** visibile su ogni elemento focalizzabile: 2px `--brand`, offset 2px.
  I tre `outline: none` che c'erano sono stati sostituiti (l'unico rimasto è
  sull'`input` dentro `.ds-search`, dove il ring è passato al contenitore con
  `:focus-within`, che è il campo che l'utente vede).
* **Tap target** ≥ 44px su tutti i controlli. Verificato a runtime su Home,
  Magazzino, Tabelle e Assistenza: zero controlli sotto la soglia.
* **`prefers-reduced-motion: reduce`** azzera transizioni, animazioni e
  `scroll-behavior` in `tokens.css`.
* I controlli non ereditavano il font: bottoni, input e select cadevano su Arial
  (la nav in fondo compresa). Ora `button, input, select, textarea` ereditano.

## 9. Come si verifica

```bash
bash web/scripts/check-design-system.sh
```

Controlla in un colpo solo i criteri di accettazione del brief: `DESIGN.md`
presente, un solo file che definisce colori, nessun hex GEEIQ, nessun gradiente
ritirato, Fraunces self-hosted e solo sugli heading, cifre fuori dal serif, tile
prodotto senza bordo, nessun controllo su `--hairline`, focus ring,
`prefers-reduced-motion`, nessuna emoji. Esce 1 al primo criterio fallito, quindi
si può agganciare a una CI.

Build e lint restano quelli di sempre:

```bash
cd web && npm run build && npm run lint
```

## 10. Cosa non è stato fatto

* **Storefront Shopify**: fuori scope in questa run.
* **Due punti aperti**, entrambi sullo storefront e nessuno bloccante per l'app:
  se Fraunces sia disponibile nel font picker del tema Symmetry (da controllare
  nell'editor tema, non nei file) e quale font usi oggi lo storefront.
* **Contrasto del testo su `--warning`**: `#B0761A` sta a 3.85:1 sul bianco, sotto
  la soglia 4.5:1 per il testo. Per questo il sistema espone `--warning-ink`
  `#8A5A0F` (5.92:1) e l'ochre pieno resta ai riempimenti e ai bordi. Chi aggiunge
  testo in stato "attenzione" deve usare `--warning-ink`.
