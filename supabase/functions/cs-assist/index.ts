// cs-assist — tool assistenza clienti, FASE 3/4-lite: recupero DATI + riassunto/storia + bozze.
// v24 (2026-08-01 notte, brief cs_assist_migliorie sezione "ESITO GIRO 2", spec v17): SCHEMA RAMI,
//   dietro `app_flags.cs_rami_enabled` (nasce a FALSE). Al posto di tre varianti di TONO della
//   stessa risposta, fino a tre ALTERNATIVE DI CONTENUTO = gli esiti possibili della richiesta,
//   ognuna col suo titolo di massimo 5 parole, una sola dove i dati decidono. Dove la verita' la sa
//   solo il team, la scelta della collega E' la risposta: risolve per costruzione anche le
//   concessioni inventate (il ramo "omaggio" esiste, ma parte solo se una persona lo sceglie).
//   Punti 1, 2, 4, 5 della spec. Il tetto del primo giro sale a 6000 su ENTRAMBI gli schemi (sonda
//   di varianza 01-08: 1.572 token di solo ragionamento in media, che su questo endpoint contano
//   dentro maxOutputTokens).
// v25 (2026-08-01 notte, punto 3 della spec, eseguito su decisione esplicita dell'owner dopo il
//   referto): `computeCaso`/`case_data` restituiscono l'ELENCO dei rami ammessi (`casoRami`) invece
//   del verdetto secco, e a schema rami il prompt riceve `casoBlockRami` con i titoli FISSI, cosi'
//   `cs_drafts.ramo_scelto` diventa un dataset con una chiave stabile. Nessun ramo e' inventato:
//   sono tutti gia' dentro il testo che `casoBlock` produce oggi, solo schiacciati in una riga.
//   SCOSTAMENTO DICHIARATO, e va rimisurato: questo pezzo NON era nella configurazione che ha vinto
//   il giro 2 alla cieca (li' il blocco CASO era quello di produzione, verbatim, parola
//   "vincolante" compresa). L'ho segnalato all'owner, che ha scelto di farlo comunque.
//   A flag spento `casoBlock` resta intatto e il prompt e' byte per byte quello di prima.
// v23 (2026-08-01 notte, brief cs_reply_to_fonte_indipendente): la guardia cross-cliente di draft e
//   refine usa lo stesso `emailCliente` di cs-send, e quel blocco ora legge anche
//   `cs_messages.reply_to` (migr 0100), fonte che non passa dal corpo del messaggio. Copia
//   IDENTICA nelle due edge, impronta confrontata da `tests/cs_convkey.mjs`.
// v22 (2026-08-01 notte, segnalazione di un'altra sessione dalla prova A VIDEO): il rilevamento del
//   troncamento della v19 dava FALSI POSITIVI sulle bozze scritte bene, perche' la firma di casa
//   "Grazie, Team Amimi'" finisce con una lettera e la regola voleva punteggiatura o emoji. Ora una
//   chiusura riconosciuta (la firma, "a presto", "thanks"...) vale quanto un punto. Difetto mio,
//   trovato da chi ha guardato lo schermo: le fixture non potevano vederlo, perche' i quattro casi
//   reali di bozza tagliata che avevo usato come input erano tutti veri troncamenti.
// v21 (2026-08-01 notte, brief cs_form_thread_merge, difesa in profondita): DUE CLIENTI NELLA
//   STESSA CONVERSAZIONE = NESSUNA BOZZA. Due invii dal modulo del sito nello stesso minuto
//   producono notifiche con oggetto identico, Gmail le accoda nello stesso thread e cs-sync ne fa
//   una conversazione sola: la bozza nascerebbe dal TESTO di una cliente e dai DATI dell'altra
//   (ordine, storico acquisti, email), perche' il testo viene dall'ultimo messaggio mentre
//   `customer_email` e `order_number` vengono dalla RIGA conversazione. La guardia del v11 non
//   scatta, perche' un'email c'e': e' solo di un'altra persona. Ora `draft` e `refine` rispondono
//   422 con l'elenco degli indirizzi, e `context` mostra il contesto (leggere serve) con l'avviso
//   in testa ai gap. `emailCliente` e' copia DICHIARATA e identica di quella di cs-send v4: le due
//   edge non condividono moduli, e la fixture ne confronta l'impronta per accorgersi se divergono.
// v20 (2026-08-01 notte, brief cs_assist_migliorie punto 4): fra i prodotti candidati entrano quelli
//   dell'ORDINE VERIFICATO, comunque la cliente li abbia scritti. Il brief proponeva di allargare il
//   match alle sole parole della VARIANTE: riprovato sui due casi reali che cita, non ne risolve
//   nessuno e peggiora le cose (dettaglio sopra `matchProducts`). Il dato certo era sotto il naso:
//   `shopify_line_items.codice_norm` dice quale borsa ha in mano, e non si indovina. Vincolo di
//   riservatezza: i codici si leggono SOLO dopo la guardia che verifica che l'ordine sia suo, mai
//   da un ordine agganciato al solo numero citato nel testo.
// v19 (2026-08-01 notte, brief cs_bozze_troncate + cs_faq_indirizzo_e_link_resi problema 2):
//   - SEGNAPOSTO DI LINK PER TIPO. `[link resi]` (cs_faq id 13) non era coperto dalla regex del v15
//     ed e' arrivato TALE E QUALE nella mail a una cliente ("Tutte le istruzioni sono disponibili su
//     [link resi]", caso reale T6 del 01-08). Ora il segnaposto si riconosce per forma e si risolve
//     per TIPO: resi -> `app_flags.cs_link_resi_url` (migr 0096, la pagina policy del sito, che
//     l'owner puo' cambiare senza deploy), tracking -> l'URL gia' calcolato, prodotto -> la scheda
//     del MIGLIOR match. Mai un tipo al posto di un altro: sarebbe il difetto che il v15 aveva gia'
//     corretto una volta. Senza URL si degrada a [DA VERIFICARE: ...]. In piu' una CINTURA finale:
//     ogni altro segnaposto rimasto ([nome], [misure], [dettaglio]...) diventa [DA VERIFICARE: ...],
//     quindi entra nel conteggio del guardrail e nel dialog di conferma invece di sembrare testo.
//     Cambio dichiarato rispetto al v15: il segnaposto senza URL non viene piu' CANCELLATO dal
//     testo generato (spariva anche il segnale che li' mancava qualcosa), viene marcato.
//   - BOZZE TRONCATE. Due generazioni indipendenti sulla stessa conversazione inglese sono uscite a
//     145 e 137 caratteri, tagliate a meta' parola, con 1 opzione invece di 3; in tutto lo storico
//     sono 5 casi, anche italiani, anche dopo l'aumento del tetto da 1400 a 2400 del 24-07. Tre
//     mosse: (a) STRUMENTAZIONE, che il brief indica come prima cosa da fare e vale piu' di ogni
//     ipotesi - `finishReason` e i token (thinking incluso) finiscono in `cs_events` e nella
//     risposta; (b) RITENTATIVO: se il JSON non rende tre opzioni complete, o il modello dichiara
//     MAX_TOKENS, si riprova UNA volta con 8000 prima di degradare; (c) MAI IN SILENZIO: una bozza
//     che non finisce con punteggiatura o emoji esce marcata `troncata` e la UI lo dice. Alzati
//     anche i tetti del ripiego singolo (1000 -> 2000) e di `refine` (800 -> 2000), che erano sotto
//     la soglia di troncamento osservata.
// v18 (2026-08-01 notte, brief cs_assist_migliorie punti 8 e 10, aggiunta dopo la run post_v16):
//   - NIENTE VERDETTO SULLA FINESTRA SE L'ORDINE E' GIA' RIMBORSATO. `computeCaso` guardava solo
//     la data dell'ordine: sull'ordine #1499 (rimborsato, annullato e mai partito) calcolava 15
//     giorni contro 14 ed emetteva 'fuori', che il blocco CASO dichiara "vincolante", e tutte e tre
//     le bozze rifiutavano il reso a una cliente GIA' rimborsata. Ora `financial_status`
//     refunded / partially_refunded / voided (e lo stato TWS pre-ritiro, cioe' merce non ancora
//     partita) producono verdetto 'non_applicabile' con una riga di caso dedicata: si riconosce il
//     rimborso, non si parla di finestra. Un verdetto calcolato su input parziali e poi dichiarato
//     non discutibile e' piu' pericoloso di nessun verdetto.
//     SCOSTAMENTO dal brief, motivato: il brief chiedeva la stessa regola per "ordine mai evaso",
//     cioe' `fulfillment_status` diverso da fulfilled/partial. Non e' percorribile: 180 ordini su
//     615 sono 'unfulfilled' e sono TUTTI fra il 18-02 e il 19-05 (zero righe in `shipping_status`),
//     mentre gli ordini davvero non ancora evasi di oggi hanno la colonna NULL (11 righe, dal
//     17-07). La colonna cambia significato da un'era di ETL all'altra: usarla avrebbe spento il
//     verdetto su 180 ordini storici quasi certamente consegnati. Lo stato TWS pre-ritiro e' invece
//     un'affermazione viva del corriere, ed e' il segnale che il caso #1499 aveva davvero.
//   - LINGUA: le conversazioni `en` (110 su 305) aprivano con "Ciao <nome>!" e proseguivano in
//     inglese. La lingua era una riga qualsiasi in fondo al messaggio utente: ora e' un'istruzione
//     esplicita nel system prompt di draft e refine, con l'eccezione dichiarata della firma
//     "Grazie, Team Amimi'", che resta in italiano per scelta.
// v17 (2026-08-01 sera, brief cs_assist_migliorie dal benchmark bozze): quattro correzioni, le
//   prime due su dati che arrivavano sbagliati alle clienti.
//   - ORDINE TROVATO ANCHE PRIMA DEL 01-07: `lookupOrder` filtrava solo `order_number`, NULL su 433
//     righe storiche, e il ramo di ripiego sull'email non scatta mai se un numero c'e' ma non
//     trova nulla. Risultato: "nessun ordine trovato" su ogni ordine anteriore al 01-07, e con lui
//     niente tracking, niente stato spedizione, nessun verdetto sulla finestra del reso. La migr
//     0095 ha colmato il buco nei dati; qui c'e' il secondo tentativo su `order_id` come difesa.
//   - LA DATA DI CONSEGNA NON SI INVENTA: `shipping_status.delivered_at` registrava quando il SYNC
//     aveva visto la consegna, non quando il corriere aveva consegnato, e al caricamento iniziale
//     tutte e 198 le spedizioni gia' consegnate avevano preso la data di quel giorno. La v16 la
//     scriveva nel BLOCCO DATI e la bozza la riportava alla cliente ("consegnata in data
//     2026-08-01" per un pacco arrivato il 10/07, peggio della risposta umana su un dato di fatto).
//     La colonna e' ora `seen_delivered_at` (migr 0095), si valorizza solo sulle transizioni
//     osservate, e qui passa un controllo di PLAUSIBILITA' (non prima della spedizione, non nel
//     futuro) prima di poter finire in una frase. Senza data ci si ferma a "CONSEGNATA".
//   - IL RIPIEGO A BOZZA SINGOLA NON E' PIU' MUTO: tetto token della `draft` da 2400 a 4000 (una
//     risposta si e' interrotta a meta' della seconda opzione) e `fallback_singola` nella risposta.
//   - DATE IN ITALIANO nel BLOCCO DATI (gg/mm/aaaa): le bozze scrivevano "2026-08-01" perche' e'
//     cosi' che le leggevano. Neutro per il linter, che normalizza i due formati sulla stessa chiave.
// v16 (2026-08-01, brief stato_tws_in_app): lo stato VERO del corriere entra nelle bozze.
//   `shipping_status` (migr 0086, scritta dal sync spedizioni via edge shipping-status-sync)
//   viene letta per l'ordine verificato: BLOCCO DATI con "STATO SPEDIZIONE TWS: ..." (+ fonti),
//   e nel motore dei verdetti del caso INDIRIZZO lo stato TWS decide da solo:
//   CONSEGNATA -> 'consegnato' SENZA conferma manuale (delivered_at da shipping_status se noto;
//   priorita': conferma della collega > TWS > shipment_status Shopify approssimato);
//   NUOVA / IN ATTESA DI AFFIDO (pre-ritiro) -> 'correggibile' ANCHE a fulfillment presente
//   (prima indistinguibile). Tabella vuota o ordine senza LDV = comportamento identico a prima.
//   `case_data` espone stato_tws (+ updated_at) per la card della UI.
// v15 (2026-08-01, brief cs_link_prodotto_torna_disponibile): il LINK della scheda prodotto entra
//   nel BLOCCO DATI. Per ogni prodotto agganciato con riga in `shopify_catalog` (94/94 con handle)
//   si costruisce `url` = SITE_URL + /products/ + handle (join case-insensitive su upper(codice),
//   Regola Ferrea 4: catalogo in Title_Case legacy, v_inventory MAIUSCOLO). I segnaposto di LINK
//   delle risposte standard ([link], [link prodotto], [product link]) sono gli unici che il modello
//   non puo' riempire: li risolve il CODICE prima del prompt (url reale se c'e', altrimenti
//   [DA VERIFICARE: link scheda prodotto] — mai promettere "sulla pagina del prodotto" a vuoto).
//   Safety net deterministico sui testi generati: un segnaposto link sopravvissuto viene risolto o
//   rimosso; ogni altro token [tra parentesi] non-DA VERIFICARE finisce in non_grounded (evidenziato
//   in UI). Prodotto esaurito ma a catalogo: il BLOCCO DATI dice esplicitamente che sulla scheda
//   c'e' il bottone "Avvisami quando torna disponibile" (form Klaviyo live dal 19-06, non si tocca).
//   In piu': allineato il flag rinominato dalla migr 0084 (`cs_ai_model` -> `cs_ai_model_claude`,
//   residuo dichiarato del brief cs_ai_model_allineamento: la v14 leggeva una chiave morta).
// v14 (2026-07-31 sera, richiesta owner "contesto massimo" + valori riconfermati dal sito):
//   - THREAD INTERO nel prompt (ultimi 30 messaggi, prima 4): su conversazioni lunghe l'AI
//     perdeva l'inizio; col piano Gemini a pagamento il costo e' spiccioli.
//   - CONOSCENZA DI CASA nel prompt: tabella `cs_knowledge` (migr 0082, pattern app_guides,
//     editabile senza redeploy) = tono di voce, valori operativi correnti (fonte unica), criteri
//     di escalation + linee guida della categoria. Entra anche nel corpus del linter (14, 3.90,
//     gli indirizzi ecc. sono fatti consentiti, non "numeri inventati").
//   - CONVERSAZIONI PRECEDENTI dello stesso cliente (riassunti, max 5) nel prompt della bozza:
//     l'AI sa se ha gia' chiesto resi/cambi/solleciti.
//   - RESO: finestra 14 giorni dalla DATA DELL'ORDINE (decisione owner 31-07, allineata al sito;
//     prima 15 dalla consegna): il verdetto entro/fuori si calcola da created_at_shop dell'ordine,
//     quindi e' SEMPRE disponibile quando l'ordine e' verificato (niente piu' data di consegna da
//     confermare a mano per il reso; delivered_at resta per il caso indirizzo).
// v13 (2026-07-31, brief redesign thread + body_clean, Parte A punto 5): la cronologia passata al
//   modello (draft/refine/summary) e il testo per match prodotti/caso usano `body_clean` (migr 0081,
//   fallback body_text: mai perdere contesto); il CORPUS del linter di aderenza resta sul RAW
//   (body_text): un numero presente solo nella citazione (es. totale ordine) resta un fatto
//   consentito e non diventa un falso positivo "non nel gestionale". Decisione dichiarata nel
//   changelog CODE. In piu': `created_at_shop` esposto nell'ordine del context (card Ordine UI).
// v12 (2026-07-31 notte, richiesta owner): FALLBACK Claude -> Gemini nell'uso NORMALE dell'app.
//   Se Claude e' configurato ma fallisce (credito API a zero, outage), la bozza NON muore: si
//   ripiega su Gemini, `cs_drafts.model` registra il modello REALMENTE usato e la risposta porta
//   `engine_fallback`. Con `model_override` attivo il fallback resta SPENTO: un A/B che ripiega
//   in silenzio e' un confronto falsato (deve fallire rumorosamente).
// v11 (2026-07-31, brief contesto risposte out, punti 4-7):
//   - richieste in INGLESE: le risposte standard entrano nel prompt con `testo_en` (fallback
//     testo_it se vuoto); gli esempi di tono restano IT (0/6 hanno testo_en: lacuna di contenuto
//     dichiarata, la colma Cowork con l'owner, non si inventano).
//   - esempi di tono ORDINATI per categoria della conversazione (prima i suoi, poi gli altri fino
//     al cap 6, prima erano in ordine di id) e passati ANCHE a `refine` (prima il tono spariva
//     alla prima richiesta di modifica).
//   - FAQ trasversali: le righe cs_faq con categoria NULL entrano SEMPRE (prima una conversazione
//     classificata le escludeva in silenzio; oggi 0 righe NULL, fix preventivo).
//   - residuo guard cross-cliente: ordine trovato SOLO per numero citato nel testo e SENZA email
//     del cliente -> NON entra in dati/fonti (potenzialmente di un terzo), gap esplicito al suo posto.
// v10 (2026-07-31, brief harness eval): `model_override` opzionale su draft/refine (solo JWT,
//   allowlist esplicita, MAI fallback silenzioso: Claude senza chiave -> needs_key) per l'A/B
//   modello senza toccare app_flags; `source` ('app'|'eval') su cs_drafts per distinguere le bozze
//   generate dall'harness (migr 0080). Nessun cambio di comportamento senza override.
// v9 (2026-07-26): bozze anche per la chat del sito (chat_notifica): boilerplate della notifica
//   Shopify Inbox rimosso dal testo passato al modello, prompt in tono chat (niente formato email).
// Design: Cowork12/projects/Servizio_Clienti_2026-06/DESIGN_Tool_Assistenza_Amimi_V1_2026-07-20.md (6.1, 6.3, 8).
//
// Il recupero dati e' DETERMINISTICO (dal codice, non dall'AI): giacenza/disponibilita'/prezzo da v_inventory,
// ordine da shopify_orders (per numero o email), tracking + id admin via Shopify Admin API, storico acquisti
// da shopify_orders per email, FAQ/tono da cs_faq. Gemini scrive SOLO usando quel blocco DATI; un dato mancante
// diventa [DA VERIFICARE: ...] (Regola Ferrea 1).
//
// Azioni:
//   - context (JWT): assembla il CONTESTO (dati/fonti + link ordine Shopify + storico acquisti cliente),
//       NESSUN Gemini. La UI la chiama all'apertura del thread per popolare la testata (nessuna spesa AI).
//   - dry_data (PIN): come context ma PIN-gated, per test/diagnosi senza login.
//   - draft (JWT): assembla DATI -> Gemini -> TRE opzioni di risposta (toni: breve/calda/formale) in una sola
//       chiamata. Ritorna {options:[{tono,testo,da_verificare}], fonti, order_admin_url, storia}. Retro-compat:
//       ritorna anche `draft` = testo della prima opzione. Scrive cs_drafts (la 1a) + cs_events. Nessun invio.
//   - refine (JWT): riscrive una bozza data applicando un'istruzione ("piu' formale", "aggiungi X"), sempre
//       vincolata al BLOCCO DATI. Ritorna {draft, da_verificare}. Scrive cs_events 'refine'.
//   - summary (PIN, cron */7): riempie cs_conversations.summary dove NULL. Gemini flash-lite. Decoupled.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SHOP = 'amimi-10000';
const SITE_URL = 'https://amimi.it';   // dominio del sito: unico posto in cui e' scritto (v15)
const MODEL_SUMMARY = 'gemini-flash-lite-latest';
const MODEL_DRAFT = 'gemini-flash-latest';
const MAX_SUMMARY_PER_RUN = 8;

