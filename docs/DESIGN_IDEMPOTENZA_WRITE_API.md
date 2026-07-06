# Design: idempotenza server-side della write-api (audit B13 + B16)

> Documento di DESIGN, non ancora implementato. Scritto 2026-07-06 da Claude Code su richiesta owner,
> come brief di implementazione per una sessione futura. Chiude i reperti B13 (nessuna idempotenza
> server-side sugli insert) e B16 (arrival non atomico) dell'audit `audits/AUDIT_SYSTEM_2026-07-06.md`.
> Nessun segreto in questo file (repo pubblico).

## 1. Il problema, com'e' oggi nel codice

Il client (`web/src/lib/api.ts`, `writeApi()`) fa una singola `fetch` POST alla edge `write-api`.
I form hanno una guardia `busy` che disabilita il bottone MENTRE la richiesta e' in volo, ma:

- se la risposta si perde (rete mobile, timeout, tab sospesa) il client mostra errore e l'utente
  ritocca "salva". Il server pero' potrebbe aver GIA' scritto: il secondo tap duplica la riga.
- non c'e' service worker ne' coda offline: il rischio non e' un retry automatico, e' il re-tap umano.
- `write-api` non ha alcun riconoscimento di replay: ogni POST che passa la validazione inserisce.

L'unica azione oggi replay-safe e' `qromo_sale` (dedup su `sale_id` + UNIQUE parziale migr 0036),
piu' `count` che e' self-healing per costruzione (delta ricalcolato server-side sulla giacenza live,
quindi un secondo count SEQUENZIALE converge a delta 0; il doppio invio CONCORRENTE resta scoperto).

B16 e' il caso peggiore della stessa famiglia: `arrival`/`arrival_set` fanno UPDATE su
`supplier_orders.qty_arrived` e POI un INSERT su `purchases` di cui **l'errore non viene letto**
(`index.ts` righe 102-106 e 130-135). Se l'insert fallisce: ordine segnato arrivato, stock mai
aumentato, change_log verde. Se invece il client ritenta dopo risposta persa: qty_arrived gonfiato
E purchase duplicato.

## 2. Principio del design

**Un token di operazione (`op_id`, UUID v4) generato dal client per ogni submit LOGICO, con
vincolo UNIQUE parziale in DB come backstop atomico.** Tre proprieta' volute:

1. **Replay = successo, non errore.** Un secondo POST con lo stesso `op_id` risponde
   `200 { ok: true, duplicate: true, id }`: per l'utente il salvataggio "e' riuscito" (perche' lo e').
2. **Il DB e' l'arbitro.** Il check applicativo (SELECT-first) e' solo la via veloce; la garanzia
   e' l'indice UNIQUE + gestione del 23505. Niente finestre TOCTOU come quella che aveva `qromo_sale`
   prima della 0036.
3. **Il replay ripara i parziali.** Se la prima richiesta e' morta a meta' (riga padre scritta,
   riga figlia no), il replay COMPLETA il lavoro mancante invece di rifiutare. Vedi return e arrival.

Alternative valutate e scartate:
- **Ledger centrale `write_ops` con stato in_flight/done**: gestisce anche i flussi multi-statement,
  ma introduce stati orfani (claim scritto, lavoro non fatto, o viceversa) che richiedono janitor e
  finestre di staleness. A volumi single-shop e' complessita' senza beneficio rispetto a UNIQUE per tabella.
