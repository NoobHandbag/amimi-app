# Dossier — Pulizia dati pre-cutover (34 negativi + 14 orfani + CE_TOTALE)

> AGGIORNAMENTO 2026-07-04: ESEGUITO/SUPERATO. Negativi a 0 (SESSION 25-25b), orfani a 0 (SESSION 26), CE_TOTALE risolto in modo NATIVO (migr 0028, l'opposto dell'Opzione 1 qui raccomandata), cutover avvenuto il 2026-07-03. Documento storico di analisi. Stato corrente: amimi-app/docs/TRIGGER_MIGRAZIONE.md.

> Stato: **ANALISI, nulla modificato.** Data: 2026-06-29 (Claude Code). Fonte: query live su `v_inventory` / `supplier_orders` / `v_health`.
> Obiettivo: portare la Diagnostica al verde **prima** del cutover, con il metodo giusto per ogni categoria. NON è "aggiungi 34 acquisti": è un mix di cause che vanno trattate diversamente.
> Regola: per riconciliare serve l'**ULTIMO export del Master** (non uno snapshot vecchio). Vedi memoria `data_use_latest_export`.

---

## 1. I 34 prodotti con giacenza negativa

Una giacenza è negativa quando `acquisti − venduto < 0`. Dai dati, le cause sono **tre**, ognuna con un fix diverso.

### Cat. A — Vendite mal-codificate / prodotti fantasma (~14) → **ri-mappare la vendita**
Codici non canonici o duplicati: `variant` = nome modello, `item` nullo, o codice doppione di un prodotto reale. La vendita è stata attribuita a un codice-stub invece che al prodotto vero.

Esempi reali: `Lea_Bag_Maxi` (qromo 4, senza variante), `Agata_Bag_Paillettes_Black` (variant "Agata_Bag"), `Annie_Bag_Silk_Grey`, `Lea_Bag_Muccata_Nera` (item nullo), `Isabella_Hand_Warmer` (doppione di `Isabella_Hand_warmer_Burgundy_and_Light_Blue`), `Lea_Bag_Maxi_Asole`, `LEA_BAG_DARK_ZEBRA` (variant "Lea_Bag"), `ANNIE_BAG_BROWN_CHOCOLATE`, `Annie_Bag_Difetto`, `Airpodscase_Zebra`, `Lea_Bag_VERNICE_VIOLA`, `Nina_Bag_Maxi_Blue_Ocean`, `Charm`, `CHAIN_TIGER`.

- **Fix:** la **correzione vendita** già nell'app (Prodotti ▸ Correggi vendita / `sale_correct`): scegli la vendita, riassegnala al prodotto canonico. Il fantasma sparisce e il pezzo viene scalato dal prodotto giusto.
- **Master fresco?** No.
- **Mesi chiusi?** Sicuro: ri-mappare tra prodotti **non cambia** il fatturato né il COGS totale del mese, sposta solo a quale SKU è attribuito.

### Cat. B — Acquisto mancante su prodotto reale (~18) → **riconciliare col Master**
Codice canonico, `acquisti = 0`, ma ci sono vendite (gift/qromo/shopify). Il prodotto è stato venduto ma in app non c'è la riga di ACQUISTI.

Esempi: `Annie_Bag_Paillettes_Turquoise` (qromo 5), `Agata_Bag_Floral_Orange_Embroidery` (5), `Annie_Bag_SILK_PINK` (3), `Lea_Bag_Vernice_Blu` (3), `Annie_Bag_Black` (3), `Lola_Bag` + varianti (3+1+1), `Isabella_Scarf` (2), `Lea_Bag_ROSE`/`GREEN`/`Suede_Light_Grey`, `Nina_Bag_PISTACCHIO`/`PINK_BARBIE`, `Sveva_Bag_LIGHT_CHOCOLATE`, `Annie_Bag_LILAC`.

- **Fix:** col **Master fresco**, per ogni codice si controlla ACQUISTI. Due esiti: (1) **l'acquisto c'è nel Foglio ma non in app** → buco del seed, si aggiunge in app (`purchases`); (2) **manca anche nel Foglio** → buco vero, serve la conferma di Ale/Ginevra (quanti pezzi, quando, da chi) prima di inserirlo.
- **Master fresco?** **Sì, obbligatorio.**
- **Mesi chiusi?** Aggiungere un acquisto cambia valore di magazzino e COGS: per i mesi chiusi (apr/mag) va fatto con la stessa cautela del Foglio (data corretta, OK esplicito).

### Cat. C — Sovra-venduto pur con acquisti (~2) → **riconciliazione vera**
`acquisti > 0` ma comunque negativo: `Lea_Bag_ZEBRA` (acq 10, venduto 17 → −7; è un gotcha storico noto), `Annie_Bag_PAILLETTES_PINK` (acq 10, venduto 11 → −1).

- **Fix:** o manca un secondo acquisto (riordino non registrato → Master/conferma), o una vendita è doppia/mal-attribuita (→ Cat. A). Si guarda caso per caso.
- **Master fresco?** Sì.