const stripMarks = (s: string): string => [...s.normalize('NFD')].filter((ch) => { const c = ch.codePointAt(0)!; return c < 0x300 || c > 0x36f; }).join('');
const norm = (s: string): string => stripMarks((s || '').toLowerCase()).replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length >= 2));
// parole troppo comuni per essere segnale di variante
const STOP = new Set(['bag', 'the', 'con', 'senza', 'and', 'borsa', 'mini', 'maxi', 'new', 'del', 'della']);

type Row = Record<string, unknown>;
const cleanJson = (t: string) => (t || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
const countDaVerificare = (t: string) => (t.match(/\[DA VERIFICARE[^\]]*\]/gi) || []).length;

// ==== PURE:cs-emailcliente BEGIN ====
// BLOCCO CONDIVISO, copia IDENTICA in cs-send e cs-assist (le due edge non condividono moduli):
// se lo cambi qui, cambialo anche li'. `tests/cs_convkey.mjs` confronta l'impronta delle due copie
// e diventa ROSSO se divergono, cosi' le due edge non possono mai essere in disaccordo silenzioso
// su chi sia un cliente.
// Chi e' il CLIENTE che ha scritto un messaggio in ingresso. La prima stesura della cintura leggeva
// `form_fields.Email` con la E maiuscola, mentre `cs-sync` scrive TUTTE le chiavi in minuscolo
// (`extractFormFields` fa `label.trim().toLowerCase()`): sul canale form la lettura tornava sempre
// undefined e si ripiegava su `from_email`, che li' e' il wrapper `mailer@shopify.com` ed e'
// escluso, quindi l'insieme restava vuoto e non bloccava nulla proprio sul canale per cui era nato.
// Verificato sul DB il 01-08: le chiavi esistenti sono `email`, `name`, `country code`,
// `prefisso internazionale`. Il valore passa poi da un estrattore, perche'
// `nome@dominio<mailto:nome@dominio>` deve contare come UN indirizzo e non come uno diverso.
//
// TERZA FONTE, `reply_to` (migr 0100, brief cs_reply_to_fonte_indipendente). Le prime due fonti
// dipendono ENTRAMBE dal riconoscimento dello stampo del modulo dentro il CORPO: `form_fields`
// esiste solo se cs-sync ha agganciato i marcatori IT/EN, e sul canale modulo `from_email` e' il
// wrapper Shopify, che non e' un cliente. Se il template cambia lingua o formula, le due cadono
// INSIEME, e la cintura resta senza l'indirizzo con cui accorgersi che nella conversazione ci sono
// due persone diverse: e' proprio il caso in cui servirebbe. L'header Reply-To non passa dal corpo,
// Shopify lo valorizza comunque, e dalla migr 0100 cs-sync lo conserva su ogni riga.
// E' l'ULTIMA risorsa DI PROPOSITO, non la seconda come proponeva il brief: su `email_diretta` un
// client di posta puo' legittimamente mettere un Reply-To diverso dal From (alias, lista, gruppo),
// e anteporlo cambierebbe la risposta su righe che oggi risolvono bene, fino a far scattare un
// blocco cross-cliente su una persona sola. Messa in coda, la funzione e' ADDITIVA per costruzione:
// ogni riga che oggi da' un indirizzo continua a dare LO STESSO, solo i null possono riempirsi.
const EMAIL_TOKEN_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/;
const NON_CLIENTE_RE = /@(?:amimi\.it|shopify\.com|mailer\.shopify\.com|shopifyemail\.com)$/;
function emailCliente(m: { from_email?: string | null; form_fields?: Record<string, string> | null; reply_to?: string | null }): string | null {
  let v = '';
  const ff = m.form_fields ?? null;
  if (ff) for (const k of Object.keys(ff)) if (k.trim().toLowerCase() === 'email') { v = String(ff[k] ?? ''); break; }
  if (!v.trim()) v = String(m.from_email ?? '');
  for (const cand of [v, String(m.reply_to ?? '')]) {
    const hit = cand.toLowerCase().match(EMAIL_TOKEN_RE);
    if (!hit) continue;
    if (NON_CLIENTE_RE.test(hit[0])) continue;   // wrapper Shopify e nostri indirizzi non sono clienti
    return hit[0];
  }
  return null;
}
// ==== PURE:cs-emailcliente END ====

// v15: segnaposto di LINK nelle risposte standard: il modello non puo' riempirli, li risolve il CODICE.
// v19 (brief cs_faq_indirizzo_e_link_resi problema 2): la regex del v15 copriva SOLO il link prodotto,
// e `[link resi]` di cs_faq id 13 e' arrivato TALE E QUALE nella mail a una cliente (caso reale T6 del
// 01-08). Ora il segnaposto si riconosce per FORMA e si risolve per TIPO: il link dei resi non e' il
// link della scheda prodotto, e mettere l'uno al posto dell'altro sarebbe il difetto che il v15 aveva
// gia' corretto una volta. Senza URL si degrada a [DA VERIFICARE: ...], mai a un rimando a vuoto.
type LinkUrls = { prodotto: string | null; resi: string | null; tracking: string | null };
const LINK_PH_RE = /\[[^\]\n]{0,30}\blinks?\b[^\]\n]{0,30}\]/gi;
const linkKind = (ph: string): keyof LinkUrls =>
  (/res[oi]|return|rimbors|refund/i.test(ph) ? 'resi' : /tracking|traccia|spedizion|shipment/i.test(ph) ? 'tracking' : 'prodotto');
const LINK_PH_FALLBACK: Record<keyof LinkUrls, string> = {
  prodotto: '[DA VERIFICARE: link scheda prodotto]', resi: '[DA VERIFICARE: link resi]', tracking: '[DA VERIFICARE: tracking]',
};
const resolveLinkPh = (t: string, u: LinkUrls): string =>
  (t || '').replace(LINK_PH_RE, (m) => { const k = linkKind(m); return u[k] ?? LINK_PH_FALLBACK[k]; });
// v19: il safety net sul testo GENERATO non CANCELLA piu' il segnaposto rimasto senza URL (v15 lo
// toglieva, e spariva anche il segnale che li' mancava qualcosa): lo trasforma nel marcatore, che
// finisce nel conteggio `da_verificare` e quindi nel dialog di conferma di cs-send.
const scrubLinkPh = (t: string, u: LinkUrls): string =>
  resolveLinkPh(t, u).replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').trim();
// v19 (stesso brief, punto 3): CINTURA finale. Qualunque altro segnaposto in parentesi quadre
// sopravvissuto alla generazione ([nome], [misure], [dettaglio]... tutti gli stampi di cs_faq)
// diventa un [DA VERIFICARE: ...]: cosi' e' contato dal guardrail invece di sembrare testo normale.
// Solo token che iniziano per lettera e corti: "[1]" o una citazione del cliente non si toccano.
const PH_ANY_RE = /\[(?!\s*DA VERIFICARE)([A-Za-z][^\]\n]{0,39})\]/g;
const scrubPlaceholders = (t: string): string =>
  (t || '').replace(PH_ANY_RE, (_m, inner: string) => `[DA VERIFICARE: ${inner.trim()}]`);
// v19 (brief cs_bozze_troncate punto 3): una bozza che finisce a meta' parola non deve MAI arrivare
// muta all'operatrice. Test deterministico: il testo finisce con punteggiatura di chiusura o emoji?
// v22: la FIRMA di casa e' "Grazie, Team Amimi'" e finisce con una LETTERA, quindi la prima
// stesura marcava come tagliata ogni bozza scritta bene. Segnalato dalla prova a video di un'altra
// sessione ("3 proposte risultano tagliate a meta'" su bozze che finivano regolarmente): falso
// positivo mio, non un difetto del modello. Una chiusura riconosciuta vale quanto un punto.
const CHIUSURA_RE = /(amim[iì]'?|thanks|thank you|a presto|cordiali saluti|best regards)\s*[.!]?\s*$/i;
const sembraTroncata = (t: string): boolean => {
  const s = (t || '').trim();
  if (!s) return true;
  if (CHIUSURA_RE.test(s)) return false;
  return !/[.!?…:;)\]"'»]$/u.test(s) && !/\p{Extended_Pictographic}$/u.test(s);
};

// v19 (brief cs_bozze_troncate punto 1): `diag` raccoglie `finishReason` e i conteggi di token della
// risposta, THINKING INCLUSO. Era la prima cosa che chiedeva il brief e vale piu' di qualunque
// ipotesi: se `finishReason` e' MAX_TOKENS il tetto e' il vincolo, se invece e' STOP con pochi token
// emessi il problema e' altrove. Finisce nel dettaglio di `cs_events` e nella risposta della draft.
type LLMDiag = { finishReason?: string; prompt?: number; output?: number; thinking?: number; total?: number; raw_len?: number };
async function gemini(model: string, prompt: string, key: string, maxTokens: number, jsonMode = false, diag?: LLMDiag): Promise<string> {
  const genCfg: Record<string, unknown> = { temperature: 0.3, maxOutputTokens: maxTokens };
  if (jsonMode) genCfg.responseMimeType = 'application/json';   // MAI thinkingConfig (400), gotcha CONOSCENZA
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: genCfg }),
  });
  const gj = await g.json();
  if (!g.ok) throw new Error('Gemini ' + g.status + ': ' + JSON.stringify(gj).slice(0, 200));
  const cand = gj?.candidates?.[0];
  const um = gj?.usageMetadata ?? {};
  const text = String(cand?.content?.parts?.[0]?.text ?? '').trim();
  if (diag) {
    diag.finishReason = String(cand?.finishReason ?? 'n/d');
    diag.prompt = Number(um.promptTokenCount ?? 0);
    diag.output = Number(um.candidatesTokenCount ?? 0);
    diag.thinking = Number(um.thoughtsTokenCount ?? 0);
    diag.total = Number(um.totalTokenCount ?? 0);
    diag.raw_len = text.length;
  }
  return text;
}

// Claude (Anthropic Messages API) — motore preferito per bozze/refine quando c'e' app_flags.anthropic_api_key
// (tono migliore, niente quota giornaliera come Gemini free). v12: fallback a Gemini se Claude fallisce (no override).
async function claude(model: string, system: string, user: string, key: string, maxTokens: number): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Claude ' + r.status + ': ' + JSON.stringify(j).slice(0, 200));
  const parts = Array.isArray(j?.content) ? j.content : [];
  return parts.filter((p: Row) => p.type === 'text').map((p: Row) => String(p.text ?? '')).join('').trim();
}

// --- Recupero DATI (deterministico) ---
type Prod = { codice: string; item: string; variant: string; prezzo: number | null; giacenza: number; disponibili: number; on_shopify: boolean; url: string | null };

