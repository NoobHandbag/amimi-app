-- Dati di partenza dello stack LOCALE (brief flows_test_non_tocchi_produzione, 01-08).
-- Applicato in automatico da `supabase start` e `supabase db reset`. NON tocca la produzione:
-- vive solo dentro il Postgres in Docker.
--
-- Perche' esiste: `tests/flows.mjs` non parte dal vuoto, si appoggia a dati che in produzione ci
-- sono per caso (una borsa a catalogo, una vendita Qromo da correggere, il CE di gennaio). Su un
-- database pulito quelle asserzioni fallirebbero. Qui gli stessi presupposti sono ricreati in
-- versione minima e DICHIARATA, cosi' il test verifica la LOGICA e non lo stato del negozio.
--
-- Volutamente NON seminato: `gemini_api_key` (il test si aspetta che ask-data risponda needs_key).

-- PIN dell'app: il test chiama la write-api con pin 'x'.
--
-- `shopify_token` e' un SEGNAPOSTO FINTO, e ci vuole. In `shopify-stock` il controllo "token
-- presente" viene PRIMA del cancello di scrittura: senza token l'azione realign muore con 500
-- "token Shopify mancante" e il test non arriva mai a verificare il cancello, che e' la cosa che
-- gli interessa (Regola Ferrea 15, unico writer dello stock). Con il token finto la funzione
-- prosegue e risponde 403 gated, perche' `shopify_write_enabled` e' false: nessuna chiamata parte
-- verso Shopify, il cancello e' PRIMA della rete. L'unica azione che tenta davvero la rete e'
-- `sync`, che con questo token si becca un 401 da Shopify e aborta il giro senza scrivere niente
-- (il test non asserisce nulla su quella riga).
insert into public.app_config (id, pin_hash, shopify_token)
values (1, '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881', 'shpat_FINTO_STACK_LOCALE_NON_E_UN_TOKEN_VERO')
on conflict (id) do update set pin_hash = excluded.pin_hash, shopify_token = excluded.shopify_token;

-- Interruttori: autopush Shopify SPENTO -> l'azione realign deve rispondere 403 gated.
insert into public.app_flags (key, value) values
  ('shopify_write_enabled', 'false'),
  ('shopify_autopush_enabled', 'false')
on conflict (key) do update set value = excluded.value;

-- Modello di riferimento (la categoria dei prodotti deriva da qui, non e' piu' input manuale).
insert into public.models (model, categoria, product_type)
values ('LEA BAG', 'PELLE', 'Bag'), ('ZZZTEST NUOVA', 'PELLE', 'Bag')
on conflict (model_norm) do nothing;

-- La borsa su cui il test appoggia quasi tutti i flussi (conte, gift, acquisti, b2b, resi,
-- riassegnazione vendita). Serve un prodotto REALE a catalogo, con COGS e prezzo.
insert into public.products (codice, item, model, variant, categoria, retail_price, cogs, verificato, source)
values ('LEA_BAG_BLACK', 'LEA BAG', 'LEA BAG', 'BLACK', 'PELLE', 120, 20, true, 'seed-test')
on conflict (codice_norm) do nothing;

-- Giacenza di partenza: senza carico, le asserzioni sui resi che rientrano a stock partirebbero
-- da un magazzino vuoto e la giacenza andrebbe negativa.
insert into public.purchases (data, codice, quantita, costo_unitario, fornitore, note)
values (current_date - 30, 'LEA_BAG_BLACK', 50, 20, 'SEED', 'seed stack locale')
on conflict do nothing;

-- Una vendita Qromo con item e variant valorizzati: il test la riassegna a un altro codice e poi
-- la RIPRISTINA, quindi le servono i valori originali da cui ripartire.
insert into public.qromo_sales (data, year, month, codice, item, variant, quantita, prezzo, cogs, resolver_status, source)
values (current_date - 10, extract(year from current_date)::int, extract(month from current_date)::int,
        'LEA_BAG_BLACK', 'LEA BAG', 'BLACK', 1, 150, 20, 'resolved', 'seed-test')
on conflict do nothing;

-- Gennaio 2026 deve ESISTERE come periodo del CE con ricavo ZERO (il test lo verifica).
-- Una spesa non-Amimi crea il periodo senza generare ricavo ne' entrare nel margine.
insert into public.expenses (operazione, costo, categoria, amimi_raw, status, date_paid, year, month)
values ('SEED periodo gennaio', -1, 'OPEX', 'no', 'approved', '2026-01-15', 2026, 1)
on conflict do nothing;

-- CE Totale di gennaio ereditato dal Foglio: il test verifica che sia sopra 4000.
insert into public.ce_totale_monthly (year, month, netto, lordo)
values (2026, 1, 4448, 5426.56)
on conflict do nothing;
