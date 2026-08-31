# Amimì — Design System v2

Contratto di design del brand Amimì Milano. Vale per `amimi-app` e, quando verrà
esteso, per lo storefront. Questo file è la **fonte di verità**: se un brief e
questo documento non concordano, vince questo documento.

Versione 2.0 · 2026-07-28 · sostituisce la palette GEEIQ (viola/coral) del 2026-07-22.

---

## 1. Principi

1. **La foto è il prodotto.** L'interfaccia non compete con le borse. Superfici
   neutre, calde, zero gradienti decorativi, zero ombre colorate.
2. **Un colore per l'azione.** Il rose `#8B5E6B` è l'unico colore di interazione.
   Il caramel è accento, non azione. Non esiste un colore "info" separato.
3. **Esito verde/rosso, tinte del brand.** Convenzione della titolare invariata:
   positivo verde, negativo rosso — ma nelle versioni desaturate del sistema
   (sage, terracotta, ochre), mai nei verdi/rossi da semaforo.
4. **I numeri non sono decorazione.** Ogni cifra, valuta, SKU e data resta in
   Roboto con cifre tabellari. Il serif non tocca mai i dati.
5. **Il bordo che serve a operare deve vedersi.** `--hairline` separa, `--edge`
   delimita un controllo. Non sono intercambiabili (§ 4).
6. **Niente emoji.** Ogni pittogramma è un'icona a linea, stroke 1.75, `currentColor`.

---

## 2. Colore

### 2.1 Palette brand

| Ruolo | Nome | Hex |
|---|---|---|
| Primario / azione | rose | `#8B5E6B` |
| Testo / scuro | aubergine | `#2D2226` |
| Accento caldo | caramel | `#C4956A` |
| Fondo fotografico | photo | `#E8E4DE` |

`#E8E4DE` è il **valore esatto** del fondo generato da Claid sulle foto prodotto.
Non è un grigio "vicino": va usato tale e quale, altrimenti l'immagine mostra un
rettangolo di stacco.

### 2.2 Esito

| Ruolo | Nome | Hex | Contrasto su bianco |
|---|---|---|---|
| positivo | sage | `#456B48` | 6.09:1 |
| negativo | terracotta | `#9A3A2A` | 6.97:1 |
| attenzione | ochre | `#B0761A` | 3.85:1 — solo riempimenti/bordi, mai testo |
| attenzione (testo) | ochre ink | `#8A5A0F` | 5.92:1 |

Non esiste `--info`: dove serviva "informativo/nuovo", si usa `--brand`.

### 2.3 Bordi

| Token | Hex | Contrasto su canvas | Uso |
|---|---|---|---|
| `--hairline` | `#E7E0DB` | **1.24:1** | solo decorativo: separatori di lista, righe di tabella, divisori di card |
| `--edge` | `#95867F` | **3.34:1** | tutto ciò che l'utente deve vedere per operare |

`--hairline` non passa WCAG 1.4.11 (Non-text Contrast, soglia 3:1): non può
delimitare un input, una checkbox, un radio, un toggle, una cella editabile o
uno stato di focus. Per quelli esiste `--edge`.

### 2.4 Grafici

Sequenza categorica, nell'ordine. Nessun colore fuori da questa lista.

`--chart-1` rose · `--chart-2` caramel · `--chart-3` sage · `--chart-4` slate
`--chart-5` plum · `--chart-6` terracotta · `--chart-7` ochre · `--chart-8` taupe

La serie "corrente" (mese in corso, riga selezionata) usa `--chart-current` = caramel.

### 2.5 Token (blocco `:root` canonico)

Questo blocco va copiato **integralmente** in `src/styles/tokens.css`. Nessun
altro file definisce colori.