// match prodotti citati nel testo: modello (item) presente + overlap parole variante; fallback alias sito.
//
// v20 (brief cs_assist_migliorie punto 4): entrano anche i prodotti dell'ORDINE VERIFICATO, comunque
// siano scritti nel testo. Il brief proponeva di allargare il match alle sole parole della VARIANTE:
// riprovato sui due casi reali che cita, non ne risolve nessuno e peggiora le cose. Caso S5, "la
// borsina con i piercing azzurra": la variante e' ICE BLUE PIERCING, la cliente scrive in italiano,
// quindi combacia solo "piercing" - una parola, sotto qualunque soglia sensata; e abbassando la
// soglia a una parola entrerebbero TUTTE e sette le borse con i piercing, cioe' esattamente il
// rischio di citare a una cliente il prodotto sbagliato. Caso S9, "cercavo qualcosa sul fucsia
// scuro": nessuna parola della variante e' italiana (CANDY PINK, PAILLETTES), quindi non cambia
// nulla. Il dato certo, in S5, era sotto il naso: l'ordine #1397 ha UNA riga, e risolve a
// MARIA_BAG_ICE_BLUE_PIERCING. Cio' che la cliente ha comprato non si indovina, si legge.
async function matchProducts(sb: ReturnType<typeof createClient>, text: string, codiciOrdine: string[] = []): Promise<Prod[]> {
  const tw = words(text);
  // I codici dell'ordine bastano da soli: un messaggio senza parole utili ("come mai?") non deve
  // far sparire il prodotto che la cliente ha effettivamente comprato.
  const ordSet = new Set(codiciOrdine.map((c) => c.toUpperCase()));
  if (tw.size === 0 && ordSet.size === 0) return [];
  const { data: inv } = await sb.from('v_inventory').select('codice,item,variant,retail_price,giacenza_attuale,disponibili_da_vendere,on_shopify');
  const rows = (inv ?? []) as Row[];
  // v15: link scheda da shopify_catalog.handle (join case-insensitive, Regola Ferrea 4:
  // catalogo Title_Case legacy vs v_inventory MAIUSCOLO). Nessun handle = nessun URL, mai inventarlo.
  const { data: cat } = await sb.from('shopify_catalog').select('codice,handle,on_shopify');
  const handleByCod = new Map<string, string>();
  for (const c of (cat ?? []) as Row[]) {
    if (c.on_shopify === true && c.handle) handleByCod.set(String(c.codice).toUpperCase(), String(c.handle));
  }
  const { data: aliases } = await sb.from('product_aliases').select('shopify_name_norm,codice');
  const aliasHit = new Set<string>();
  for (const a of (aliases ?? []) as Row[]) {
    const meaningful = [...words(String(a.shopify_name_norm ?? ''))].filter((w) => !STOP.has(w));
    const hits = meaningful.filter((w) => tw.has(w)).length;
    // strict: quasi tutte le parole significative dell'alias devono comparire (evita match su 2 parole comuni)
    if (meaningful.length >= 2 && hits >= Math.max(2, Math.ceil(meaningful.length * 0.7))) aliasHit.add(String(a.codice));
  }
  const scored: { p: Prod; score: number }[] = [];
  for (const r of rows) {
    const item = String(r.item ?? ''); const variant = String(r.variant ?? '');
    const modelWords = [...words(item)].filter((w) => !STOP.has(w));
    const varWords = [...words(variant)].filter((w) => !STOP.has(w));
    const modelHit = modelWords.length > 0 && modelWords.some((w) => tw.has(w));
    const varHits = varWords.filter((w) => tw.has(w)).length;
    const isAlias = aliasHit.has(String(r.codice));
    // v20: comprato davvero > citato a parole. Punteggio piu' alto di alias (4) e modello (2) messi
    // insieme, cosi' e' sempre il MIGLIOR match, che e' anche quello da cui si prende l'url.
    const isOrdine = ordSet.has(String(r.codice).toUpperCase());
    if (!modelHit && !isAlias && !isOrdine) continue;
    const handle = handleByCod.get(String(r.codice).toUpperCase()) ?? null;
    const prod: Prod = {
      codice: String(r.codice), item, variant,
      prezzo: r.retail_price == null ? null : Number(r.retail_price),
      giacenza: Number(r.giacenza_attuale ?? 0), disponibili: Number(r.disponibili_da_vendere ?? 0), on_shopify: r.on_shopify === true,
      url: handle ? `${SITE_URL}/products/${handle}` : null,
    };
    scored.push({ p: prod, score: (modelHit ? 2 : 0) + varHits * 3 + (isAlias ? 4 : 0) + (isOrdine ? 10 : 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((x) => x.p);
}

type Ord = { order_number: unknown; financial_status: unknown; fulfillment_status: unknown; fulfilled_at: unknown; gross_total: unknown; email: unknown; order_id: unknown; created_at_shop: unknown; righe: { nome: string; qta: number; codice: string | null }[] } | null;
async function lookupOrder(sb: ReturnType<typeof createClient>, orderNumber: number | null, email: string | null): Promise<Ord> {
  const COLS = 'order_id,order_number,financial_status,fulfillment_status,fulfilled_at,gross_total,email,created_at_shop';
  const base = () => sb.from('shopify_orders').select(COLS).order('created_at_shop', { ascending: false }).limit(1);
  let q = base();
  if (orderNumber) q = q.eq('order_number', orderNumber);
  else if (email) q = q.eq('email', email.toLowerCase());
  else return null;
  const { data } = await q;
  let o = (data ?? [])[0] as Row | undefined;
  // v17: difesa in profondita' (brief cs_assist_migliorie punto 1). `order_number` era NULL su 433
  // righe storiche e il ramo `else if (email)` non scatta mai quando un numero c'e' ma non trova
  // nulla: il tool rispondeva "nessun ordine trovato" su ogni ordine anteriore al 01-07. La migr
  // 0095 ha colmato il buco, questo secondo tentativo su `order_id` regge se ricapita (import
  // nuovo, riga arrivata da un'altra fonte). Citare un ordine sbagliato sarebbe peggio che non
  // citarne nessuno, quindi la guardia cross-cliente qui sotto vale identica per entrambe le vie.
  if (!o && orderNumber) {
    const { data: d2 } = await base().eq('order_id', '#' + orderNumber);
    o = (d2 ?? [])[0] as Row | undefined;
  }
  if (!o) return null;
  // guard cross-cliente (audit 2026-07-24): il numero ordine e' estratto dal TESTO del cliente, quindi
  // puo' citare un ordine ALTRUI. Se conosciamo l'email del cliente, l'ordine deve essere suo (match
  // case-insensitive lato codice, evita anche il bug case-sensitivity di shopify_orders.email).
  if (orderNumber && email && String(o.email ?? '').toLowerCase() !== email.toLowerCase()) return null;
  // v20: oltre al nome serve il CODICE risolto (`codice_norm`, 675/675 righe risolte): e' il
  // modo deterministico di sapere quale borsa ha in mano la cliente, senza dedurlo dal testo.
  const { data: li } = await sb.from('shopify_line_items').select('lineitem_name,quantita,codice_norm').eq('order_id', o.order_id as string);
  const righe = ((li ?? []) as Row[]).map((r) => ({ nome: String(r.lineitem_name ?? ''), qta: Number(r.quantita ?? 0), codice: r.codice_norm ? String(r.codice_norm) : null }));
  return { order_number: o.order_number, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, fulfilled_at: o.fulfilled_at, gross_total: o.gross_total, email: o.email, order_id: o.order_id, created_at_shop: o.created_at_shop, righe };
}

// Shopify Admin API: cerca l'ordine per NOME (#numero) e ritorna id numerico (per il link admin) + tracking.
// Il DB non tiene ne' l'id numerico ne' il tracking (order_id e' il NOME #1518). Best-effort: null se fallisce.
type OrdMeta = { adminId: number | null; tracking: { numero: string; url: string; corriere: string } | null; shipment_status: string | null; f_updated_at: string | null };
async function fetchOrderMeta(orderNumber: unknown, token: string): Promise<OrdMeta | null> {
  if (!orderNumber || !token) return null;
  try {
    const r = await fetch(`https://${SHOP}.myshopify.com/admin/api/2024-01/orders.json?status=any&name=${encodeURIComponent('#' + orderNumber)}&fields=id,name,fulfillments&limit=1`, { headers: { 'X-Shopify-Access-Token': token } });
    if (!r.ok) return null;
    const j = await r.json();
    const o = (j.orders ?? [])[0];
    if (!o) return null;
    const f = (o.fulfillments ?? [])[0];
    const numero = f?.tracking_number || (f?.tracking_numbers ?? [])[0] || '';
    const tracking = numero
      ? { numero: String(numero), url: String(f?.tracking_url || (f?.tracking_urls ?? [])[0] || `https://www.mytws.it/tracking-status;ldv=${numero}`), corriere: String(f?.tracking_company || 'TWS') }
      : null;
    // shipment_status: nel NOSTRO flusso quasi sempre null (i fulfillment li crea amimi-ship senza events,
    // review 24-07); se un giorno c'e' 'delivered', updated_at e' un'APPROSSIMAZIONE della data di consegna.
    return { adminId: (o.id as number) ?? null, tracking, shipment_status: (f?.shipment_status as string) ?? null, f_updated_at: (f?.updated_at as string) ?? null };
  } catch { return null; }
}

// v16: stato corrente del corriere TWS per l'ordine (shipping_status, migr 0086). La riga piu'
// recente se l'ordine ha piu' colli. Tabella vuota / ordine senza LDV -> null (come prima).
// v17 (brief cs_assist_migliorie punto 2): la colonna si chiama ora `seen_delivered_at` (migr 0095)
// e vale solo per le transizioni OSSERVATE. `consegnata_il` e' il campo che il resto del codice puo'
// scrivere a una cliente, ed e' valorizzato solo se la data supera il controllo di PLAUSIBILITA':
// non prima della spedizione, non nel futuro. Una consegna non puo' precedere la partenza; una data
// uguale su tutte le righe e pari al giorno del caricamento e' il seed, non un fatto. Il linter
// anti-invenzione non poteva intercettare niente di tutto questo, perche' il numero non era
// inventato: era sbagliato alla fonte e quindi grounded.
type Ship = { ldv: string; stato_tws: string; consegnata_il: string | null; updated_at: string } | null;
const plausibileConsegna = (d: string | null, shipped: string | null, oggi: string): string | null => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d > oggi) return null;
  if (shipped && d < shipped) return null;
  return d;
};
async function shippingStatus(sb: ReturnType<typeof createClient>, orderNumber: unknown): Promise<Ship> {
  if (!orderNumber) return null;
  const { data } = await sb.from('shipping_status').select('ldv,stato_tws,seen_delivered_at,shipped_date,updated_at')
    .eq('order_name', '#' + orderNumber).order('updated_at', { ascending: false }).limit(1);
  const r = (data ?? [])[0] as Row | undefined;
  if (!r) return null;
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const consegnata = plausibileConsegna((r.seen_delivered_at as string) ?? null, (r.shipped_date as string) ?? null, oggi);
  return { ldv: String(r.ldv), stato_tws: String(r.stato_tws), consegnata_il: consegnata, updated_at: String(r.updated_at) };
}

// --- Motore dei verdetti (design Parte B 24-07): il CODICE decide il caso, l'AI scrive la frase ---
const DIFETTO_RE = /difett|rott[oa]|scucit|staccat|danneggiat|rovinat|macchiat|non funziona|si (e'|è) (rotta|scucita|staccata|aperta)/i;
const CASE_CATS = new Set(['Reso e rimborso', 'Cambio e prodotto errato', 'Modifica / correzione indirizzo']);
// v18: `non_applicabile` NON e' 'sconosciuto'. 'sconosciuto' vuol dire "non so di che ordine parliamo";
// 'non_applicabile' vuol dire "l'ordine lo conosco benissimo, ed e' proprio per questo che la finestra
// di reso non c'entra": rimborsato, annullato, o merce ancora ferma da noi.
type NonApplicabile = 'rimborsato' | 'rimborsato_parziale' | 'annullato' | 'pre_ritiro';
type CasoReso = { ordine_del: string | null; delivered_at: string | null; fonte: string | null; giorni: number | null; finestra: number; verdetto: 'entro' | 'fuori' | 'non_applicabile' | 'sconosciuto'; non_applicabile: NonApplicabile | null; stato_pagamento: string | null; difetto_sospetto: boolean };
type CasoIndirizzo = { fulfillment_presente: boolean; caso: 'correggibile' | 'verificare_tracking' | 'consegnato' | 'sconosciuto' };

function computeCaso(conv: Row, ordine: Ord, meta: OrdMeta | null, inbound: string, finestra: number, confirmedDate: string | null, ship: Ship = null): { verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo } {
  // Guard (review 24-07): il numero ordine viene dal TESTO del cliente. L'ordine e' "verificato" solo se
  // abbiamo potuto agganciarlo all'email del cliente (lookupOrder gia' scarta i mismatch). Senza email,
  // nessun verdetto: SCONOSCIUTO, mai un caso calcolato sull'ordine di un terzo.
  const verificato = !!ordine && !!(conv.customer_email);
  const difetto = DIFETTO_RE.test(inbound);
  // v16: stato corrente del corriere (solo a ordine VERIFICATO: mai verdetti sull'ordine di un terzo)
  const shipStato = verificato && ship ? ship.stato_tws : null;
  const PRE_RITIRO = new Set(['NUOVA', 'IN ATTESA DI AFFIDO']);

  // v14 (owner 31-07, allineato al sito): la finestra reso decorre dalla DATA DELL'ORDINE
  // (created_at_shop), non piu' dalla consegna. Verdetto quindi SEMPRE calcolabile a ordine
  // verificato. La data di consegna resta in uso per il caso INDIRIZZO ('consegnato') e come info.
  // Priorita' fonte (v16): conferma della collega > TWS (stato corriere) > shopify approssimata.
  let delivered: string | null = null, fonte: string | null = null;
  if (confirmedDate && /^\d{4}-\d{2}-\d{2}$/.test(confirmedDate)) { delivered = confirmedDate; fonte = 'confermata dalla collega'; }
  else if (shipStato && shipStato.startsWith('CONSEGNATA')) { delivered = ship?.consegnata_il ?? null; fonte = 'TWS (stato corriere)'; }
  else if (verificato && meta?.shipment_status === 'delivered' && meta.f_updated_at) { delivered = String(meta.f_updated_at).slice(0, 10); fonte = 'shopify (approssimata)'; }
  const ordineDel = verificato && ordine?.created_at_shop ? String(ordine.created_at_shop).slice(0, 10) : null;
  let giorni: number | null = null;
  let verdetto: CasoReso['verdetto'] = 'sconosciuto';
  if (ordineDel) {
    giorni = Math.floor((Date.now() - new Date(ordineDel + 'T12:00:00Z').getTime()) / 86400000);
    if (giorni >= 0) verdetto = giorni <= finestra ? 'entro' : 'fuori';
  }
  // v18 (brief punto 8): la finestra si conta sulla data dell'ordine, ma ci sono ordini su cui la
  // finestra non e' proprio la domanda giusta. Rimborsato/annullato = il caso e' gia' chiuso a
  // favore della cliente; pre-ritiro = la merce e' ancora da noi, non c'e' niente da rendere.
  // In tutti e tre il verdetto entro/fuori si SPEGNE: meglio nessun verdetto che un rifiuto a
  // qualcuno che e' gia' stato rimborsato (caso reale #1499, tutte e 3 le bozze sbagliate).
  const finStat = String(ordine?.financial_status ?? '').toLowerCase().trim();
  let nonApp: NonApplicabile | null = null;
  if (verificato) {
    if (finStat === 'refunded') nonApp = 'rimborsato';
    else if (finStat === 'partially_refunded') nonApp = 'rimborsato_parziale';
    else if (finStat === 'voided') nonApp = 'annullato';
    else if (shipStato && PRE_RITIRO.has(shipStato)) nonApp = 'pre_ritiro';
  }
  if (nonApp) verdetto = 'non_applicabile';
  const reso: CasoReso = { ordine_del: ordineDel, delivered_at: delivered, fonte: ordineDel ? 'data ordine (Shopify)' : fonte, giorni, finestra, verdetto, non_applicabile: nonApp, stato_pagamento: verificato && finStat ? finStat : null, difetto_sospetto: difetto };

  // INDIRIZZO: fulfillment ASSENTE = non ritirato (affidabile: ship-sync evade solo al ritiro) -> correggibile.
  // Fulfillment PRESENTE senza fonte delivered -> "verificare dal tracking" (MAI "in transito" secco, review 24-07).
  const fulf = String(ordine?.fulfillment_status ?? '');
  const fulfPresente = fulf === 'fulfilled' || fulf === 'partial';
  let casoInd: CasoIndirizzo['caso'] = 'sconosciuto';
  if (verificato) {
    // v16: lo stato TWS, quando c'e', decide da solo. Pre-ritiro = correggibile ANCHE a
    // fulfillment presente; CONSEGNATA = consegnato senza conferma manuale.
    if (shipStato && PRE_RITIRO.has(shipStato)) casoInd = 'correggibile';
    else if (shipStato && shipStato.startsWith('CONSEGNATA')) casoInd = 'consegnato';
    else if (!fulfPresente) casoInd = 'correggibile';
    else if (delivered) casoInd = 'consegnato';
    else casoInd = 'verificare_tracking';
  }
  return { verificato, reso, indirizzo: { fulfillment_presente: fulfPresente, caso: casoInd } };
}

// v18: le righe di caso per gli ordini su cui la finestra di reso non e' la domanda giusta.
// Sono istruzioni NEGATIVE (cosa non affermare) piu' che verdetti: il fatto lo dice il BLOCCO DATI,
// qui si impedisce solo che il modello ci costruisca sopra un rifiuto.
const NON_APPLICABILE_LINE: Record<NonApplicabile, string> = {
  rimborsato: "- L'ordine risulta GIA' RIMBORSATO per intero (stato pagamento: refunded). NON parlare di finestra di reso, NON rifiutare nulla e NON chiedere di rispedire la merce: il caso e' gia' chiuso a favore della cliente. Riconosci il rimborso gia' effettuato e chiedi se serve altro. Se la cliente chiede quando vedra' l'accredito, usa [DA VERIFICARE: data dell'accredito].",
  rimborsato_parziale: "- L'ordine risulta GIA' RIMBORSATO IN PARTE (stato pagamento: partially_refunded). NON emettere verdetti sulla finestra di reso. Riconosci il rimborso parziale gia' fatto SENZA dare per scontato a cosa si riferisce ne' a quanto ammonta (l'importo non e' nei DATI), e chiedi conferma di che cosa serve ancora.",
  annullato: "- L'ordine risulta ANNULLATO (pagamento voided): non c'e' nessuna finestra di reso da calcolare. Riconosci l'annullamento e chiedi se serve altro.",
  pre_ritiro: "- La merce NON e' ancora partita: il corriere non l'ha ancora ritirata (vedi lo stato spedizione nei DATI). Non c'e' niente da rendere, quindi NON parlare di finestra di reso ne' di spedizione di rientro a carico della cliente. Se vuole annullare o cambiare, raccogli la richiesta e passala a una persona.",
};

// v25 (decisione owner 01-08 notte, punto 3 della spec v17: "fallo comunque"): il motore dei
// verdetti smette di schiacciare i rami su uno solo e RESTITUISCE L'ELENCO dei rami ammessi.
// Il principio e' dell'owner (`RAMI_Predefiniti_BOZZA_2026-08-01.md`, Rev. 2): **i rami si derivano
// dalla DOMANDA, mai dalla disponibilita' dei dati**; i dati non sbloccano i rami, li PRESELEZIONANO
// (fino a ridurli a uno quando il dato e' certo) e ne riempiono i dettagli.
// Nessun ramo qui e' inventato: sono tutti gia' dentro il testo che `casoBlock` produce oggi, solo
// che oggi convivono schiacciati in una riga sola e il modello ne sceglie uno a caso. I due casi in
// cui la promozione vale davvero: `verificare_tracking`, dove il testo attuale chiede di restare
// "PRUDENTE su entrambe le ipotesi" (una risposta sola che non afferma nulla, contro due risposte
// nette fra cui scegliere) e `consegnato`, dove portineria e segnalazione al corriere sono due
// esiti diversi. I titoli sono FISSI di proposito: `cs_drafts.ramo_scelto` diventa cosi' un dataset
// con una chiave stabile, che era la ragione per cui l'owner ha chiesto di salvarlo.
// SCOSTAMENTO DICHIARATO: questo pezzo NON era nella configurazione che ha vinto il giro 2 alla
// cieca (li' il blocco CASO era quello di produzione, verbatim). E' stato aggiunto su richiesta
// esplicita dell'owner dopo il referto, e va rimisurato al prossimo giro.
// ==== PURE:cs-casorami BEGIN ====
type Ramo = { titolo: string; istruzione: string };
function casoRami(categoria: string | null, cd: { verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo }): Ramo[] {
  if (!categoria || !CASE_CATS.has(categoria)) return [];
  const R: Ramo[] = [];
  if (categoria === 'Modifica / correzione indirizzo') {
    if (cd.indirizzo.caso === 'correggibile') {
      R.push({ titolo: 'Correggo l\'indirizzo', istruzione: "Spedizione NON ancora ritirata dal corriere: la correzione E' POSSIBILE. Rassicura e chiedi l'indirizzo completo e corretto (via, civico, CAP, citta')." });
    } else if (cd.indirizzo.caso === 'consegnato') {
      // due esiti veri: il pacco salta fuori da un vicino, oppure si apre la verifica col corriere
      R.push({ titolo: 'Consegnato: controlla in zona', istruzione: "Il pacco risulta GIA' CONSEGNATO: nessuna modifica possibile. Empatia + passi concreti (vicini, portineria, familiari) e chiedi di ricontrollare. Niente promesse impossibili." });
      R.push({ titolo: 'Apriamo verifica col corriere', istruzione: 'Il pacco risulta consegnato ma la cliente non lo ha: raccogli i riferimenti e dichiara che apriamo una segnalazione al corriere, senza promettere tempi ne\' esiti.' });
    } else if (cd.indirizzo.caso === 'verificare_tracking') {
      // il caso per cui questa modifica esiste: oggi il prompt chiede una risposta sola che non
      // afferma nessuna delle due ipotesi, e viene fuori una bozza che non dice niente.
      R.push({ titolo: 'In viaggio: rientro e rispedizione', istruzione: "Ipotesi: la spedizione e' partita ed e' ancora in viaggio. Spiega che si puo' attendere il rientro al mittente e poi rispedire, con il costo di rispedizione a carico della cliente ([DA VERIFICARE: costo]). NON affermare che sia gia' consegnata." });
      R.push({ titolo: 'Forse gia\' consegnata: controlla', istruzione: "Ipotesi: il pacco potrebbe risultare gia' consegnato. Chiedi di controllare vicini, portineria e familiari e di farci sapere. NON affermare che sia ancora in viaggio." });
    } else {
      R.push({ titolo: 'Sto verificando la spedizione', istruzione: 'Stato spedizione NON determinabile dai dati: niente verdetti, dichiara che stai verificando e usa [DA VERIFICARE: stato spedizione]. Mai dire che la spedizione "non risulta".' });
    }
    return R;
  }
  // --- reso / cambio ---
  // Il DIFETTO viene prima di tutto: la garanzia legale dura 24 mesi e la finestra del recesso non
  // c'entra. I due rami sono i due esiti che il testo di oggi tiene insieme in una riga sola.
  if (cd.reso.difetto_sospetto) {
    R.push({ titolo: 'Difetto: chiedo una foto', istruzione: "POSSIBILE DIFETTO segnalato dalla cliente: la finestra di reso NON si applica (garanzia legale 24 mesi). Dispiacere sincero, chiedi una foto del punto e dell'etichetta per capire cosa e' successo. MAI un rifiuto, nessuna promessa di esito." });
    R.push({ titolo: 'Difetto: passo a una persona', istruzione: 'POSSIBILE DIFETTO: raccogli i riferimenti e passa il caso a una persona del team, che valutera\' riparazione o cambio. MAI negare il reso citando i giorni del recesso.' });
    return R;
  }
  if (cd.reso.non_applicabile) {
    const T: Record<NonApplicabile, string> = {
      rimborsato: 'Gia\' rimborsato: confermo',
      rimborsato_parziale: 'Rimborso parziale: confermo',
      annullato: 'Ordine annullato: confermo',
      pre_ritiro: 'Merce non ancora partita',
    };
    R.push({ titolo: T[cd.reso.non_applicabile], istruzione: NON_APPLICABILE_LINE[cd.reso.non_applicabile].replace(/^- /, '') });
    return R;   // il dato e' certo: ramo unico, la preselezione l'ha fatta il codice
  }
  if (cd.reso.verdetto === 'entro') {
    R.push({ titolo: 'Reso ammesso: istruzioni', istruzione: `Reso AMMESSO: ordine del ${dmy(cd.reso.ordine_del)} (${cd.reso.giorni} giorni fa, entro i ${cd.reso.finestra} dalla data dell'ordine). Istruzioni + link resi; spedizione di rientro a carico della cliente; rimborso entro 14 giorni dal rientro sul metodo originale.` });
    // Solo sul CAMBIO esiste un secondo esito che i dati non possono decidere: se la cliente e' a
    // Milano, il cambio in showroom evita del tutto la spedizione. Lo sa il team, non la tabella.
    if (categoria === 'Cambio e prodotto errato') {
      R.push({ titolo: 'Cambio in showroom', istruzione: 'Cambio di persona su appuntamento in Via Plinio 43, se la cliente e\' a Milano: proponilo come alternativa alla spedizione, concordando giorno e fascia. Non darlo per scontato se non sai dove si trova.' });
    }
    return R;
  }
  if (cd.reso.verdetto === 'fuori') {
    R.push({ titolo: 'Fuori finestra: alternativa', istruzione: `Reso NON ammesso: ordine del ${dmy(cd.reso.ordine_del)}, ${cd.reso.giorni} giorni fa (finestra ${cd.reso.finestra} dalla data dell'ordine). Rifiuto GARBATO con un'alternativa concreta; se dovesse emergere un difetto cambia tutto, e allora proponi il contatto.` });
    return R;
  }
  R.push({ titolo: 'Sto verificando l\'ordine', istruzione: `Ordine NON identificato con certezza: nessun verdetto sulla finestra. Spiega la regola dei ${cd.reso.finestra} giorni dalla data dell'ordine in generale, dichiara che stai controllando e usa [DA VERIFICARE: numero ordine]. Mai dire che l'ordine "non risulta".` });
  return R;
}

// v25: il blocco CASO in forma di RAMI. Sostituisce `casoBlock` SOLO a schema rami acceso: a flag
// spento il prompt resta byte per byte quello di prima, e il rollback non richiede un deploy.
function casoBlockRami(categoria: string | null, cd: { verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo }): string {
  const rami = casoRami(categoria, cd);
  if (!rami.length) return '';
  const testa = rami.length === 1
    ? "CASO CALCOLATO DAL SISTEMA. I dati bastano a decidere: scrivi UNA SOLA alternativa, con esattamente questo titolo, e nessun'altra."
    : `CASO CALCOLATO DAL SISTEMA. Gli esiti possibili sono ${rami.length}: scrivi UNA alternativa per ciascuno, con esattamente questi titoli, nello stesso ordine, e NESSUN altro ramo. Sara' la collega a scegliere quello vero.`;
  return [testa, ...rami.map((r) => `- TITOLO "${r.titolo}": ${r.istruzione}`)].join('\n') + '\n';
}
// ==== PURE:cs-casorami END ====

// Blocco CASO da iniettare nel prompt draft: vincolante, l'AI scrive DENTRO il caso, non lo decide.
function casoBlock(categoria: string | null, cd: { verificato: boolean; reso: CasoReso; indirizzo: CasoIndirizzo }): string {
  if (!categoria || !CASE_CATS.has(categoria)) return '';
  const L: string[] = ['CASO CALCOLATO DAL SISTEMA (vincolante: scrivi la risposta DENTRO questo caso, non metterlo in dubbio):'];
  if (categoria === 'Modifica / correzione indirizzo') {
    if (cd.indirizzo.caso === 'correggibile') L.push("- Spedizione NON ancora ritirata dal corriere: la correzione E' POSSIBILE. Rassicura e chiedi l'indirizzo completo e corretto (via, civico, CAP, citta').");
    else if (cd.indirizzo.caso === 'consegnato') L.push('- Il pacco risulta GIA\' CONSEGNATO: nessuna modifica possibile. Empatia + passi concreti (vicini, portineria); se non salta fuori, segnalazione al corriere. Niente promesse impossibili.');
    else if (cd.indirizzo.caso === 'verificare_tracking') L.push("- Spedizione GIA' PARTITA ma non sappiamo se e' in viaggio o gia' consegnata: resta PRUDENTE su entrambe le ipotesi (se in viaggio: ritorno al mittente e rispedizione a carico del cliente con costo [DA VERIFICARE], oppure attendere; se consegnata: controllare vicini/portineria). NON affermare con certezza nessuna delle due.");
    else L.push('- Stato spedizione NON determinabile dai dati: niente verdetti, usa [DA VERIFICARE: stato spedizione].');
  } else {
    if (cd.reso.difetto_sospetto) L.push('- POSSIBILE DIFETTO segnalato dal cliente: la finestra reso NON si applica da sola (garanzia legale 24 mesi). Bozza prudente: chiedi una foto, proponi riparazione/cambio o contatto. MAI un rifiuto.');
    // v18: il caso "gia' rimborsato / mai partito" viene PRIMA di qualunque conto sui giorni e
    // convive col difetto (sono due fatti, non due verdetti in concorrenza).
    if (cd.reso.non_applicabile) L.push(NON_APPLICABILE_LINE[cd.reso.non_applicabile]);
    else if (cd.reso.difetto_sospetto) { /* la riga del difetto basta: nessun verdetto sulla finestra */ }
    else if (cd.reso.verdetto === 'entro') L.push(`- Reso AMMESSO: ordine del ${dmy(cd.reso.ordine_del)} (${cd.reso.giorni} giorni fa, entro i ${cd.reso.finestra} dalla data dell'ordine). Istruzioni + link resi; spedizione di rientro a carico del cliente; rimborso entro 14 giorni dal rientro sul metodo originale.` + (categoria === 'Cambio e prodotto errato' ? ' Per il CAMBIO: stessa finestra, spese a carico del cliente (salvo errore nostro: allora scuse e spese nostre).' : ''));
    else if (cd.reso.verdetto === 'fuori') L.push(`- Reso NON ammesso: ordine del ${dmy(cd.reso.ordine_del)}, ${cd.reso.giorni} giorni fa (finestra ${cd.reso.finestra} dalla data dell'ordine). Rifiuto GARBATO con un'alternativa concreta; se dovesse emergere un difetto, cambia tutto: proponi il contatto.`);
    else L.push(`- Ordine NON identificato con certezza: nessun verdetto sulla finestra. Spiega la regola dei ${cd.reso.finestra} giorni dalla data dell'ordine in generale e usa [DA VERIFICARE: numero ordine].`);
  }
  return L.join('\n') + '\n';
}

// --- Linter di aderenza ("ensure context" 24-07): controllo DETERMINISTICO post-bozza, ZERO AI ---
// Estrae numeri/prezzi/date/URL dalla bozza e verifica che esistano nel CORPUS dei fatti consentiti
// (messaggi del cliente + BLOCCO DATI + caso + fonti + risposte standard/tono + istruzioni team).
// Cio' che non trova torna in `non_grounded[]`: la UI lo evidenzia, l'operatrice decide. Mai bloccante.
function factKeys(text: string): Set<string> {
  const out = new Set<string>();
  const t = text || '';
  // date ISO yyyy-mm-dd -> chiavi d/m e d/m/yyyy
  for (const m of t.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) { out.add('d:' + (+m[3]) + '/' + (+m[2])); out.add('d:' + (+m[3]) + '/' + (+m[2]) + '/' + m[1]); }
  // date dd/mm[/yyyy]
  for (const m of t.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) {
    out.add('d:' + (+m[1]) + '/' + (+m[2]));
    if (m[3]) out.add('d:' + (+m[1]) + '/' + (+m[2]) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]));
  }
  // numeri (prezzi, quantita', finestre): normalizza il formato italiano (1.234,56 -> 1234.56)
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let s = m[0];
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = parseFloat(s);
    if (Number.isFinite(n)) out.add('n:' + String(n));
  }
  // domini/URL (tld solo lettere, per non matchare parole attaccate da un punto)
  for (const m of t.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6})((?:\/[^\s"',;!?)\]]*)?)/gi)) {
    const host = m[1].toLowerCase();
    out.add('u:' + host);
    if (m[2]) out.add('u:' + host + m[2].replace(/[.,;:!?)]+$/, '').toLowerCase());
  }
  return out;
}
function lintDraft(testo: string, corpus: Set<string>): string[] {
  // i placeholder [DA VERIFICARE: ...] sono gia' flag espliciti: non ri-segnalarli
  const clean = (testo || '').replace(/\[DA VERIFICARE[^\]]*\]/gi, ' ');
  const missing: string[] = [];
  const seen = new Set<string>();
  const flag = (raw: string, key: string) => { if (!corpus.has(key) && !seen.has(raw)) { seen.add(raw); missing.push(raw); } };
  for (const m of clean.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) flag(m[0], 'd:' + (+m[1]) + '/' + (+m[2]));
  for (const m of clean.matchAll(/(?<![\d/.,])(\d+(?:[.,]\d+)*)(?![\d/])/g)) {
    let s = m[1];
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = parseFloat(s);
    if (Number.isFinite(n)) flag(m[1], 'n:' + String(n));
  }
  for (const m of clean.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6})((?:\/[^\s"',;!?)\]]*)?)/gi)) {
    const host = m[1].toLowerCase();
    const full = 'u:' + host + (m[2] ? m[2].replace(/[.,;:!?)]+$/, '').toLowerCase() : '');
    if (!corpus.has(full) && !corpus.has('u:' + host)) flag(m[0], full);
  }
  // v15: un token [tra parentesi] sopravvissuto nella bozza (che non sia un [DA VERIFICARE], gia'
  // rimosso da `clean`) e' un segnaposto non riempito: sempre segnalato all'operatrice.
  for (const m of clean.matchAll(/\[[^\]\n]{1,60}\]/g)) flag(m[0], 'ph:' + m[0]);
  return missing.slice(0, 8);
}

