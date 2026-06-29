# Report verifica modifiche di stasera - amimi-app (29 giugno 2026)

Verificate una-per-una le 5 modifiche del round-4 sia leggendo il codice in `web/src/` sia osservandole dal vivo sul sito deployato (build round-4 confermata fresca: l'hub Registra non mostra piu' la tile Arrivo/Acquisto). Tutte le prove codice riportate sotto sono state ricontrollate direttamente: NumberStepper, toast, people.tsx, Ingest.tsx e api.ts corrispondono a quanto dichiarato. La lacuna di #4 (spinner nativi) e' stata riconfermata con grep dedicato: zero regole CSS di hiding in tutto `web/src`.

## Tabella riepilogo round-4

| # | Modifica | Implementata? | Verificata al browser? | Migliorabile? |
|---|----------|---------------|------------------------|---------------|
| 1 | Personalizzazione solo sulla Home (PersonaPicker rimosso da Registra/Ordini/Prodotti) | Si, completa | Si | Solo pulizia codice morto (non bug) |
| 2 | Tile Arrivo/Acquisto fuori da Registra (resta in Ordini) | Si, completa | Si | Si, residui orfani (`purchase`, PurchaseForm) |
| 3 | Reso con immagine prodotto + nome cliente | Si, completa | Si | Marginale (cosmetico) |
| 4 | Stepper +/- su quantita e prezzo (anche mobile) | Parziale | Si | Si, manca il CSS che nasconde gli spinner nativi |
| 5 | Toast di feedback su submit | Parziale | Si | Si, 2 form non migrati + accessibilita |

> Nota sul "Parziale" di #4 e #5: la richiesta principale dell'utente e' soddisfatta in entrambi (le freccette +/- sono visibili su mobile su tutti i form; i toast appaiono su quasi tutte le scritture). "Parziale" si riferisce a una meta' implicita non coperta (#4: nascondere gli spinner nativi anche su desktop) e a 2 form residui (#5).

## #1 - Personalizzazione confinata alla Home

**Esito.** Implementata e completa, coerente al 100% con il browser. Il `PersonaPicker` (pill Ale/Bene/Ginevra) e' renderizzato in un solo punto, `Home.tsx:41`; definizione in `people.tsx:45-53`. Nessun altro tab lo importa (`Ingest.tsx`, `Ordini.tsx`, `Prodotti.tsx` non referenziano `../lib/people` per il picker). Registra non filtra piu' le azioni: `Ingest.tsx:11-18` usa l'array statico `TIPI` identico per tutti, con commento esplicito a riga 10. La personalizzazione Home resta attiva (`Home.tsx:9` `PERSONA[chi]`, tiles e blocco finanze gated). Dal vivo: il picker compare solo sulla Home, assente su Registra/Ordini/Prodotti. Nessun bug.

**Possibili migliorie.**
- Rimuovere il prop `setChi` non usato dalle firme di `Ingest.tsx:21`, `Ordini.tsx:77`, `Prodotti.tsx:200` e dalle chiamate in `App.tsx:27-29` (codice morto, possibile warning TS `noUnusedParameters`). Effort S, valore medio, rischio basso.
- Aggiornare il commento obsoleto `people.tsx:2` ("Registra filters its actions too" contraddice il codice attuale). Effort S, valore basso, rischio nullo.
- Valutare la rimozione del campo `PERSONA[*].registra` ora non consumato da alcun tab. Effort S, valore basso, rischio basso (confermare prima che nessun altro modulo lo usi come ACL).

## #2 - Tile Arrivo/Acquisto fuori da Registra

