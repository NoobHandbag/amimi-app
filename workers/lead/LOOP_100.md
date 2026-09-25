# Loop "100 pronti": ricerca negozi B2B a lotti finche' non ci sono 100 profili pronti

> Scritto il 2026-09-25 da Claude Code. Sostituisce, per questo obiettivo, il blocco "collect --limit 40" del mega prompt del 10-09 (`B2B_Prospecting_2026-09/MEGA_PROMPT_Ricerca_Massiva_Opus.md`, oggi solo nella vecchia cartella OneDrive): stesso collector e stesso giudice, ma il lotto lo sceglie `next_batch.mjs` per priorita' invece che per data di inserimento.

## Cosa conta come "pronto"

Un profilo e' PRONTO quando: `stato_ricerca = scored`, ultimo score con `tier_proposto` A o B, `dati_incompleti = false`, e almeno una email (anagrafica o evidenze `site_meta` / `contatti_trovati`). E' la soglia minima per finire nella Coda outreach con una bozza AI sensata. Il contatore e' `node progress.mjs` (exit 0 = target raggiunto, 3 = non ancora).

Stato al 25-09 mattina: **39 pronti** (9 A, 30 B), piu' 4 A/B senza email e 1.426 seed in coda. Mancano 61.

## Come si sceglie il lotto (`priority.mjs`, test in `tests/lead_priority.mjs`)

Punteggio del seed = resa della fonte x area x segnale Maps x nome.

- **Resa della fonte**, ricalcolata a ogni lotto dai giudizi gia' dati: (A/B completi + 1) / (giudicati + 3). Al 25-09: concept store 14/24, boutique accessori 4/13, bijoux 2/6, borse artigianali 4/24 (quasi tutti produttori a marchio proprio), boutique donna 3/20, regali design mai provata. Quindi si parte dai **concept store**, e una fonte che rende poco scende da sola.
- **Area**: Lombardia intorno a Milano (Milano, Monza, Como, Bergamo, Brescia, Pavia, Varese) 1, resto del cerchio 1 0,85: a parita', prima i negozi che si possono visitare.
- **Segnale Maps** (dalla nota del seed): 4,5+ con 20+ recensioni 1; 4,0+ con 20+ 0,9; 10-19 recensioni 0,85; meno di 10 o senza rating 0,6; sotto 4,0 0,4.
- **Nome fuori target** (sposa, cerimonia, kids, factory shop, pelletteria, outlet...): meta'.
- Tetto di 5 per citta' dentro un lotto, cosi' un lotto non finisce tutto a Venezia.

## Il giro (un lotto = 20 profili, circa 30 min di collector + il giudizio)

Da `workers/lead/` del checkout di amimi-app, con `SUPABASE_ACCESS_TOKEN` nell'ambiente (variabile utente Windows).

1. `node progress.mjs`: se exit 0, STOP (target raggiunto).
2. `node next_batch.mjs --n 20 --collect`: sceglie il lotto, lo salva in `out/lotto_<ts>.json` e lancia `collect.mjs --ids ...`. Si rifiuta di partire (exit 2) se ci sono account `enriched` non giudicati: prima si chiude il lotto precedente.
3. `node judge_digest.mjs --stato enriched > out/digest_<ts>.txt`: leggi il digest; per i candidati sopra 55 apri almeno tre immagini (feed IG, home mobile, foto Maps) con `judge_dump.mjs` o dal bucket.
4. Scrivi `out/scores_<ts>.json` (formato nella testata di `judge_write.mjs`) con la **rubrica v1** qui sotto, poi `node judge_write.mjs out/scores_<ts>.json`.
5. Per i nuovi A/B senza email: cerca un'email aziendale pubblicata (sito, bio IG, pagina contatti) e aggiungila come evidenza `contatti_trovati`. Mai email dedotte.
6. Una riga nel log del giro (`out/LOOP_100_<data>.md`): ora, lotto, pronti prima e dopo, errori del collector.

**Stop-loss** (ci si ferma e si scrive perche'): errori del collector sopra il 20% in un lotto; muro di login Instagram su 5+ profili di fila o errori 429 (pausa 2 ore); 3 lotti di fila con meno di 2 pronti nuovi (la coda buona e' finita: serve un nuovo sweep, vedi sotto); `judge_write` fallisce.

## Rubrica v1 (approvata 08-09; la v2 NON e' approvata, non cambiare i pesi)

| Criterio | Peso | 10 | 7 | 5 | 3 | 0 |
|---|---|---|---|---|---|---|
| Brand a scaffale | 25 | 2+ brand affini | 1 brand affine | brand indipendenti italiani non in lista | accessori generici o import | solo griffe o niente accessori |
| Stile | 20 | colorato, estivo, femminile, contemporaneo | contemporaneo neutro con colore | classico elegante | minimal nero o luxury freddo | streetwear, sport, incoerente |
| Posto e cliente | 20 | resort alto o hotel 5 stelle | via di passeggio a Milano o citta' target | turistica media o zona secondaria | centro di citta' non target | periferia, centro commerciale |
| Vitalita' | 15 | attivo su piu' fonti | attivo su una fonte | aperto ma poco visibile | segnali dubbi | chiuso o fermo da un anno |
| Raggiungibilita' | 10 | referente con nome, email nominativa, telefono | email nominativa o referente | email generica e telefono | solo form o DM | nessun contatto |
| Presenza digitale | 10 | IG 10.000+ e attivo | 3.000-10.000 | sotto 3.000 | niente IG ma sito curato | nessuna presenza |

Brand affini: `PEER_BRANDS` in `lib.mjs` (Lisa Corti, Le Orsine, MyStyleBag, Orciani, Gianni Chiarini/GUM, LaDoubleJ, De Siena, Pelletteria Marant, Euterpe Studio, Borse Valentina, Gamberini). Bonus fino a 10: +5 gruppo o hotel con piu' boutique, +5 in 2+ stockist affini, +5 aggancio personale. Esclusione secca: monomarca, chiuso, Russia. Criterio senza evidenza = NULL, mai 0. Tier: A 75+, B 55-74, C sotto 55. Una riga di prova per criterio con l'id evidenza (8 caratteri), motivazione in 3 righe, perche_no in 1, gancio solo sopra 55 e solo su un fatto vero del dossier.

Due difetti noti della v1 da tenere a mente nel giudizio (non si correggono qui, si scrivono nel perche_no): luxury multimarca con borse a mediana sopra 400 euro salgono in B via posto+vitalita'; produttori a marchio proprio non sono rivenditori.

## Quando la coda buona finisce

Con la resa del 25-09 (concept store circa 58%) i 246 seed concept store dovrebbero bastare per i 61 mancanti; il conto vero lo da' `progress.mjs` dopo ogni lotto. Se lo stop-loss "3 lotti poveri" scatta prima, il sweep successivo con la resa migliore attesa e' quello delle **localita' resort** (il profilo dei 10 A/B su 14 della lista di Benny): `node seed_maps.mjs --cities "Forte dei Marmi,Portofino,Santa Margherita Ligure,Capri,Positano,Porto Cervo,Cortina d'Ampezzo,Taormina,Bellagio,Courmayeur" --queries "concept store,boutique donna"` e poi `node seed.mjs <out>`. Esce dal cerchio 1: serve l'OK dell'owner prima di lanciarlo.

## Vincoli (dal mega prompt, invariati)

Non si contatta nessuno. Il modulo scrive solo `lead_*` e il bucket `lead-assets`, mai il core. Niente chiavi nuove ne' servizi a pagamento. Solo dati pubblici e professionali.