// --- Contratto di contesto per categoria ("ensure context" 24-07): dati OBBLIGATORI per rispondere ---
// Se mancano, la UI lo dice PRIMA di generare; la bozza usera' [DA VERIFICARE], mai inventare.
// (Il gap "data di consegna" di reso/cambio lo mostra gia' il pannello caso: non duplicato qui.)
function contractGaps(categoria: string | null, dati: Dati): string[] {
  const gaps: string[] = [];
  const cat = categoria ?? '';
  const needOrder = ['Spedizione e stato ordine', 'Reso e rimborso', 'Cambio e prodotto errato', 'Modifica / correzione indirizzo', 'Pagamento'].includes(cat);
  if (needOrder && !dati.ordine) gaps.push('ordine non trovato (numero/email mancanti o non combacianti)');
  if (cat === 'Spedizione e stato ordine' && dati.ordine && !dati.tracking) gaps.push('tracking non ancora disponibile');
  if ((cat === 'Restock e disponibilita' || cat === 'Info prodotto') && dati.prodotti.length === 0) gaps.push('prodotto non identificato dal testo');
  return gaps;
}

// Storico acquisti del cliente (per email): totale, conteggio, ordini recenti. Solo Shopify (il POS Qromo
// non tiene l'email cliente). Sola lettura, nessun PII oltre a cio' che la UI gia' vede sul thread.
type Storia = { n_ordini: number; totale: number; prima: string | null; ultima: string | null; recenti: { numero: unknown; data: string; totale: number; stato: unknown }[] };
async function purchaseHistory(sb: ReturnType<typeof createClient>, email: string | null): Promise<Storia | null> {
  if (!email) return null;
  const { data } = await sb.from('shopify_orders')
    .select('order_number,created_at_shop,gross_total,financial_status')
    .eq('email', email.toLowerCase()).order('created_at_shop', { ascending: false }).limit(30);
  const orders = (data ?? []) as Row[];
  if (!orders.length) return { n_ordini: 0, totale: 0, prima: null, ultima: null, recenti: [] };
  const totale = orders.reduce((s, o) => s + Number(o.gross_total ?? 0), 0);
  const recenti = orders.slice(0, 6).map((o) => ({ numero: o.order_number, data: String(o.created_at_shop ?? '').slice(0, 10), totale: Number(o.gross_total ?? 0), stato: o.financial_status }));
  return {
    n_ordini: orders.length, totale: Math.round(totale * 100) / 100,
    ultima: String(orders[0].created_at_shop ?? '').slice(0, 10),
    prima: String(orders[orders.length - 1].created_at_shop ?? '').slice(0, 10),
    recenti,
  };
}