```css
:root {
  /* ---- superfici ---- */
  --canvas: #FBF9F7;
  --surface: #FFFFFF;
  --surface-sunken: #F4F0EC;
  --surface-photo: #E8E4DE;
  --scrim: rgba(45, 34, 38, .44);

  /* ---- inchiostro ---- */
  --ink: #2D2226;
  --ink-muted: #6B5C60;
  --ink-subtle: #8A7B7F;
  --on-brand: #FFFFFF;
  --on-dark: #F7F3F1;

  /* ---- bordi (§2.3 — NON intercambiabili) ---- */
  --hairline: #E7E0DB;
  --edge: #95867F;

  /* ---- brand / azione ---- */
  --brand: #8B5E6B;
  --brand-hover: #744C57;
  --brand-pressed: #5E3D46;
  --brand-tint: #F3EBED;
  --brand-tint-strong: #E4D2D7;

  /* ---- accento ---- */
  --accent: #C4956A;
  --accent-ink: #7A5433;
  --accent-tint: #F6EDE3;

  /* ---- esito ---- */
  --positive: #456B48;
  --positive-ink: #35522F;
  --positive-tint: #E9EFE9;
  --negative: #9A3A2A;
  --negative-ink: #7C2E20;
  --negative-tint: #F7E9E5;
  --warning: #B0761A;
  --warning-ink: #8A5A0F;
  --warning-tint: #F8F0DE;

  /* ---- grafici (§2.4) ---- */
  --chart-1: #8B5E6B;
  --chart-2: #C4956A;
  --chart-3: #456B48;
  --chart-4: #5C7080;
  --chart-5: #6E4A5A;
  --chart-6: #9A3A2A;
  --chart-7: #B0761A;
  --chart-8: #A08C84;
  --chart-current: #C4956A;
  --chart-grid: #E7E0DB;

  /* ---- tipografia ---- */
  --font-sans: "Roboto", -apple-system, "Segoe UI", Arial, sans-serif;
  --font-display: "Amimi Numerals", "Fraunces Variable", Georgia, serif;
  --font-mono: ui-monospace, "SF Mono", Consolas, monospace;
  --num: "tnum" 1, "lnum" 1;
  --display-vf: "SOFT" 0, "WONK" 0;

  /* ---- raggi ---- */
  --r-xs: 6px;
  --r-sm: 9px;
  --r-md: 12px;
  --r-lg: 16px;
  --r-pill: 999px;

  /* ---- elevazione (neutra, mai colorata) ---- */
  --e0: none;
  --e1: 0 1px 2px rgba(45, 34, 38, .05);
  --e2: 0 6px 18px rgba(45, 34, 38, .09);
  --e3: 0 16px 40px rgba(45, 34, 38, .16);

  /* ---- focus ---- */
  --focus: var(--brand);
  --focus-ring: 2px;
  --focus-offset: 2px;

  /* ---- spaziatura ---- */
  --s1: 4px;  --s2: 8px;  --s3: 12px; --s4: 16px;
  --s5: 20px; --s6: 24px; --s7: 32px; --s8: 40px;

  /* ---- ergonomia ---- */
  --tap: 44px;

  /* ---- movimento ---- */
  --dur-1: 120ms;
  --dur-2: 200ms;
  --ease: cubic-bezier(.2, .6, .2, 1);
}
```

### 2.6 Colori ritirati

Fuori dal sistema, da non reintrodurre:

`#7c68fb` `#5b35f2` `#4c23de` `#d5d5ff` `#2e204d` `#3a2668` `#fc4f3f` `#c51f10`
`#ffcbc6` `#00bd9d` `#028371` `#d8f5ec` `#ff8614` `#c74d07` `#ffdea8` `#b380e5`
`#e6476f` `#faf7f2` `#f3eee5` `#ece6db` `#e3dccf` `#6b6580`

Ritirati anche i gradienti decorativi `--grad-hero`, `--grad-brand`,
`--grad-action`: il sistema v2 non usa gradienti.

---

## 3. Tipografia

### 3.1 I due caratteri

| | Famiglia | Dove |
|---|---|---|
| Display | **Fraunces Variable** (self-hosted, `font-display: swap`) | `h1`, `h2`, `h3`, `.display` — e basta |
| Testo e dati | **Roboto** 400/500/700 (self-hosted) | tutto il resto |

Fraunces è caricato nella sotto-famiglia a solo asse `wght`: gli assi `SOFT` e
`WONK` restano quindi a 0 per costruzione, come richiesto, senza pagare gli ~85 KB
in più del file a quattro assi. Il valore è comunque dichiarato in `--display-vf`
così che resti vero anche se un giorno si passa al file completo.