**Esito.** Implementata e completa rispetto alla richiesta. `Ingest.tsx:11-18` espone esattamente le 6 tile osservate (Conta fisica, Reso/Cambio, Regalo/Vendita manuale, Movimento B2B, Nuovo prodotto, Spese); `PurchaseForm` non e' importato e non c'e' ramo `sel==='purchase'`. L'arrivo si registra effettivamente da Ordini, ma tramite un componente **diverso**: `ArrivoRow` (`Ordini.tsx:8-49` -> `setArrival` scoped sulla riga d'ordine), non `PurchaseForm`. Da chiarire: `PurchaseForm.tsx` non e' piu' referenziato da nessuna parte (componente orfano). Dal vivo: hub a 6 tile esatte, nessuna Arrivo/Acquisto.

**Edge case latente.** In `people.tsx` le liste `registra` di Ale (riga 12) e Ginevra (riga 34) contengono ancora `'purchase'`. Oggi e' dato morto perche' Ingest non filtra per persona; ma se in futuro un deep-link impostasse `param='purchase'` sul tab Registra, `cur` sarebbe `undefined` e si vedrebbe una schermata vuota ("<- undefined", nessun form). Non e' live oggi (la tile di Ginevra punta correttamente a `tab:'ordini'`).

**Possibili migliorie.**
- Rimuovere `'purchase'` dalle liste `registra` in `people.tsx` (righe 12, 34): elimina il rischio latente di schermata vuota. Effort S, valore medio, rischio basso (verificare non sia usato come ACL server-side).
- Eliminare il componente orfano `PurchaseForm.tsx`: la rimozione del solo file React e' sicura; lasciare il branch backend `writeApi('purchase')` finche' non si conferma che nessun altro client lo usa. Effort S, valore basso, rischio medio-basso.
- (Strutturale) Far derivare le tile di Ingest da `persona.registra` per avere una singola fonte di verita'. Effort M, valore medio, rischio medio: cambia il comportamento osservato (oggi tutti vedono 6 tile), da validare con l'utente.

## #3 - Reso con immagine prodotto + nome cliente

**Esito.** Implementata e completa, coerente al 100% con il browser. `api.ts fetchSalesByCodice` (righe 199-217): per qromo aggiunge `nome,cognome` e fa fallback su `'Vendita negozio'` (riga 213); per shopify risolve il cliente via `supabase.from('shopify_orders').select('order_id, customer_name')` in una Map e usa `cust.get(order_id) ?? lineitem_name ?? 'Ordine online'` (riga 215). `ReturnForm.tsx`: `Thumb` rende `image_url` con placeholder; Step2 mostra thumbnail + descrizione vendita + 🏬/🌐 + data + qty + prezzo; Step3 header `picked` con thumbnail + descrizione. Dal vivo: qromo cade su "Vendita negozio", shopify mostra nomi reali ("Vanessa Allasia", "Francesca Rossi") con globo Online, esattamente il ramo `cust.get(order_id)`. La foto e' del prodotto (corretto per design sale-anchored su singolo codice). Nessun bug.

**Possibili migliorie (marginali).**
- Il blocco shopify_orders e' gia' protetto da `if (oids.length)`: nessuna azione necessaria, citato solo per completezza.
- Quando `customer_name` e' null il fallback mostra `lineitem_name` (nome prodotto), ridondante con la thumbnail; una label tipo "Cliente non disponibile" sarebbe piu' chiara. Effort S, valore basso, rischio nullo (da validare prima se i casi null sono frequenti).

## #4 - Stepper +/- su quantita e prezzo

**Esito: PARZIALE.** Il componente `NumberStepper.tsx` esiste e funziona (bottoni `-`/`+` a L12/L15, `<input type=number>` a L13, clamp a `min` e arrotondamento in `adj()`). E' applicato a tutti gli 8 form a campo singolo: Reso (Quantita resa L96, Importo L112), Regalo (L59/L67), B2B (L55/L56, % negozio L59), Conta (L51), Nuovo prodotto (L88/L89), Spese (L38), Ordine (L39), Arrivo (PurchaseForm L58/L59). Dal vivo confermato: stepper custom su Reso e B2B, click `+` che porta 1->3. **La richiesta principale (freccette visibili su mobile) e' soddisfatta.**

**Lacuna confermata (meta' implicita della richiesta).** Il CSS che nasconde gli spinner nativi **non esiste**: grep su `appearance` / `inner-spin-button` / `outer-spin-button` / `spin-button` in tutto `web/src` = 0 match, nonostante il commento `NumberStepper.tsx:1` dichiari il contrario ("native spinners are hidden on mobile"). Su desktop Chrome/Edge/Firefox il campo mostra ANCORA le freccette native (su hover/focus) accanto ai bottoni custom = controlli duplicati; su mobile non si vedono per default, quindi la prova mobile non smaschera il problema, ma "nascondere i nativi" resta non fatto.

**Lacune secondarie.** Input `type=number` grezzi senza stepper in: `SupplierOrderForm.tsx:110/112` (carrello qty+costo), `Ordini.tsx:40` (qty arrivo inline), `Prodotti.tsx:45` (prezzo edit), `Report.tsx:333/334/341`. Edge-case logici: il typing scrive valore grezzo (L14) senza clamp ne' arrotondamento; nessun `max` (la % negozio 0-1 puo' superare 1.0 col `+`); `step`/`min` non passati all'`<input>`, quindi dove lo spinner nativo e' visibile incrementa di 1 ignorando lo step custom.

**Possibili migliorie.**
- **Aggiungere la regola CSS che nasconde gli spinner nativi** (richiesta esplicita non implementata). Mirare a `.stepper .num` per non toccare gli input fuori stepper: `input.num{-moz-appearance:textfield}` + `::-webkit-inner/outer-spin-button{-webkit-appearance:none;margin:0}`. Effort S, **valore alto**, rischio nullo.
- Clamp/arrotondamento anche sul typing (o on-blur) + prop `max`. Effort M, valore medio, rischio: clampare durante la digitazione puo' ostacolare; preferibile on-blur.
- Estendere lo stepper al carrello SupplierOrderForm e agli input inline (Ordini/Prodotti/Report), con variante compatta per le righe carrello. Effort M, valore medio, rischio medio (layout flex stretto `.qbox/.cbox`).

## #5 - Toast di feedback

**Esito: PARZIALE.** Il toast (`toast.ts:2-12`, CSS `index.css:110-115`) funziona ed e' adottato dalla quasi totalita' dei form di scrittura (B2B, Gift, Count, NewProduct, Expense, Order, SupplierOrder, Return, Purchase, SaleCorrect, sync inventario). Dal vivo confermato: toast rosso arrotondato "✕ Scegli il negozio" al salvataggio B2B senza negozio, nessuna scrittura a DB; il toast di successo usa lo stesso componente con classe verde `ok`. **Non migrati:** `Ordini.tsx ArrivoRow` (righe 13,18-21,44) e `Prodotti.tsx ProdEdit` (righe 25,28-33,59) usano ancora il box `msg err` inline e non danno alcun toast di successo (solo reload/onDone).

**Possibili migliorie.**
- Migrare `ArrivoRow` e `ProdEdit` al toast con feedback di successo (stesso pattern degli altri form). Effort S, **valore alto**, rischio minimo.
- Aggiungere `role`/`aria-live` al toast host (oggi assenti -> screen reader non annunciano esito): `role="alert"` per `err`, `role="status"` per `ok`. Effort S, valore medio, rischio nullo.
- Cap o dedup dei toast contemporanei (oggi click ripetuti li impilano). Effort S, valore basso, rischio basso.

## Giri precedenti di stasera (regressione)

Sweep degli 11 item dei giri precedenti: tutti **present** tranne uno **partial**, nessuna regressione live.

- Export per pagina = icona download (`ExportBtn`): present, su Inventario/Report/Ordini/Prodotti. Integro.
- ProductPicker nasconde i prodotti >90gg senza stock (toggle "Vecchi prodotti", rivelati dalla ricerca): present.
- NewProductForm: ricerca modello rivela i modelli vecchi nascosti di default: present.
- "Nei negozi" = lista piatta ordinata per ultima vendita, cliccabile, con data+importo: present.
- Inventario: tab Disponibilita' rimosso, "vendite perse" sparita (VIEWS = mag/riordino/neg/shop/valore): present.
- Shopify treemap con nota stock = magazzino-2: present.
- Magazzino = tabella di sintesi ordinabile, righe -> drawer: present.
- ITEM+VARIANTE su una riga nelle parti operative: present (eccezione voluta: card storica "Top prodotti" del Report).
- Ordini a card per fornitore, riga arrivo editabile (`arrival_set`), "+ Nuovo ordine fornitore": present.
- Stepper qty/prezzo: vedi #4 (coperti i form a campo singolo, scoperti carrello e input inline).
- **PARTIAL - Immagini prodotto box quadrato + object-fit cover:** il box e' quadrato (`.pimg` aspect-ratio 1/1, `.invimg/.tdimg` quadrati), ma il commit `cf88e43` ("contain images") ha cambiato deliberatamente `object-fit` da `cover` a `CONTAIN`. In `index.css:150-151` restano due regole `.pimg img` in conflitto (cover poi contain); vince `contain`, la riga con `cover` e' codice morto. Quindi immagini quadrate e non stirate ma "lettera-boxate", non riempiono il box. Scelta intenzionale del team post-429baa9; la spec "cover" non e' rispettata per scelta.

## Migliorie trasversali proposte (scout)

Ordinate per rapporto valore/effort.

**Valore alto / effort basso-medio**
- **Spinner nativi non nascosti** (`NumberStepper.tsx` + `index.css`): vedi #4. Una regola CSS chiude la richiesta esplicita. Effort S, valore alto.
- **Overflow orizzontale su Prodotti**: `.subtabs` (`Prodotti.tsx:207-209`, 4 bottoni) e' `display:flex` senza `overflow-x` ne' `flex-wrap` (`index.css:271`); a <=380px le label ("Correggi vendita" + "Da completare") eccedono i ~360px utili e causano lo scroll orizzontale di pagina segnalato. Fix: `overflow-x:auto` o `flex-wrap` (Inventory usa gia' `.seg.wrap` e non ha il problema). Effort S, valore alto.
- **Toast non annunciati dagli screen reader** (`toast.ts`): nessun `aria-live`/`role` in tutto `src`; fix in un solo punto copre tutte le scritture. Effort S, valore alto.
- **Stepper assente nel carrello SupplierOrderForm e nell'editor arrivi** (`SupplierOrderForm.tsx:110-113`, `Ordini.tsx:40`): proprio i due flussi piu' touch-intensive su mobile restano senza `-`/`+`. Effort M, valore alto.

**Valore medio**
- **NumberStepper non clampa il typing e non supporta `max`**: clamp/arrotondamento solo nei bottoni, non in `onChange` (L14); via tastiera la quantita' puo' finire a 0/negativa. Normalizzare on-change/on-blur + prop `max`. Effort M, valore medio.
- **B2BForm: % negozio senza `max=1`** (`B2BForm.tsx:59`, label "0-1"): bottoni e tastiera possono superare 1.0, inviato a `writeApi b2b` senza guard. Effort S, valore medio.
- **CSS duplicato/conflittuale**: `.supcard.alt` definita a `index.css:165` (accent) e di nuovo a `257` (rose) -> vince rose, accent morta; `.arrinline` a `99` (block) sovrascritta a `267` (flex). Consolidare. Effort S, valore medio.
- **Toast impilati senza cap ne' dedup** su submit ripetuti: possono coprire l'area di lavoro su schermo piccolo. Effort M, valore medio.
- **Pattern di feedback incoerente** (toast vs `.msg`/`.err` inline): vedi #5, uniformare. Effort M, valore medio.
- **Doppi submit ravvicinati**: `busy=true` settato dopo alcune guardie iniziali (`OrderForm`/`SupplierOrderForm`) e `setBusy(false)` non sempre in `finally`. Uniformare try/catch/finally. Effort M, valore medio.

**Valore basso**
- **Label stepper generiche** (`aria-label="meno"/"piu"` fissi senza contesto del campo): passare il nome campo o `aria-controls`. Effort S, valore basso.

## Priorita' consigliate

1. **Nascondere gli spinner nativi** (CSS in `NumberStepper`/`index.css`): chiude la meta' non implementata di #4, e' la richiesta esplicita, costo minimo. Effort S, valore alto.
2. **Fix overflow orizzontale `.subtabs` su Prodotti**: risolve lo scroll orizzontale segnalato dal vivo, una riga CSS. Effort S, valore alto.
3. **Migrare ArrivoRow e ProdEdit al toast con successo**: chiude il PARTIAL di #5 e uniforma il feedback. Effort S, valore alto.
4. **`aria-live`/`role` sul toast host**: accessibilita' per tutte le scritture con una sola modifica. Effort S, valore alto.
5. **Stepper nel carrello SupplierOrderForm e editor arrivi**: copre i flussi mobile piu' usati. Effort M, valore alto.
6. **Pulizia residui orfani**: `'purchase'` in `people.tsx:12/34`, `PurchaseForm.tsx`, prop `setChi` inutilizzato, commento obsoleto `people.tsx:2`. Effort S complessivo, valore medio, elimina rischio latente e codice morto.

Nota: **non e' stato modificato nulla** in questa sessione. Tutte le verifiche sono di sola lettura (codice + browser); l'applicazione delle migliorie resta in attesa dei commenti dell'utente da altra chat.