type Dati = { prodotti: Prod[]; ordine: Ord; tracking: OrdMeta['tracking']; ship: Ship; standard: string[]; fonti: string[] };
type Ctx = { dati: Dati; tono: string[]; order_admin_url: string | null; storia: Storia | null; gapExtra: string[]; conoscenza: string[]; precedenti: string[]; linkUrls: LinkUrls };

// v14: conoscenza di casa (cs_knowledge, migr 0082): righe con categoria NULL sempre, piu' quelle
// della categoria della conversazione. Editabile a DB senza redeploy; cap prudente sul totale.
async function csKnowledge(sb: ReturnType<typeof createClient>, categoria: string | null): Promise<string[]> {
  const { data } = await sb.from('cs_knowledge').select('categoria,titolo,contenuto').eq('attiva', true).order('id');
  const rows = ((data ?? []) as Row[]).filter((r) => r.categoria == null || (categoria != null && r.categoria === categoria));
  const out: string[] = [];
  let tot = 0;
  for (const r of rows) {
    const s = `[${r.titolo}] ${String(r.contenuto ?? '')}`;
    if (tot + s.length > 6000) break;
    out.push(s); tot += s.length;
  }
  return out;
}

async function faqTono(sb: ReturnType<typeof createClient>, categoria: string | null, lingua: string | null): Promise<{ tono: string[]; standard: string[] }> {
  const { data } = await sb.from('cs_faq').select('tipo,testo_it,testo_en,categoria').eq('attiva', true);
  const rows = (data ?? []) as Row[];
  // v11: esempi di tono PRIMA quelli della categoria della conversazione, poi gli altri, cap 6
  // (prima erano in ordine di id: su un reso arrivavano anche cerimonia, ritiro e restock in testa)
  const toni = rows.filter((r) => r.tipo === 'esempio_tono');
  const tono = [
    ...toni.filter((r) => categoria != null && r.categoria === categoria),
    ...toni.filter((r) => !(categoria != null && r.categoria === categoria)),
  ].map((r) => String(r.testo_it ?? '')).filter(Boolean).slice(0, 6);
  // v11: risposte standard della categoria + le TRASVERSALI (categoria NULL, mai escluse);
  // in inglese entra testo_en se popolato (12/12 lo hanno), fallback testo_it
  const standard = rows
    .filter((r) => (r.tipo === 'faq' || r.tipo === 'risposta_standard') && (!categoria || r.categoria === categoria || r.categoria == null))
    .sort((a, b) => Number(b.categoria != null) - Number(a.categoria != null))
    .map((r) => {
      const en = String(r.testo_en ?? '').trim();
      return lingua === 'en' && en ? en : String(r.testo_it ?? '');
    }).filter(Boolean).slice(0, 4);
  return { tono, standard };
}

async function assembleContext(sb: ReturnType<typeof createClient>, conv: Row, inboundText: string, token: string, categoria: string | null): Promise<Ctx> {
  let ordine = await lookupOrder(sb, (conv.order_number as number) ?? null, (conv.customer_email as string) ?? null);
  const gapExtra: string[] = [];
  // v11 (residuo audit fix 5): il numero ordine viene dal TESTO del cliente. Se non abbiamo la sua
  // email per verificarlo, l'ordine trovato per solo numero e' potenzialmente di un TERZO: non
  // entra nei dati ne' nelle fonti, al suo posto un gap esplicito. (I verdetti erano gia' bloccati.)
  if (ordine && conv.order_number && !conv.customer_email) {
    ordine = null;
    gapExtra.push("ordine citato non verificabile come suo (manca l'email del cliente): chiedere conferma, non dare dettagli");
  }
  // v20: i prodotti dell'ordine entrano fra i candidati, ma SOLO DOPO la guardia qui sopra e solo da
  // un ordine verificato. L'ordine di queste righe e' la guardia stessa: leggere le righe di un
  // ordine non verificato vorrebbe dire raccontare a una persona cosa ha comprato un'altra.
  const codiciOrdine = ordine ? ordine.righe.map((r) => r.codice).filter((c): c is string => !!c) : [];
  const prodotti = await matchProducts(sb, inboundText, codiciOrdine);
  const wantsTracking = categoria === 'Spedizione e stato ordine' || /tracking|spedizione|corriere|dov.?\s*e|arriv/i.test(inboundText);
  const meta = ordine ? await fetchOrderMeta(ordine.order_number, token) : null;
  const tracking = meta && wantsTracking ? meta.tracking : null;
  // v16: stato corrente del corriere TWS (shipping_status); null se non c'e' = come prima
  const ship = ordine ? await shippingStatus(sb, ordine.order_number) : null;
  const order_admin_url = meta?.adminId ? `https://admin.shopify.com/store/${SHOP}/orders/${meta.adminId}` : null;
  const { tono, standard: standardRaw } = await faqTono(sb, categoria, (conv.lingua as string) ?? null);
  // v15: i segnaposto di link si risolvono QUI, prima del prompt. SOLO l'URL del MIGLIOR match:
  // prendere il primo prodotto CON url darebbe il link di un'ALTRA borsa quando il top match non ha
  // la scheda (provato live: richiesta PURPLE_PATENT senza handle -> usciva il link della VERNICE
  // ROSSO). Meglio [DA VERIFICARE] di un link sbagliato.
  // v19: gli URL risolvibili, per TIPO. `resi` arriva da app_flags (`cs_link_resi_url`, migr 0096):
  // e' una pagina del sito, non un dato del gestionale, e l'owner deve poterla cambiare senza deploy.
  // Se il flag manca o e' vuoto resta null e il segnaposto degrada a [DA VERIFICARE: link resi].
  const { data: fResi } = await sb.from('app_flags').select('value').eq('key', 'cs_link_resi_url').maybeSingle();
  const linkUrls: LinkUrls = {
    prodotto: prodotti[0]?.url ?? null,
    resi: String(fResi?.value ?? '').trim() || null,
    tracking: tracking?.url ?? null,
  };
  const standard = standardRaw.map((s) => resolveLinkPh(s, linkUrls));
  const storia = await purchaseHistory(sb, (conv.customer_email as string) ?? null);
  const conoscenza = await csKnowledge(sb, categoria);
  // v14: conversazioni PRECEDENTI dello stesso cliente (riassunti, max 5): l'AI sa se ha gia'
  // chiesto resi/cambi/solleciti senza rileggere i thread interi. Contesto, non fonte di promesse.
  let precedenti: string[] = [];
  if (conv.customer_email && conv.id) {
    const { data: altre } = await sb.from('cs_conversations')
      .select('subject,categoria,stato,last_msg_at,summary')
      .eq('customer_email', String(conv.customer_email)).neq('id', String(conv.id))
      .order('last_msg_at', { ascending: false }).limit(5);
    precedenti = ((altre ?? []) as Row[]).map((a) =>
      `- ${String(a.last_msg_at ?? '').slice(0, 10)} [${a.categoria ?? '?'}${a.stato ? '/' + a.stato : ''}] ${String(a.subject ?? '').slice(0, 80)}${a.summary ? ': ' + String(a.summary).slice(0, 200) : ''}`);
  }
  const fonti: string[] = [];
  for (const p of prodotti) fonti.push(`${p.item} ${p.variant}: disponibili ${p.disponibili}, giacenza ${p.giacenza}${p.prezzo != null ? `, prezzo ${p.prezzo}EUR` : ''}${p.on_shopify ? ', a catalogo' : ''} (v_inventory)`);
  for (const p of prodotti) if (p.url) fonti.push(`Link scheda ${p.item} ${p.variant}: ${p.url} (shopify_catalog)`);
  if (ordine) fonti.push(`Ordine #${ordine.order_number}: pagamento ${ordine.financial_status ?? 'n/d'}, evasione ${ordine.fulfillment_status ?? 'non evaso'}${ordine.fulfilled_at ? `, evaso il ${dmy(ordine.fulfilled_at)}` : ''} (shopify_orders)`);
  if (tracking) fonti.push(`Tracking ${tracking.corriere} ${tracking.numero} (Shopify Admin API, live)`);
  if (ship) fonti.push(`Stato spedizione TWS: ${ship.stato_tws}, aggiornato al ${String(ship.updated_at).slice(0, 10)} (shipping_status)`);
  if (storia && storia.n_ordini > 0) fonti.push(`Cliente: ${storia.n_ordini} ordini, ${storia.totale}EUR totali (storico Shopify)`);
  return { dati: { prodotti, ordine, tracking, ship, standard, fonti }, tono, order_admin_url, storia, gapExtra, conoscenza, precedenti, linkUrls };
}