```css
h1, h2, h3, .display {
  font-family: var(--font-display);
  font-variation-settings: var(--display-vf);
  font-weight: 600;           /* asse wght usato tra 500 e 700 */
  letter-spacing: -.01em;
}
```

### 3.2 Regola dei numeri

Fraunces **non tocca mai** numeri, valute, SKU, codici, date, percentuali,
conteggi. Restano Roboto con `font-feature-settings: var(--num)`.

La regola non è affidata alla disciplina di chi scrive il markup: è **strutturale**.
`--font-display` non parte da Fraunces ma da `"Amimi Numerals"`, una `@font-face`
che punta a Roboto e la cui `unicode-range` copre **solo** cifre, separatori e
simboli di valuta. Dentro un `h3` generato a runtime — `Ordini evasi — 128` — le
lettere prendono Fraunces e le cifre Roboto, senza che nessuno debba ricordarsene.

Per un blocco numerico intero (un valore KPI, una cella di tabella) resta la
classe `.num`, che impone famiglia sans e cifre tabellari.

### 3.3 Scala

| Ruolo | Dimensione | Peso | Famiglia |
|---|---|---|---|
| `h1` / `.display` | 26px | 600 | display |
| `h2` | 19px | 600 | display |
| `h3` | 16px | 600 | display |
| eyebrow / `.sech` | 11px, `.06em`, uppercase | 700 | sans |
| body | 15px / 1.5 | 400 | sans |
| body-sm | 13px / 1.45 | 400 | sans |
| micro | 11.5px | 600 | sans |
| dato grande | 24–30px | 700, `tnum` | sans |

L'etichetta piccola maiuscola non è un heading: è `.eyebrow`, in Roboto. Se una
sezione ha bisogno di quel trattamento, usa `.eyebrow`, non un `h2` compresso.

---

## 4. Bordi, focus, ergonomia

* `--hairline`: separatori, righe di tabella, divisori interni di card. **Mai** su
  un controllo.
* `--edge`: input, textarea, select, checkbox, radio, toggle (traccia off),
  celle editabili, bottoni secondari, chip non selezionati.
* **Focus**: sempre visibile, su ogni elemento focalizzabile.
  `outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-offset);`
  Non si rimuove mai l'outline senza rimpiazzarlo.
* **Tap target**: minimo `--tap` (44px) in altezza e larghezza per ogni elemento
  toccabile. Se la grafica è più piccola, si estende l'area con padding o
  pseudo-elemento.
* **Movimento**: `@media (prefers-reduced-motion: reduce)` azzera transizioni,
  animazioni e `scroll-behavior`.

---

## 5. Componenti

### 5.1 Button

Altezza minima 44px, raggio `--r-md`, peso 700, gap 8px con l'icona.

| Variante | Fondo | Testo | Bordo |
|---|---|---|---|
| `primary` | `--brand` (hover `--brand-hover`, active `--brand-pressed`) | `--on-brand` | nessuno |
| `secondary` | `--surface` | `--ink` | 1px `--edge` |
| `quiet` | trasparente (hover `--brand-tint`) | `--brand` | nessuno |
| `destructive` | `--negative` | `--on-brand` | nessuno |

Nessuna ombra colorata. `:disabled` → `opacity: .5`, cursore default.

### 5.2 Input

`--surface`, bordo 1px `--edge`, raggio `--r-md`, padding 12/14, `font-size: 16px`
(niente zoom su iOS), altezza minima 44px. `:focus-visible` → outline standard e
`border-color: --brand`. Placeholder `--ink-subtle`. Stato errore: bordo
`--negative` + messaggio in `--negative-ink`, mai il colore da solo.

### 5.3 Card

`--surface`, bordo 1px `--hairline`, raggio `--r-lg`, ombra `--e1`, padding 16px.
Le card interattive alzano a `--e2` in hover e mostrano il focus ring. Le sezioni
interne si separano con `--hairline`.

### 5.4 Product tile — *elemento nuovo, il più importante*