- **RPC plpgsql transazionale per ogni flusso**: la soluzione "oro" (atomicita' vera), ma significa
  portare 6 flussi da TypeScript a plpgsql: sproporzionato ora. Il design qui sotto ottiene
  idempotenza + auto-riparazione senza transazioni cross-statement. Resta la via se in futuro si
  aggiungono flussi davvero multi-tabella complessi.
- **UNIQUE su chiavi naturali**: impossibile per purchases/gifts/expenses: due acquisti identici lo
  stesso giorno sono legittimi. Solo il token distingue "ripetizione voluta" da "retry".

## 3. Tassonomia delle azioni e meccanismo per ciascuna

| Azione | Scritture | Rischio replay oggi | Meccanismo |
|---|---|---|---|
| `purchase` | INSERT purchases | duplica stock + COGS | `op_id` UNIQUE |
| `gift` | INSERT gifts_offline | duplica (stock + CE) | `op_id` UNIQUE |
| `b2b` | INSERT b2b_movements | duplica movimento | `op_id` UNIQUE |
| `expense_manual` / `expense_propose` | INSERT expenses | duplica costo nel CE | `op_id` UNIQUE |
| `return` | INSERT returns + INSERT stock_adjustments (se cambio) | duplica reso E doppio scalo del sostituto | `op_id` UNIQUE su returns + riparazione figlio (vedi 4.3) |
| `order` | INSERT supplier_orders | duplica riga ordine | `op_id` UNIQUE |
| `order_multi` | INSERT supplier_orders xN + upsert stub products | duplica l'intero gruppo | `gruppo = op_id` + SELECT-first (vedi 4.4) |
| `arrival` / `arrival_set` | UPDATE supplier_orders + INSERT purchases | B16 + duplica purchase e rigonfia qty_arrived | `op_id` UNIQUE su purchases + qty_arrived RICALCOLATO (vedi 4.5) |
| `count` | INSERT counts + INSERT stock_adjustments | doppio invio concorrente applica il delta due volte | `op_id` UNIQUE su counts (il figlio e' gia' legato via count_id) |
| `qromo_sale` | INSERT qromo_sales | 23505 dal UNIQUE 0036 esce come 400 al forwarder | mappare 23505 su `{ ok, skipped }` (vedi 4.6) |
| `product` | INSERT products | UNIQUE su codice: errore rumoroso, nessun silenzio | opzionale: 23505 su codice come `duplicate: true` |
| `product_verify`, `expense_approve`, `sale_correct`, `reorder_archive` | UPDATE | idempotenti per natura (stesso stato finale) | nessun op_id, documentato qui |
| `order_delete` | DELETE | secondo giro: 404, nessun danno dati | nessun op_id |

## 4. Design dettagliato

### 4.1 Migrazione (una sola, additiva, non-breaking)

```sql
-- 00xx_write_api_idempotency.sql
alter table purchases        add column if not exists op_id uuid;
alter table gifts_offline    add column if not exists op_id uuid;
alter table b2b_movements    add column if not exists op_id uuid;
alter table expenses         add column if not exists op_id uuid;
alter table returns          add column if not exists op_id uuid;
alter table supplier_orders  add column if not exists op_id uuid;
alter table counts           add column if not exists op_id uuid;

create unique index if not exists purchases_op_id_uq       on purchases (op_id)       where op_id is not null;
create unique index if not exists gifts_offline_op_id_uq   on gifts_offline (op_id)   where op_id is not null;
create unique index if not exists b2b_movements_op_id_uq   on b2b_movements (op_id)   where op_id is not null;
create unique index if not exists expenses_op_id_uq        on expenses (op_id)        where op_id is not null;
create unique index if not exists returns_op_id_uq         on returns (op_id)         where op_id is not null;
create unique index if not exists supplier_orders_op_id_uq on supplier_orders (op_id) where op_id is not null;
create unique index if not exists counts_op_id_uq          on counts (op_id)          where op_id is not null;

-- riparazione figli (4.3): il cambio-merce lega l'adjustment al reso, come counts fa con count_id
alter table stock_adjustments add column if not exists return_id uuid;
create index if not exists stock_adjustments_return_id_idx on stock_adjustments (return_id) where return_id is not null;

-- ricalcolo arrivi (4.5): il purchase generato da un arrivo conosce la sua riga ordine
alter table purchases add column if not exists order_id uuid;
create index if not exists purchases_order_id_idx on purchases (order_id) where order_id is not null;

-- order_multi replay (4.4)
create index if not exists supplier_orders_gruppo_idx on supplier_orders (gruppo);
```

Indici parziali `where op_id is not null`: i NULL (tutte le righe storiche + ogni chiamata senza
token) non partecipano al vincolo. Zero impatto sui dati esistenti. NB filosofia schema (SCHEMA.md
§ intro): niente FK strette, `return_id`/`order_id` sono nullable e senza foreign key, coerenti col resto.

### 4.2 write-api: struttura comune

Nel body arriva un campo top-level opzionale `op_id` (accanto ad `action`/`payload`/`pin`/`chi`/`force`).

1. **Validazione**: se presente e non conforme a UUID, `422`. Se assente: comportamento identico a
   oggi (retrocompatibilita' totale: `cowork_amimi.py`, tests, MCP, forwarder non cambiano).
2. **Lookup precoce (via veloce)**: PRIMA di ogni gate (incluso `closedMonth`), `select id from
   <tabella target> where op_id = X`. Se trovato: `200 { ok: true, duplicate: true, id }` subito.
   Questo punto e' sottile e importante: se l'operazione originale e' passata e POI il mese e' stato
   chiuso, il replay NON deve prendere il 409 mese-chiuso: e' una rilettura, non una scrittura.
3. **Insert col token**: la riga include `op_id`. In caso di errore Postgres `23505` con constraint
   `*_op_id_uq`: e' un replay concorrente che ha perso la corsa. Rileggere la riga per op_id e
   rispondere `duplicate: true`. Un 23505 su ALTRI constraint (es. `products.codice`) resta un errore
   applicativo e va riportato come oggi.
4. **change_log**: sul replay NON si logga (change_log registra mutazioni avvenute, e il replay non
   muta nulla). La riga originale e' gia' loggata.

### 4.3 `return` con cambio merce: replay che ripara

Flusso: INSERT returns, poi (se `sostituito_con`) INSERT stock_adjustments con `qty_delta: -qty`.
Oggi un crash tra i due insert perde per sempre lo scalo del sostituto (fratello di B16).

Col design: l'adjustment porta `return_id = <id del reso>` (e lo stesso `op_id`, non-unique, solo
per tracciabilita' in change_log). Sul replay (lookup precoce trova il reso):

- se il reso ha `sostituito_con` valorizzato E non esiste `stock_adjustments where return_id = <id>`:
  **completare l'adjustment mancante ora**, poi rispondere `duplicate: true, repaired: ['sostituzione']`.
- altrimenti: `duplicate: true` semplice.

Il replay diventa il meccanismo di riparazione dei parziali, senza janitor ne' transazioni.

### 4.4 `order_multi`: il gruppo e' il token

`order_multi` inserisce N righe: un UNIQUE su `op_id` per-riga non puo' funzionare. Ma il flusso ha
gia' un identificatore di gruppo: oggi `gruppo = crypto.randomUUID()` generato dal SERVER. Il design
lo sposta al client: **`gruppo = op_id`**.

- Lookup precoce: `select count(*) from supplier_orders where gruppo = op_id`. Se > 0: replay,
  rispondere `duplicate: true` con il gruppo e il conteggio righe esistente. (Le colonne `op_id`
  delle righe restano NULL: il vincolo per-riga vale solo per l'azione `order` singola.)
- Gli stub products sono gia' idempotenti (`upsert onConflict codice ignoreDuplicates`), nessun cambio.
- Residuo accettato: due POST CONCORRENTI (stesso op_id, doppia corsa perfetta) potrebbero passare
  entrambi il SELECT-first. Per un form usato da una persona alla volta il caso reale e' il re-tap
  DOPO l'errore, che il SELECT-first copre al 100%. Se si vuole chiudere anche la corsa perfetta:
  UNIQUE parziale su `(gruppo, codice)`; non lo metto nel design base perche' vieterebbe due righe
  legittime stesso codice nello stesso ordine (es. stesse borse, due date consegna).

### 4.5 `arrival` / `arrival_set`: inversione dell'ordine + qty_arrived ricalcolato (chiude B16)

Ridisegno del flusso (entrambe le varianti):

1. **INSERT purchases PRIMA** (con `op_id` e `order_id = <riga ordine>`), **controllando l'errore**
   (oggi non viene letto: e' il cuore di B16). Se 23505 su op_id: replay, vai al punto 3.
2. **UPDATE supplier_orders DOPO**, ma non piu' read-modify-write: `qty_arrived` si RICALCOLA come
   `sum(purchases.quantita) where order_id = <riga>`. Per `arrival` (incrementale) e `arrival_set`
   (delta verso il target) la somma dei purchases E' il totale arrivato: le due semantiche convergono
   sulla stessa formula.
3. **Replay o crash a meta'**: in entrambi i casi si riesegue solo il punto 2 (ricalcolo + update),
   che e' idempotente per costruzione. Un crash dopo l'insert e prima dell'update lascia lo stock
   GIUSTO (purchases c'e') e la riga ordine indietro di un arrivo: visibile in UI e sanato dal
   replay o dal prossimo arrivo. E' l'inversione deliberata del fallimento di B16: meglio sbagliare
   il lato vetrina (qty_arrived, cosmetico e auto-sanante) che il lato soldi (stock/COGS).
4. La risoluzione WIP (`wip -> false`, `qty_ordered = target`) e l'aggiornamento `costo_unitario`
   restano nell'UPDATE del punto 2, invariati.

Nota migrazione dati: le righe purchases storiche da arrivi (source `app-arrivo`/`app-arrivo-edit`)
hanno `order_id` NULL e non entrano nel ricalcolo. Per non far regredire i totali, il ricalcolo
usa `qty_arrived = greatest(valore attuale colonna, somma dei purchases con order_id)` SOLO in
transizione, oppure (piu' pulito) un backfill one-shot di `order_id` non e' possibile (il legame
storico non esiste): quindi la formula operativa e' `qty_arrived_nuovo = qty_arrived_legacy_frozen +
sum(purchases con order_id)`. Implementazione concreta: congelare il valore corrente in una colonna
`qty_arrived_legacy` al momento della migrazione e far diventare qty_arrived la somma. Da validare
in implementazione contro le righe aperte reali (oggi poche: gli ordini attivi si contano sulle dita).

### 4.6 `qromo_sale`: normalizzare il 23505

Il dedup SELECT-then-INSERT resta (via veloce), ma dopo la 0036 una corsa persa produce un 23505 che
oggi esce come `400 { error }` verso il forwarder. Mappare: 23505 su `qromo_sales_live_saleid_uq`
diventa `200 { ok: true, skipped: true, sale_id }`, identico alla via veloce. (Il webhook `qromo-webhook`
v4 gia' gestisce il suo 23505; questa e' la stessa cortesia sul path write-api.)

### 4.7 Frontend: ciclo di vita del token

Regola: **un op_id per submit logico, non per tentativo HTTP.**

- Generato al primo tap su "salva" (`crypto.randomUUID()`), tenuto in un ref del form.
- Riusato tale e quale se il submit fallisce e l'utente ritocca (il caso B13).
- Rigenerato: (a) dopo un successo (`ok: true`, anche `duplicate: true`), pronto per il prossimo
  inserimento; (b) se l'utente MODIFICA un campo dopo un errore (a quel punto e' un'operazione
  logicamente nuova).
- Implementazione suggerita: hook `useOpId()` in `web/src/lib/` che incapsula le tre regole, usato
  dai form al posto della chiamata diretta; `writeApi()` guadagna un parametro opzionale `opId`.
- UX sul replay: trattarlo come successo; toast tipo "Gia' registrato (doppio invio evitato)" se
  `duplicate: true`, cosi' il comportamento e' osservabile e non misterioso.

### 4.8 Rollout (ordine sicuro, ogni passo retrocompatibile)

1. Migrazione (colonne nullable + indici parziali: nessun effetto su scritture esistenti).
2. Deploy write-api vNext (accetta `op_id` opzionale; senza token, comportamento odierno).
3. Deploy web (i form inviano `op_id`).
4. Aggiornare `integrations/cowork_amimi.py` perche' generi anch'esso op_id (secondo tempo, non blocca).
5. Test di regressione: vedi `TEST_INVARIANTS.md`, famiglia DUP (ogni azione: stesso op_id due volte,
   asserire 1 sola riga + `duplicate: true` sul secondo; arrival: crash simulato tra insert e update,
   replay ripara; return con sostituto: replay completa l'adjustment mancante).

## 5. Cosa resta fuori (esplicito)

- **Concorrenza vera simultanea su `count`** (due submit dello stesso codice nello stesso istante da
  due device): op_id copre il retry della STESSA operazione, non due conte indipendenti concorrenti.
  Resta la posizione documentata nel codice (single shop + busy-guard + la conta successiva
  auto-sana). Il test di carico relativo e' nel catalogo invarianti come gap G1.
- **Idempotenza di `shopify-stock` / `shopify-sync`**: fuori scope, hanno gia' semantiche proprie
  (specchio/upsert per order_id).
- **Ledger `write_ops` e RPC transazionali**: scartati sopra, riaprire solo se nascono flussi
  multi-tabella piu' complessi di return/arrival.