// v17 (brief cs_assist_migliorie punto 7): le date del BLOCCO DATI in formato italiano. Le bozze
// scrivevano "2026-08-01" a una cliente perche' e' cosi' che le leggevano qui: formattarle a monte
// e' piu' solido che chiederlo al modello nelle istruzioni. Neutro per il linter, che normalizza
// ISO e gg/mm sulla stessa chiave (vedi factKeys).
const dmy = (v: unknown): string => {
  const s = String(v ?? '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

function datiBlock(d: Dati): string {
  const L: string[] = [];
  if (d.prodotti.length) {
    L.push('PRODOTTI (giacenza/disponibilita/prezzo dal gestionale):');
    for (const p of d.prodotti) L.push(`- ${p.item} ${p.variant}: disponibili da vendere ${p.disponibili}, giacenza ${p.giacenza}${p.prezzo != null ? `, prezzo ${p.prezzo} EUR` : ''}${p.on_shopify ? ', a catalogo sul sito' : ', non a catalogo'}${p.url ? `, link scheda: ${p.url}` : p.on_shopify ? ', link scheda NON disponibile (non rimandare alla pagina del prodotto: se serve, usa [DA VERIFICARE: link scheda prodotto])' : ''}`);
    // v15: prodotto esaurito ma con scheda a catalogo -> la bozza deve dare il link dell'avviso
    // restock. Solo se e' il MIGLIOR match (il primo): mai suggerire la scheda di un'altra borsa.
    const top = d.prodotti[0];
    if (top && top.disponibili <= 0 && top.url) L.push(`NOTA RESTOCK: sulla scheda del prodotto esaurito (${top.url}) c'e' il bottone "Avvisami quando torna disponibile": nella risposta INDICA quel link come il posto dove iscriversi all'avviso ("qui puoi iscriverti per essere avvisata quando torna: ${top.url}").`);
  } else L.push('PRODOTTI: nessun prodotto identificato con certezza dal testo.');
  if (d.ordine) {
    L.push(`ORDINE #${d.ordine.order_number}: pagamento ${d.ordine.financial_status ?? 'n/d'}, evasione ${d.ordine.fulfillment_status ?? 'non ancora evaso'}${d.ordine.fulfilled_at ? `, evaso il ${dmy(d.ordine.fulfilled_at)}` : ''}${d.ordine.created_at_shop ? `, ordinato il ${dmy(d.ordine.created_at_shop)}` : ''}.`);
    if (d.ordine.righe.length) L.push('  contenuto: ' + d.ordine.righe.map((r) => `${r.qta}x ${r.nome}`).join(', '));
  } else L.push('ORDINE: nessun ordine trovato per questo cliente.');
  if (d.tracking) L.push(`TRACKING: ${d.tracking.corriere} numero ${d.tracking.numero}, link ${d.tracking.url}.`);
  else L.push('TRACKING: non disponibile dai dati (usa [DA VERIFICARE: tracking] se serve).');
  // v16: lo stato VERO del corriere (dal sistema spedizioni), quando c'e'
  // v17: la data di consegna si stampa SOLO se plausibile e osservata davvero (vedi shippingStatus).
  // Quando non c'e' ci si ferma a "CONSEGNATA", che e' vero, invece di dare una data che non e'
  // quella del corriere. Il "aggiornato al" resta ed e' un'altra cosa: quando l'abbiamo guardato.
  if (d.ship) L.push(`STATO SPEDIZIONE TWS (dal corriere, aggiornato al ${dmy(d.ship.updated_at)}): ${d.ship.stato_tws}${d.ship.consegnata_il ? `, consegnata il ${dmy(d.ship.consegnata_il)}` : ''}.`);
  if (d.standard.length) L.push('RISPOSTE STANDARD DISPONIBILI:\n' + d.standard.map((s) => '- ' + s).join('\n'));
  return L.join('\n');
}

// v18 (brief punto 10): la lingua era una riga in fondo al messaggio utente e una conversazione `en`
// usciva con l'apertura in italiano ("Ciao <nome>! Thank you for reaching out"). Qui diventa
// un'istruzione di sistema, con l'eccezione DICHIARATA della firma: quella resta in italiano perche'
// e' una scelta di casa, non una dimenticanza.
const langBlock = (lingua: unknown): string => (String(lingua ?? '') === 'en'
  ? `\nLINGUA: il cliente scrive in INGLESE, quindi la risposta va scritta TUTTA in inglese, dalla prima parola all'ultima, saluto di apertura incluso (mai "Ciao", mai parole italiane nel corpo). UNICA eccezione, voluta: la firma finale resta "Grazie, Team Amimi'".`
  : `\nLINGUA: rispondi in ITALIANO.`);

// v24 (brief cs_assist_migliorie, sezione "ESITO GIRO 2"): SCHEMA RAMI, gated da
// `app_flags.cs_rami_enabled`. Al posto di tre varianti di TONO della stessa risposta, fino a tre
// ALTERNATIVE DI CONTENUTO = gli esiti possibili della richiesta, ognuna col suo titolo: dove la
// verita' la sa solo il team (un restock arriva in tempo? si fa un'eccezione? si manda un omaggio?)
// la scelta della collega E' la risposta. Testo portato VERBATIM da `SYSTEM_V2` del prototipo che
// ha vinto il secondo giro alla cieca (15 casi, 2 giudici: 10-2-3 e 11-3-1), perche' il valore
// misurato sta in quelle parole li': riscriverle "meglio" avrebbe buttato la misura.
// DUE SCOSTAMENTI DICHIARATI dal prototipo, entrambi verso il comportamento gia' deciso dall'owner:
//  - la firma in inglese resta "Grazie, Team Amimi'" (decisione owner 01-08, punto 10 dello stesso
//    brief, gia' in produzione dalla v18): il prototipo diceva "Thanks, Team Amimi'", ma quel
//    dettaglio non era sotto giudizio nel test, mentre la decisione dell'owner si';
//  - `langBlock` e `chatBlock` restano appesi (il prototipo non li aveva perche' non aveva casi di
//    chat ne' bisogno di rinforzare la lingua): sono additivi e dicono la stessa cosa di RAMI_RULES,
//    toglierli avrebbe indebolito l'inglese e fatto uscire le bozze di chat in forma di email.
// La rifinitura "mai richiedere dati gia' presenti nel thread" NON e' duplicata qui: e' gia' viva
// in `app_flags.cs_ai_istruzioni` ("Se ha gia' scritto un dato... NON richiederglielo"), verificato
// sul valore in produzione il 01-08.
const RAMI_RULES = `NON proporre varianti di tono: proponi le possibili RISPOSTE DI CONTENUTO alla richiesta specifica di questa cliente, tutte pronte da ritoccare. NON inviarle.
QUANTE ALTERNATIVE: chiediti quali sono gli ESITI possibili della richiesta. Se i DATI determinano da soli la risposta giusta, scrivi UNA sola alternativa, COMPLETA e precisa sulla policy (numeri e condizioni esatti dai DATI e dalla CONOSCENZA: se i giorni sono lavorativi, scrivi lavorativi, anche in inglese, dove si scrive "business days" e non "days"). Se la risposta dipende da qualcosa che il sistema non sa e solo il team conosce (un restock che arriva in tempo, un'eccezione, una disponibilita' fisica, una decisione commerciale), scrivi UNA alternativa per ESITO possibile, massimo 3: sara' la collega, che conosce la verita', a scegliere quella vera. Ogni alternativa e' una risposta COMPLETA e coerente col SOLO suo esito, mai un misto di esiti.
TITOLO: ogni alternativa ha un titolo di MASSIMO 5 parole che dichiara l'esito (esempi: "Si', arriva in tempo" / "Niente restock: propongo simili" / "Serve una persona"), cosi' la collega sceglie dal titolo senza leggere i testi.
REGISTRO: SEMPRE del tu, caldo, frasi corte, 1-2 emoji leggere al massimo, chiudi con "Grazie, Team Amimi'". Il lei SOLO se la cliente scrive in modo formale o e' arrabbiata. Se la conversazione e' in inglese, TUTTO in inglese; la firma finale resta "Grazie, Team Amimi'" anche li', ed e' voluta.
REGOLA FERREA anti-invenzione: dentro ogni alternativa cita SOLO dati presenti nel BLOCCO DATI qui sotto. Un'alternativa puo' ASSUMERE l'esito dichiarato nel suo titolo anche se il sistema non lo conosce (es. che il restock arrivi in tempo, riprendendo la scadenza detta DALLA CLIENTE), ma NON puo' inventare numeri, date precise, prezzi, indirizzi o promesse operative: per quelli scrivi [DA VERIFICARE: cosa manca].
MAI dire alla cliente che il suo ordine "non risulta" o "non e' nei sistemi", nemmeno come esito di un ramo: se un dato non si trova, il ramo dice che stiamo verificando e chiede UN dato utile (es. l'email usata per l'ordine).
CASI DA NON CHIUDERE DA SOLA (in questi casi UNA delle alternative e' proprio il passaggio a una persona): difetto/garanzia -> NON negare mai il reso citando solo i 14 giorni del recesso (la garanzia legale dura 24 mesi), proponi riparazione/cambio o il contatto; disputa/chargeback/banca -> massima cautela + persona; reclamo/rivenditore/proposta B2B/preventivo cerimonia -> raccogli info e rimanda a una persona.`;

const STYLE_RULES = `STILE: dai del tu (dai del lei solo se il cliente e' formale o arrabbiato), frasi corte, 1-2 emoji leggere al massimo, chiudi con "Grazie, Team Amimi'". Niente promesse su date/numeri non nei DATI.
REGOLA FERREA anti-invenzione: cita SOLO dati presenti nel BLOCCO DATI qui sotto. Se ti serve un dato che NON c'e' (prezzo, data, indirizzo, tracking, condizione), NON inventarlo: scrivi il segnaposto [DA VERIFICARE: cosa manca].
CASI DA NON CHIUDERE DA SOLA (scrivi una risposta PRUDENTE che raccoglie info e propone il contatto di una persona; non promettere e non rifiutare): difetto/garanzia -> NON negare mai il reso citando solo i 14 giorni del recesso (la garanzia legale dura 24 mesi), proponi riparazione/cambio o il contatto; disputa/chargeback/banca -> massima cautela + persona; reclamo/rivenditore/proposta B2B/preventivo cerimonia -> raccogli info e rimanda a una persona.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(url, svc);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');

  const flags: Record<string, string> = {};
  const { data: frows } = await sb.from('app_flags').select('key,value').in('key', ['gemini_api_key', 'cs_enabled', 'cs_reso_finestra_giorni', 'anthropic_api_key', 'cs_ai_model_claude', 'cs_ai_istruzioni', 'cs_rami_enabled']);
  for (const r of frows ?? []) flags[r.key] = r.value ?? '';
  const { data: cfg } = await sb.from('app_config').select('pin_hash, shopify_token').eq('id', 1).single();
  const token = String(cfg?.shopify_token ?? '');

  // Azioni che scrivono/leggono dati cliente per la UI = gate JWT (utente reale @amimi.it), come cs-api.
  // dry_data ritorna lo STESSO payload PII di context: DEVE essere JWT (non PIN pubblico). Solo summary
  // (aggregato, cron) resta PIN. (audit 2026-07-24: dry_data dietro PIN 'x' esponeva PII cliente.)
  const JWT_ACTIONS = new Set(['context', 'dry_data', 'draft', 'refine', 'case_data']);
  const chi = ({ B: 'Benedetta', G: 'Ginevra', A: 'Ale' } as Record<string, string>)[String(body.chi || '').toUpperCase()] || 'ignoto';
  if (JWT_ACTIONS.has(action)) {
    const authz = req.headers.get('Authorization') || '';
    const tk = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';
    if (!tk) return json({ error: 'non autenticato' }, 401);
    const { data: ures, error: uerr } = await createClient(url, anon).auth.getUser(tk);
    const email = (ures?.user?.email || '').toLowerCase();
    if (uerr || !ures?.user) return json({ error: 'sessione non valida' }, 401);
    if (!email.endsWith('@amimi.it')) return json({ error: 'dominio non ammesso' }, 403);
  } else {
    if (!cfg?.pin_hash || !body.pin || (await sha256hex(String(body.pin))) !== cfg.pin_hash) return json({ error: 'PIN errato' }, 401);
  }

  const key = flags.gemini_api_key;
  // Motore AI: Claude se c'e' anthropic_api_key (owner lo mette a mano, mai in repo/chat), altrimenti Gemini free.
  const claudeKey = (flags.anthropic_api_key || '').trim();
  // migr 0084: `cs_ai_model` -> `cs_ai_model_claude` (e' SOLO il nome del modello Claude, non il selettore di motore)
  const claudeModel = (flags.cs_ai_model_claude || 'claude-sonnet-5').trim();
  // model_override (harness eval, brief 29-07): A/B sulle stesse conversazioni senza toccare i flag
  // globali, e baseline Gemini rigenerabile anche DOPO l'inserimento della chiave Anthropic. Vale solo
  // per draft/refine (rami JWT: qui siamo gia' oltre il gate), allowlist esplicita, e MAI fallback
  // silenzioso su un altro modello: falserebbe il confronto.
  const MODEL_ALLOW = ['gemini-flash-latest', 'claude-sonnet-5'];
  const override = String(body.model_override || '').trim();
  if (override && !['draft', 'refine'].includes(action)) return json({ error: 'model_override vale solo per draft/refine' }, 400);
  if (override && !MODEL_ALLOW.includes(override)) return json({ error: `model_override non ammesso: "${override}" (ammessi: ${MODEL_ALLOW.join(', ')})` }, 400);
  const useClaude = override ? override.startsWith('claude-') : !!claudeKey;
  const effModel = override || (claudeKey ? claudeModel : MODEL_DRAFT);
  const haveLLM = !!claudeKey || !!key;
  // v12: il modello REALMENTE usato (il fallback puo' cambiarlo in corsa) finisce in cs_drafts.model
  let usedModel = effModel;
  let claudeFellBack: string | null = null;
  // bozze dell'harness marcate 'eval' (migr 0080): distinguibili con una query, la UI non le vede mai
  // (le opzioni mostrate arrivano dalla risposta live, cs_drafts non viene letta dal client).
  const draftSource = body.source === 'eval' ? 'eval' : 'app';
  // "come rispondere": istruzioni editabili dal team (app_flags.cs_ai_istruzioni), iniettate come CONTESTO
  // in ogni bozza. Guidano il tono; non superano MAI la regola anti-invenzione.
  const aiIstruzioni = (flags.cs_ai_istruzioni || '').trim();
  const istruzioniBlock = aiIstruzioni ? `\nISTRUZIONI DEL TEAM (come rispondere; priorita' sullo stile generico, MAI sull'anti-invenzione):\n${aiIstruzioni}\n` : '';
  // LLM unificato: Claude (system separato) se richiesto/configurato, altrimenti Gemini (system+user
  // concatenati). v12: nell'uso NORMALE (senza override) un errore Claude RIPIEGA su Gemini invece
  // di far morire la bozza (caso reale 31-07: chiave valida, credito API a zero, bozze tutte in
  // errore). Con override attivo OGNI fallback resta disattivato, anche il retry flash-lite: il
  // modello del run deve restare quello chiesto (integrita' dell'A/B), meglio un errore che un
  // dato falsato.
  const runLLM = async (system: string, userMsg: string, maxTok: number, jsonMode: boolean, diag?: LLMDiag): Promise<string> => {
    if (useClaude) {
      try { const out = await claude(effModel, system, userMsg, claudeKey, maxTok); usedModel = effModel; return out; }
      catch (e) {
        if (override || !key) throw e;
        claudeFellBack = (e as Error).message.slice(0, 150);
        const out = await gemini(MODEL_DRAFT, system + '\n\n' + userMsg, key, maxTok, jsonMode, diag);
        usedModel = MODEL_DRAFT;
        return out;
      }
    }
    try { const out = await gemini(effModel, system + '\n\n' + userMsg, key, maxTok, jsonMode, diag); usedModel = effModel; return out; }
    catch (e) {
      if (jsonMode || override) throw e;
      const out = await gemini(MODEL_SUMMARY, system + '\n\n' + userMsg, key, maxTok, false, diag);
      usedModel = MODEL_SUMMARY;
      return out;
    }
  };

  // notifica chat Shopify Inbox: al modello serve il messaggio del cliente, non il boilerplate della
  // notifica ("You have a new message from ... / Sent via Inbox / Reply in Inbox (url)").
  const stripChat = (t: string): string => {
    const m = (t || '').match(/new message from[^\n]*\n+([\s\S]*?)\n+\s*Sent via Inbox/i);
    return m ? m[1].trim() : (t || '');
  };

  // carica conversazione + testo del cliente (usato da context/dry_data/draft/refine)
  // v11: lingua SEMPRE caricata (serve a faqTono per scegliere testo_en anche su context)
  // v13: ogni messaggio porta `testo` = body_clean (fallback: stripChat/raw). Il PROMPT usa
  // `testo` (meno rumore); il CORPUS del linter usa il RAW body_text (i numeri citati restano
  // fatti consentiti). body_text nei row NON viene piu' sovrascritto.
  const loadConv = async (_withLingua = false): Promise<{ conv: Row; inbound: string; recent: Row[]; clienti: string[] } | null> => {
    const convId = String(body.conversation_id || '');
    const cols = 'id,canale,customer_email,customer_name,order_number,categoria,subject,lingua';
    const { data: conv } = await sb.from('cs_conversations').select(cols).eq('id', convId).maybeSingle();
    if (!conv) return null;
    // v14: THREAD INTERO (cap 30 messaggi, i piu' recenti): prima si vedevano solo gli ultimi 4
    // v20: e con loro l'elenco dei CLIENTI distinti che hanno scritto in questa conversazione.
    const { data: msgs } = await sb.from('cs_messages').select('direction,body_text,body_clean,form_fields,from_email,reply_to,sent_at').eq('conversation_id', convId).order('sent_at', { ascending: false }).limit(30);
    const recent = ((msgs ?? []) as Row[]).slice().reverse().map((m): Row => ({
      ...m,
      testo: String(m.body_clean ?? '') || (conv.canale === 'chat_notifica' ? stripChat(String(m.body_text ?? '')) : String(m.body_text ?? '')),
    }));
    const lastIn = [...recent].reverse().find((m) => m.direction === 'in') as Row | undefined;
    const inbound = [conv.subject, lastIn?.testo, lastIn?.form_fields ? JSON.stringify(lastIn.form_fields) : ''].filter(Boolean).join(' ');
    // v20: i clienti DISTINTI che hanno scritto qui dentro. Serve perche' due invii dal modulo nello
    // stesso minuto finiscono nello stesso thread Gmail e quindi, oggi, nella stessa conversazione:
    // la bozza userebbe il TESTO di uno e l'ordine/email dell'ALTRO, e la guardia del v11 non
    // scatta perche' un'email c'e', solo che e' di un'altra persona. Stessa funzione di cs-send v4.
    const clienti = [...new Set(recent.filter((m) => m.direction === 'in')
      .map((m) => emailCliente({ from_email: (m.from_email as string) ?? null, form_fields: (m.form_fields as Record<string, string>) ?? null, reply_to: (m.reply_to as string) ?? null }))
      .filter((e): e is string => !!e))];
    return { conv: conv as Row, inbound, recent, clienti };
  };
  // cronologia per il prompt (CLEAN) e per il corpus del linter (RAW, slice piu' larga: regex, zero AI)
  const threadClean = (recent: Row[], subject: unknown): string =>
    recent.map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${String(m.testo ?? '').slice(0, 800)}`).join('\n') || String(subject ?? '');
  const threadRaw = (recent: Row[], subject: unknown): string =>
    recent.map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${String(m.body_text ?? '').slice(0, 4000)}`).join('\n') || String(subject ?? '');

  // ---------- context / dry_data: assembla il CONTESTO, nessun Gemini ----------
  if (action === 'context' || action === 'dry_data') {
    const lc = await loadConv();
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const ctx = await assembleContext(sb, lc.conv, lc.inbound, token, (lc.conv.categoria as string) ?? null);
    // contratto di contesto: cosa manca per rispondere bene a QUESTA categoria (mostrato prima di generare)
    const gaps = [...contractGaps((lc.conv.categoria as string) ?? null, ctx.dati), ...ctx.gapExtra,
      // v20: il contesto si mostra lo stesso (l'operatrice deve poter LEGGERE), ma con l'avviso in
      // testa. La bozza invece non si genera: vedi la guardia in draft/refine.
      ...(lc.clienti.length > 1 ? [`ATTENZIONE: in questa conversazione hanno scritto ${lc.clienti.length} clienti diversi (${lc.clienti.join(', ')}). Le bozze sono disabilitate: rispondi a ciascuno separatamente dal thread Gmail.`] : [])];
    return json({ ok: true, fonti: ctx.dati.fonti, gaps, order_admin_url: ctx.order_admin_url, storia: ctx.storia, dati: ctx.dati });
  }

  // ---------- case_data: motore dei verdetti (JWT, NESSUN Gemini) ----------
  // La UI lo chiama su Reso/Cambio/Indirizzo; `delivered_at` opzionale = data confermata dalla collega
  // dal tracking (STEP 1 pragmatico): il verdetto resta deterministico, su un fatto umano.
  if (action === 'case_data') {
    const lc = await loadConv();
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    const conv = lc.conv;
    const ordine = await lookupOrder(sb, (conv.order_number as number) ?? null, (conv.customer_email as string) ?? null);
    const meta = ordine ? await fetchOrderMeta(ordine.order_number, token) : null;
    const ship = ordine ? await shippingStatus(sb, ordine.order_number) : null;   // v16
    const finestra = Number(flags.cs_reso_finestra_giorni) || 14;
    const confirmed = String(body.delivered_at || '').trim() || null;
    const cd = computeCaso(conv, ordine, meta, lc.inbound, finestra, confirmed, ship);
    return json({
      ok: true, categoria: (conv.categoria as string) ?? null, verificato: cd.verificato,
      reso: cd.reso, indirizzo: cd.indirizzo,
      // v25 (spec v17 punto 3): l'ELENCO dei rami ammessi, non solo il verdetto secco. Esposto
      // SEMPRE, anche a flag rami spento: e' informazione in piu' e nessun client la usa ancora,
      // ma da qui si vede cosa il motore ha davvero deciso senza dover leggere il prompt.
      rami: casoRami((conv.categoria as string) ?? null, cd),
      tracking_url: meta?.tracking?.url ?? null,
      order_admin_url: meta?.adminId ? `https://admin.shopify.com/store/${SHOP}/orders/${meta.adminId}` : null,
      stato_tws: ship?.stato_tws ?? null, stato_tws_aggiornato: ship ? String(ship.updated_at).slice(0, 10) : null,   // v16: card UI
    });
  }

  // ---------- summary: riassunto+storia (cron), Gemini flash-lite ----------
  if (action === 'summary') {
    if (String(body.source || 'manual') === 'cron' && flags.cs_enabled !== 'true') return json({ ok: true, skipped: 'disabled' });
    if (!key) return json({ ok: false, needs_key: true });
    const limit = Math.min(Number(body.limit) || MAX_SUMMARY_PER_RUN, MAX_SUMMARY_PER_RUN);
    const { data: convs } = await sb.from('cs_conversations').select('id,customer_email,customer_name,subject,snippet,categoria').is('summary', null).neq('canale', 'rumore').eq('parse_failed', false).order('last_msg_at', { ascending: true, nullsFirst: true }).limit(limit);
    let done = 0, failed = 0;
    for (const c of (convs ?? []) as Row[]) {
      const { data: msgs } = await sb.from('cs_messages').select('direction,body_text,body_clean').eq('conversation_id', c.id as string).order('sent_at', { ascending: true }).limit(12);
      const thread = ((msgs ?? []) as Row[]).map((m) => `${m.direction === 'out' ? 'Noi' : 'Cliente'}: ${(String(m.body_clean ?? '') || String(m.body_text ?? '')).slice(0, 500)}`).join('\n');
      let storia = '';
      if (c.customer_email) {
        const { data: altre } = await sb.from('cs_conversations').select('subject,categoria,stato,last_msg_at,summary').eq('customer_email', c.customer_email as string).neq('id', c.id as string).order('last_msg_at', { ascending: false }).limit(5);
        storia = ((altre ?? []) as Row[]).map((a) => `- ${String(a.last_msg_at ?? '').slice(0, 10)} [${a.categoria ?? '?'}/${a.stato}] ${a.subject ?? ''}`).join('\n');
      }
      const prompt = `Sei l'assistente di "Amimi'" (borse artigianali). Scrivi un RIASSUNTO in MASSIMO 2 righe di questa conversazione cliente: chi e', cosa vuole ORA, e (se rilevante) cosa le abbiamo gia' detto/fatto nelle conversazioni precedenti. Italiano, conciso, niente elenchi, niente saluti. Non inventare nulla: se non sai, ometti.
Cliente: ${c.customer_name ?? c.customer_email ?? 'sconosciuto'}
Conversazione attuale:
${thread || String(c.subject ?? '')}
${storia ? `Altre conversazioni dello stesso cliente:\n${storia}` : ''}
Riassunto (max 2 righe):`;
      try {
        const s = (await gemini(MODEL_SUMMARY, prompt, key, 200)).slice(0, 600);
        await sb.from('cs_conversations').update({ summary: s, summary_at: new Date().toISOString() }).eq('id', c.id as string);
        await sb.from('cs_events').insert({ conversation_id: c.id, azione: 'summary', chi: 'cs-assist', dettaglio: { len: s.length } });
        done++;
      } catch { failed++; }
    }
    const { count: remaining } = await sb.from('cs_conversations').select('id', { count: 'exact', head: true }).is('summary', null).neq('canale', 'rumore').eq('parse_failed', false);
    return json({ ok: true, done, failed, remaining: remaining ?? 0 });
  }

  // ---------- draft: 3 opzioni (JWT), Claude o Gemini, una sola chiamata ----------
  if (action === 'draft') {
    if (!haveLLM) return json({ ok: false, needs_key: true, error: 'Nessun motore AI configurato (Gemini o Claude).' });
    // chiave del motore RICHIESTO assente -> needs_key, mai ripiegare sull'altro (falserebbe l'A/B)
    if (useClaude && !claudeKey) return json({ ok: false, needs_key: true, error: 'model_override Claude ma anthropic_api_key assente: nessun fallback.' });
    if (!useClaude && !key) return json({ ok: false, needs_key: true, error: 'motore Gemini richiesto ma gemini_api_key assente.' });
    const lc = await loadConv(true);
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    // v20: due clienti nella stessa conversazione = nessuna bozza. Succede quando due invii dal
    // modulo nello stesso minuto finiscono nello stesso thread Gmail: la bozza nascerebbe dal TESTO
    // di uno e dai DATI dell'altro (ordine, storico, email), e sarebbe un dato di un terzo dentro
    // una risposta. Meglio niente bozza di una bozza mescolata: cs-send rifiuterebbe comunque
    // l'invio (v4), ma qui il dato non viene nemmeno assemblato.
    if (lc.clienti.length > 1) return json({ ok: false, error: `questa conversazione contiene richieste di ${lc.clienti.length} clienti diversi (${lc.clienti.join(', ')}): nessuna bozza, rispondi a ciascuno separatamente dal thread Gmail.`, cross_cliente: lc.clienti }, 422);
    const conv = lc.conv;
    // v24: schema RAMI (alternative di CONTENUTO) contro schema TONI (breve/calda/formale).
    // Interruttore in `app_flags.cs_rami_enabled`: a flag spento prompt, contratto JSON e blocco
    // CASO sono BYTE PER BYTE quelli di prima, cosi' il rollback non richiede un deploy.
    // Dichiarata qui in alto perche' dalla v25 decide anche la forma del blocco CASO, che si
    // costruisce prima del prompt.
    const rami = flags.cs_rami_enabled === 'true';
    const ctx = await assembleContext(sb, conv, lc.inbound, token, (conv.categoria as string) ?? null);
    const threadTxt = threadClean(lc.recent, conv.subject);
    // motore dei verdetti: sulle categorie a caso (reso/cambio/indirizzo) il CASO e' calcolato dal codice
    // (con eventuale delivered_at confermata dalla collega) e VINCOLA la bozza. L'AI non decide, esegue.
    let casoTxt = '';
    if (CASE_CATS.has(String(conv.categoria ?? ''))) {
      const meta2 = ctx.dati.ordine ? await fetchOrderMeta(ctx.dati.ordine.order_number, token) : null;
      const cd = computeCaso(conv, ctx.dati.ordine, meta2, lc.inbound, Number(flags.cs_reso_finestra_giorni) || 14, String(body.delivered_at || '').trim() || null, ctx.dati.ship);
      // v25: a schema rami il caso arriva come ELENCO di rami ammessi invece che come verdetto secco;
      // a flag spento resta `casoBlock`, byte per byte quello di prima.
      casoTxt = rami ? casoBlockRami((conv.categoria as string) ?? null, cd) : casoBlock((conv.categoria as string) ?? null, cd);
    }

    const inChat = conv.canale === 'chat_notifica';
    // canale chat: la bozza verra' incollata nella chat di Shopify Inbox, non in una email
    const chatBlock = !inChat ? ''
      : rami
        ? `\nCANALE CHAT: la risposta verra' incollata nella CHAT del sito (Shopify Inbox), NON in una email: niente oggetto, niente intestazioni da email, messaggi corti stile chat. Vale per ogni alternativa.`
        : `\nCANALE CHAT: la risposta verra' incollata nella CHAT del sito (Shopify Inbox), NON in una email: niente oggetto, niente intestazioni da email, messaggi corti stile chat (anche la versione "formale" resta un messaggio di chat, solo piu' composto).`;
    const system = rami
      ? `Sei chi risponde al servizio clienti di "Amimi'" (borse artigianali, Milano). ${RAMI_RULES}${langBlock(conv.lingua)}${istruzioniBlock}${casoTxt}${chatBlock}`
      : `Sei chi risponde al servizio clienti di "Amimi'" (borse artigianali, Milano). Scrivi TRE versioni ALTERNATIVE della stessa risposta ${inChat ? 'in chat' : 'email'} al cliente, con toni diversi, tutte pronte da ritoccare. NON inviarle.
LE TRE VERSIONI (usa esattamente questi tre "tono"): "breve" = 2-3 righe, dritta al punto, cordiale; "calda" = piu' empatica e personale, un pizzico di calore; "formale" = piu' completa e composta, adatta a casi delicati.
${STYLE_RULES}${langBlock(conv.lingua)}${istruzioniBlock}${casoTxt}${chatBlock}`;
    const user = `Lingua: ${conv.lingua === 'en' ? 'inglese' : 'italiano'}. Categoria: ${conv.categoria ?? 'n/d'}. Cliente: ${conv.customer_name ?? ''}.
${ctx.conoscenza.length ? `\nCONOSCENZA DI CASA (regole e fatti Amimi'; se un valore qui contraddice il BLOCCO DATI, vince il BLOCCO DATI):\n${ctx.conoscenza.map((k) => '- ' + k).join('\n')}\n` : ''}${ctx.precedenti.length ? `\nCONVERSAZIONI PRECEDENTI DI QUESTO CLIENTE (contesto: tienine conto nel tono e nei riferimenti, NON promettere nulla in base a queste):\n${ctx.precedenti.join('\n')}\n` : ''}
Conversazione (il piu' recente e' del cliente):
${threadTxt}

BLOCCO DATI (l'unica fonte di numeri che puoi usare):
${datiBlock(ctx.dati)}
${ctx.tono.length ? `\nEsempi del NOSTRO tono (imita lo stile, non copiare i contenuti):\n${ctx.tono.map((t) => '- ' + t).join('\n')}` : ''}

Rispondi SOLO con JSON valido in questo formato ESATTO, niente altro testo (nessun markdown, nessun **grassetto**):
${rami
  ? '{"alternative":[{"titolo":"...","testo":"..."}]}\n(da 1 a 3 alternative, in ordine dalla piu\' probabile)'
  : '{"opzioni":[{"tono":"breve","testo":"..."},{"tono":"calda","testo":"..."},{"tono":"formale","testo":"..."}]}'}`;

    // pulizia bozza: via i titoli markdown tipo **BREVE** e i grassetti (la mail e' testo semplice)
    const tidy = (t: string) => t.replace(/^\s*\*\*[^*\n]{2,24}\*\*\s*/i, '').replace(/\*\*/g, '').trim();
    let opzioni: { tono: string; titolo?: string; testo: string }[] = [];
    let fallbackSingola = false;
    // v24: col nuovo schema UNA sola alternativa e' un esito legittimo ("i dati decidono da soli"),
    // non un giro andato male: la soglia di completezza scende a 1, altrimenti ogni caso deciso
    // farebbe scattare un secondo giro inutile e poi il ripiego.
    const minOpts = rami ? 1 : 3;
    // v19 (brief cs_bozze_troncate): diagnostica del giro (o dei giri) e motivo del ripiego, esposti.
    const diag: LLMDiag = {};
    let tentativi = 0, tetto = 0;
    try {
      // v17: tetto a 4000 (con 2400 una risposta si era interrotta a meta' della seconda opzione).
      // v19: 4000 NON basta sempre - due generazioni indipendenti sulla stessa conversazione inglese
      // sono uscite a 145 e 137 caratteri, e in tutto lo storico ci sono 5 bozze tagliate a meta'
      // parola, anche italiane. Quindi: un solo tentativo non e' piu' accettabile. Se il JSON non
      // rende TRE opzioni, o il modello dichiara MAX_TOKENS, si RIPROVA una volta con il doppio di
      // budget prima di degradare. Su Gemini Flash il costo di un secondo giro e' trascurabile
      // rispetto a un'operatrice che riceve una bozza monca.
      // v24: il tetto del PRIMO giro sale da 4000 a 6000 su ENTRAMBI gli schemi. Non e' una scelta
      // del nuovo contratto: la sonda di varianza del 01-08 (33 generazioni) ha misurato 1.572 token
      // di ragionamento in media, che su questo endpoint contano DENTRO maxOutputTokens e ogni tanto
      // se lo mangiano tutto (1 giro su 33 morto a 2.396/2.400). Alzare non costa nulla, i pensieri
      // vengono generati e fatturati comunque: il tetto alto evita solo la morte a meta' JSON.
      const parseOpts = (raw: string) => {
        let parsed: { opzioni?: { tono?: unknown; testo?: unknown }[]; alternative?: { titolo?: unknown; testo?: unknown }[] } = {};
        try { parsed = JSON.parse(cleanJson(raw)); }
        catch {   // JSON sporco/troncato: prova a estrarre il blocco { ... } piu' esterno
          const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
          if (a >= 0 && b > a) { try { parsed = JSON.parse(raw.slice(a, b + 1)); } catch { parsed = {}; } }
        }
        if (rami) {
          return (Array.isArray(parsed?.alternative) ? parsed.alternative : [])
            .map((o) => ({ tono: 'ramo', titolo: tidy(String(o.titolo ?? '')).slice(0, 60), testo: tidy(String(o.testo ?? '')) }))
            .filter((o) => o.testo);
        }
        return (Array.isArray(parsed?.opzioni) ? parsed.opzioni : []).map((o) => ({ tono: String(o.tono ?? ''), testo: tidy(String(o.testo ?? '')) })).filter((o) => o.testo);
      };
      for (const budget of [6000, 10000]) {
        tentativi++; tetto = budget;
        const raw = await runLLM(system, user, budget, true, diag);
        opzioni = parseOpts(raw);
        const complete = opzioni.length >= minOpts && !opzioni.some((o) => sembraTroncata(o.testo));
        if (complete) break;
        if (diag.finishReason && diag.finishReason !== 'MAX_TOKENS' && opzioni.length >= minOpts) break;   // corte ma finite di proposito
      }
    } catch { opzioni = []; }
    if (!opzioni.length) {
      // fallback robusto: UNA sola bozza in testo semplice. NON chiede piu' "TRE versioni" (bug 24-07).
      // v17: il ripiego non e' piu' SILENZIOSO. Prima l'operatrice vedeva una opzione invece di tre
      // senza nessun segnale, e sembrava un capriccio del tool: ora esce `fallback_singola` nella
      // risposta (stesso schema di `engine_fallback`) e la UI puo' dire cosa e' successo.
      fallbackSingola = true;
      try {
        // v24: col nuovo schema le frasi da sostituire sono altre. Se la sostituzione non
        // agganciasse nulla, il ripiego chiederebbe ancora un JSON e uscirebbe di nuovo vuoto:
        // ogni ramo ha la SUA coppia di regex, nessuna delle due lavora a vuoto.
        const sysSingle = rami
          ? system
            .replace(/NON proporre varianti di tono: proponi le possibili RISPOSTE DI CONTENUTO alla richiesta specifica di questa cliente, tutte pronte da ritoccare\. NON inviarle\./, 'Scrivi UNA bozza di risposta al cliente, pronta da ritoccare. NON inviarla.')
            .replace(/^QUANTE ALTERNATIVE:[^\n]*\n/m, '')
            .replace(/^TITOLO:[^\n]*\n/m, '')
          : system
            .replace(/Scrivi TRE versioni ALTERNATIVE della stessa risposta [^\n]+? al cliente, con toni diversi, tutte pronte da ritoccare\. NON inviarle\./, 'Scrivi UNA bozza di risposta al cliente, pronta da ritoccare. NON inviarla.')
            .replace(/LE TRE VERSIONI[^\n]*\n/, '');
        const usrSingle = user.replace(/Rispondi SOLO con JSON[\s\S]*$/, 'Scrivi SOLO la bozza (nessun JSON, nessun titolo, nessuna spiegazione, nessun markdown):');
        const single = await runLLM(sysSingle, usrSingle, 2000, false, diag);   // v19: 1000 era stretto quanto il tetto che stiamo curando
        if (single) opzioni = [{ tono: 'bozza', testo: tidy(single) }];
      } catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
    }
    if (!opzioni.length) return json({ ok: false, error: 'bozza vuota' }, 502);
    // linter di aderenza: ogni numero/data/URL della bozza deve esistere nel corpus dei fatti
    // consentiti. v13: il corpus usa il thread RAW (citazioni incluse), il prompt quello CLEAN.
    const lintCorpus = factKeys([
      threadRaw(lc.recent, conv.subject), datiBlock(ctx.dati), casoTxt, ctx.dati.fonti.join('\n'), ctx.tono.join('\n'),
      aiIstruzioni, rami ? RAMI_RULES : STYLE_RULES, JSON.stringify(ctx.storia ?? ''), String(conv.order_number ?? ''),
      ctx.conoscenza.join('\n'), ctx.precedenti.join('\n'),   // v14: i valori di casa (14, 3.90, CAP...) sono fatti consentiti
    ].join('\n'));
    // v15: safety net sui segnaposto di LINK sopravvissuti alla generazione, per TIPO (v19).
    // Solo l'url del MIGLIOR match, mai quello di un altro prodotto (vedi assembleContext).
    const options = opzioni.slice(0, 3).map((o, i) => {
      const testo = scrubPlaceholders(scrubLinkPh(o.testo, ctx.linkUrls));
      // v24: se il modello lascia un titolo vuoto la scelta resterebbe senza etichetta, e la collega
      // dovrebbe leggere tutti i testi per capire quale sia quale: si ripiega su un ordinale.
      const titolo = o.titolo?.trim() || (rami ? `Alternativa ${i + 1}` : '');
      return { tono: o.tono, ...(rami ? { titolo } : {}), testo, da_verificare: countDaVerificare(testo), non_grounded: lintDraft(testo, lintCorpus), ...(sembraTroncata(testo) ? { troncata: true } : {}) };
    });
    // v19: una bozza tagliata non arriva MAI muta all'operatrice.
    const troncate = options.filter((o) => o.troncata).length;
    // v24: i titoli generati si conservano ANCHE quando nessuno sceglie (dice quali esiti il motore
    // aveva visto). Il ramo scelto lo scrive dopo cs-api `draft_ramo`, all'invio.
    const ramiTitoli = rami && !fallbackSingola ? options.map((o) => (o as { titolo?: string }).titolo ?? '') : null;

    const { data: ins } = await sb.from('cs_drafts').insert({ conversation_id: conv.id, testo: options[0].testo, dati_usati: ctx.dati as unknown as Row, model: usedModel, source: draftSource, rami: ramiTitoli }).select('id').single();
    await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'draft', chi, dettaglio: { draft_id: ins?.id, n_options: options.length, tentativi, tetto_token: tetto, llm: diag, ...(ramiTitoli ? { schema: 'rami', rami: ramiTitoli } : {}), ...(troncate ? { troncate } : {}), ...(fallbackSingola ? { fallback_singola: true } : {}), ...(draftSource === 'eval' ? { source: 'eval', model: usedModel } : {}), ...(claudeFellBack ? { fallback_da_claude: claudeFellBack } : {}) } });
    return json({
      ok: true, options, draft: options[0].testo, da_verificare: options[0].da_verificare,   // draft = retro-compat
      schema: ramiTitoli ? 'rami' : 'toni',   // v24: la UI etichetta le scelte di conseguenza
      fonti: ctx.dati.fonti, order_admin_url: ctx.order_admin_url, storia: ctx.storia, draft_id: ins?.id, llm: diag,
      ...(claudeFellBack ? { engine_fallback: 'gemini' } : {}),
      ...(fallbackSingola ? { fallback_singola: true } : {}),
      ...(troncate ? { troncate } : {}),
    });
  }

  // ---------- refine: riscrivi una bozza data applicando un'istruzione (JWT), Claude o Gemini ----------
  if (action === 'refine') {
    if (!haveLLM) return json({ ok: false, needs_key: true, error: 'Nessun motore AI configurato (Gemini o Claude).' });
    if (useClaude && !claudeKey) return json({ ok: false, needs_key: true, error: 'model_override Claude ma anthropic_api_key assente: nessun fallback.' });
    if (!useClaude && !key) return json({ ok: false, needs_key: true, error: 'motore Gemini richiesto ma gemini_api_key assente.' });
    const testo = String(body.testo || '').trim();
    const istruzione = String(body.istruzione || '').trim();
    if (!testo || !istruzione) return json({ error: 'servono testo e istruzione' }, 422);
    const lc = await loadConv(true);
    if (!lc) return json({ error: 'conversazione inesistente' }, 404);
    // v20: due clienti nella stessa conversazione = nessuna bozza. Succede quando due invii dal
    // modulo nello stesso minuto finiscono nello stesso thread Gmail: la bozza nascerebbe dal TESTO
    // di uno e dai DATI dell'altro (ordine, storico, email), e sarebbe un dato di un terzo dentro
    // una risposta. Meglio niente bozza di una bozza mescolata: cs-send rifiuterebbe comunque
    // l'invio (v4), ma qui il dato non viene nemmeno assemblato.
    if (lc.clienti.length > 1) return json({ ok: false, error: `questa conversazione contiene richieste di ${lc.clienti.length} clienti diversi (${lc.clienti.join(', ')}): nessuna bozza, rispondi a ciascuno separatamente dal thread Gmail.`, cross_cliente: lc.clienti }, 422);
    const conv = lc.conv;
    const ctx = await assembleContext(sb, conv, lc.inbound, token, (conv.categoria as string) ?? null);

    const chatBlockR = conv.canale === 'chat_notifica' ? `\nCANALE CHAT: la risposta verra' incollata nella CHAT del sito (Shopify Inbox), NON in una email: niente oggetto, niente intestazioni da email, messaggio corto stile chat.` : '';
    const sysR = `Sei chi risponde al servizio clienti di "Amimi'". Ti do una BOZZA di risposta al cliente e una richiesta di modifica. Riscrivi la bozza applicando la modifica. NON inviarla.
${STYLE_RULES}${langBlock(conv.lingua)}${istruzioniBlock}${chatBlockR}`;
    const usrR = `Lingua: ${conv.lingua === 'en' ? 'inglese' : 'italiano'}.
RICHIESTA DI MODIFICA (dalla collega): ${istruzione.slice(0, 400)}

BOZZA ATTUALE:
${testo.slice(0, 2500)}

BLOCCO DATI (l'unica fonte di numeri che puoi usare):
${datiBlock(ctx.dati)}
${ctx.conoscenza.length ? `\nCONOSCENZA DI CASA (regole e fatti Amimi'; se contraddice il BLOCCO DATI, vince il BLOCCO DATI):\n${ctx.conoscenza.map((k) => '- ' + k).join('\n')}` : ''}
${ctx.tono.length ? `\nEsempi del NOSTRO tono (imita lo stile, non copiare i contenuti):\n${ctx.tono.map((t) => '- ' + t).join('\n')}` : ''}

Scrivi SOLO la nuova bozza (nessuna spiegazione, nessun oggetto, nessun markdown):`;

    let out = '';
    try { out = await runLLM(sysR, usrR, 2000, false); }   // v19: 800 era sotto la soglia di troncamento osservata
    catch (e) { return json({ ok: false, error: (e as Error).message }, 502); }
    if (!out) return json({ ok: false, error: 'bozza vuota' }, 502);
    out = out.replace(/^\s*\*\*[^*\n]{2,24}\*\*\s*/i, '').replace(/\*\*/g, '').trim();
    out = scrubPlaceholders(scrubLinkPh(out, ctx.linkUrls));   // v15/v19: link per tipo + cintura segnaposto
    // linter di aderenza anche sulla riscrittura (la bozza di partenza NON e' fonte: potrebbe gia' inventare)
    // v13: corpus sul thread RAW (citazioni incluse), come su draft
    const lintCorpusR = factKeys([
      threadRaw(lc.recent, conv.subject), datiBlock(ctx.dati), ctx.dati.fonti.join('\n'), ctx.tono.join('\n'),
      aiIstruzioni, STYLE_RULES, JSON.stringify(ctx.storia ?? ''), String(conv.order_number ?? ''), istruzione,
      ctx.conoscenza.join('\n'),   // v14: i valori di casa sono fatti consentiti anche in riscrittura
    ].join('\n'));
    await sb.from('cs_events').insert({ conversation_id: conv.id, azione: 'refine', chi, dettaglio: { istruzione: istruzione.slice(0, 200), ...(claudeFellBack ? { fallback_da_claude: claudeFellBack } : {}) } });
    return json({ ok: true, draft: out, da_verificare: countDaVerificare(out), non_grounded: lintDraft(out, lintCorpusR), ...(sembraTroncata(out) ? { troncata: true } : {}), ...(claudeFellBack ? { engine_fallback: 'gemini' } : {}) });
  }

  return json({ error: 'azione sconosciuta: ' + action }, 422);
});