**Riepilogo metodo:** prima la **Cat. A** (re-map, nessun Master, sblocca subito ~14 e non tocca il CE), poi **B/C** col Master fresco.

---

## 2. I 14 codici-ordine orfani

Sono righe in `supplier_orders` con un codice **non presente** in `products`. **Non toccano le giacenze** (l'inventario si calcola da `purchases`, non dagli ordini): è igiene, non un errore di stock. Tutti riconducibili a **prodotti nuovi / codici incompleti** del file Ordini:

- **6 doppio-prefisso** (mio import faithful dal file): `Agata_Bag_AGATA_BAG_ROSE_BUTTER`, `..._FLORAL_BORDEAUX_EMBROIDERY`, `..._ROSE_BUTTER_LILLA`, `..._EMBROIDERY_WHITE`, `..._ROSE_PINK`. → codice malformato nel file Ordini (doppio "AGATA_BAG"). Fix: correggere il codice in `supplier_orders` al canonico (es. `Agata_Bag_ROSE_BUTTER`) **oppure** creare il prodotto.
- **3 senza variante finale**: `Agata_Bag_`, `Annie_Bag_`, `Lea_Bag_x_Rita_`. → prodotti nuovi col codice ancora da chiudere (variante TBD). Normale in onboarding.
- **5 `Porta_carte_COCCO_*`**: linea **Porta carte** non ancora in anagrafica app. Fix: creare i 5 prodotti (o si creano da soli al primo "arrivo" registrato).

- **Master fresco?** No (basta il file Ordini, che ho già).
- **Severità reale:** bassa. La Diagnostica li segna `bad` ma sono cosmetici per lo stock; vale la pena sistemarli per pulizia e perché alcuni diventeranno prodotti veri.

---

## 3. CE_TOTALE — la decisione

Oggi nell'app **CE_TOTALE non è calcolato**: è copiato verbatim dal Foglio (`ce_totale_monthly`), e **Gennaio** è ricavo dell'azienda precedente (ereditato). CE_AMIMI invece è ricalcolato dalle transazioni (al centesimo feb/mar, ~1% apr/mag).

Per il cutover serve una scelta su CE_TOTALE:
- **Opzione 1 — Input mensile manuale (consigliata).** CE_TOTALE resta un dato inserito a mano una volta al mese (da Foglio/commercialista). Semplice, nessun rischio. L'app mostra "Totale" come riga importata.
- **Opzione 2 — Ricalcolo nativo.** L'app calcola anche CE_TOTALE dalle transazioni. Serve però portare in app **tutta l'attività non-Amimì** + il Gennaio ereditato: molto più lavoro, e parte di quei dati potrebbe non esistere in forma transazionale.

Raccomandazione: **Opzione 1** per il cutover (lo "0 a gennaio in Amimì, reale in Totale" resta corretto), valutare l'Opzione 2 solo dopo.

---

## 4. Metodo & sicurezza (per tutte le scritture)

- **preview → dry-run → real**, con OK esplicito prima del real (come le REGOLE_FERREE sul Foglio).
- **Verifica dei conteggi dopo ogni lotto** (è così che ho beccato l'esplosione 44→414 negli ordini).
- **Re-map vendite (Cat. A): neutro sul CE** → si può fare anche su mesi chiusi senza muovere i totali.
- **Aggiunta acquisti (Cat. B/C): muove magazzino+COGS** → mesi chiusi con cautela e OK.
- Tutto via `write-api` (service-role + `change_log`), niente scritture diceless.

---

## 5. Cosa serve da te (decisioni)

1. **Master fresco**: un export aggiornato di `Amimi_Master_2026_V2` per riconciliare la Cat. B/C (gli acquisti mancanti).
2. **CE_TOTALE**: Opzione 1 (input mensile) o 2 (ricalcolo)? *(consiglio: 1)*
3. **Cat. B "buchi veri"**: per i prodotti venduti ma mai acquistati nemmeno nel Foglio, mi servirà la conferma dei pezzi/data (non li invento).
4. **Porta carte + Agata nuove**: le creo come prodotti ora, o aspettiamo l'onboarding normale?

---

## 6. Piano d'azione consigliato (ordine)

1. **Cat. A — re-map** delle ~14 vendite fantasma (subito, nessun Master, CE invariato) → la Diagnostica scende già parecchio.
2. **14 orfani** — correggo i 6 doppio-prefisso + creo Porta carte (cosmetico, veloce).
3. **Master fresco** → **Cat. B/C** riconciliazione acquisti mancanti.
4. **CE_TOTALE** — applico la tua scelta.
5. Aggiungo alla Diagnostica un **check di freschezza** (alert se una fonte vendite non si aggiorna da N giorni) — nato dall'aver visto Shopify fermo al 24-06.

Stima: passi 1-2 in una sessione; passo 3 dipende dal Master e dalle conferme; passi 4-5 rapidi.