Ovunque l'app mostri l'immagine di un prodotto (griglia picker, riga magazzino,
thumbnail in tabella, card assistente, riga carrello), il contenitore è:

```css
background: var(--surface-photo);   /* #E8E4DE, esatto */
border: none;
box-shadow: none;
border-radius: var(--r-sm);
```

`object-fit: contain`. L'immagine deve risultare **a filo**: nessun rettangolo
grigio, nessun bordo, nessuna ombra, nessun gradiente di fondo. Il placeholder
(prodotto senza foto) usa lo stesso fondo con l'iniziale in `--ink-subtle`.

### 5.5 KPI card

`--surface`, bordo `--hairline`, raggio `--r-lg`, ombra `--e1`.
Valore 24–28px peso 700 `tnum`; etichetta 11px uppercase `.06em` `--ink-muted`;
sottotesto 11px `--ink-subtle`. Il valore assume `--positive` / `--negative`
solo quando il segno è il significato. Niente delta per-KPI, niente barra vs
obiettivo, niente confronto mese-su-mese (scartati dalla titolare).

### 5.6 Status badge

Pill, 11px, peso 700, padding 3/9, raggio `--r-pill`.

| Stato | Fondo | Testo |
|---|---|---|
| positivo | `--positive-tint` | `--positive-ink` |
| attenzione | `--warning-tint` | `--warning-ink` |
| negativo | `--negative-tint` | `--negative-ink` |
| neutro | `--surface-sunken` | `--ink-muted` |
| brand | `--brand-tint` | `--brand-hover` |

Mai il solo colore a portare il significato: il badge contiene sempre un testo.

### 5.7 Filter chip

Riposo: `--surface`, bordo 1px `--edge`, testo `--ink-muted`.
Selezionato: `--brand`, testo `--on-brand`, bordo `--brand`.
Altezza minima 36px con area toccabile estesa a 44px.

### 5.8 Table

Header: `--surface-sunken`, 10.5px uppercase `.06em`, `--ink-muted`, sticky.
Celle: separatore inferiore 1px `--hairline`. Colonne numeriche allineate a
destra con `tnum`. Zebra opzionale con `--surface-sunken`. Riga cliccabile: hover
`--brand-tint`, focus ring standard.

### 5.9 Chart

Griglia `--chart-grid` 1px. Serie nell'ordine `--chart-1..8`. Barra/riga
corrente `--chart-current`. Nessun gradiente di riempimento. Le etichette dei
valori sono Roboto `tnum`. Ogni serie ha una legenda testuale: il colore non è
mai l'unico canale.

### 5.10 Icon tile

Icone a linea, `viewBox 0 0 24 24`, `stroke-width: 1.75`, `stroke: currentColor`,
`fill: none`, linecap/linejoin `round`. Il tile è un quadrato con raggio
`--r-sm`, fondo `--brand-tint` e icona `--brand` (varianti tint/ink per esito).
Dimensioni: 40px in griglia, 34px in riga, 30px inline.

### 5.11 Navigation

Bottom nav: `--surface`, bordo superiore 1px `--hairline`, altezza 60px + safe
area. Voce attiva `--brand`, inattiva `--ink-muted`. Ogni voce ha icona + testo,
tap target ≥ 44px. Tab/segmented: contenitore `--surface-sunken`, selezionato
`--surface` + `--e1` + testo `--ink`.

---

## 6. Cosa non si fa

* Gradienti decorativi.
* Ombre colorate (l'ombra è neutra, aubergine trasparente).
* Emoji nell'interfaccia.
* Serif sui numeri.
* Bordi `--hairline` su controlli.
* Colori fuori dai token di § 2.5.
* Blocco "Da fare oggi" in Home, delta per-KPI, barra vs obiettivo, confronto
  mese-su-mese nel Cruscotto (pattern già scartati dalla titolare).

---

## 7. Aperto

Due punti riguardano lo storefront, non l'app, e non bloccano l'adozione:

1. Se Fraunces sia disponibile nel font picker del tema Symmetry (da verificare
   nell'editor tema Shopify, non nei file del tema).
2. Quale font usi oggi lo storefront (non risulta dai file di progetto).
