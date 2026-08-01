-- 0093: il CE contava il COGS senza la quantita' (brief ce_cogs_quantita, AUTORIZZATO dall'owner 01-08).
--
-- Difetto: `v_ce_amimi` e `v_ce_totale` sommavano `shopify_line_items.cogs_snapshot` e
-- `qromo_sales.cogs` SENZA moltiplicarli per la quantita', mentre entrambe le colonne sono UNITARIE
-- (shopify-sync scrive il COGS di anagrafica per unita'; per Qromo il valore combacia con
-- products.cogs). Su 845 righe di vendita, 843 hanno quantita' 1: per questo e' rimasto invisibile.
-- Scoperto il 31-07 durante il brief A4 (margine per SKU), documentato in SCHEMA.md §9.
--
-- METODO: le viste NON vengono ribattute a mano. Si rigenerano dalla LORO STESSA definizione
-- (`pg_get_viewdef`) applicando due sostituzioni mirate, con un conteggio delle occorrenze che
-- solleva eccezione se non sono esattamente quelle attese. Cosi' e' impossibile che cambi
-- qualunque altra riga per errore di trascrizione.
--
-- NON si tocca il ricavo offline: `qromo_sales.prezzo` e' il TOTALE della riga (confermato
-- dall'owner il 01-08), quindi `qr.lordo = sum(prezzo)` resta com'e'.
--
-- NON si tocca `gifts_offline.cogs` (presente solo in v_ce_totale), benche' SCHEMA.md lo
-- descrivesse come "per unita'". I dati dicono il contrario e la doc va corretta, non il CE:
--   - `ANNIE_BAG_PERSONALIZZAZIONE_MATRIMONIO`: 14 pezzi, cogs 210,00, e anche `products.cogs`
--     e' 210,00 (costo del LOTTO, non unitario). Moltiplicare darebbe 2.940,00.
--   - 13 righe hanno quantita' 0 e cogs > 0: sono rettifiche di conta per pezzi mancanti, dove il
--     costo e' una perdita reale. Moltiplicare le azzererebbe, cancellando quelle perdite.
-- Quindi in gifts_offline il `cogs` si comporta da TOTALE di riga. Fuori scope per il brief.
--
-- Impatto atteso (solo questi 3 mesi si muovono; se se ne muove un altro, fermarsi):
--   marzo 2026  -28,66   aprile 2026  +20,00   giugno 2026  -4,00
-- I tre mesi sono CHIUSI: vanno ri-chiusi subito dopo (migrazione 0094).

do $$
declare
  d  text;
  nd text;
  n_sl int;
  n_qr int;
begin
  ---------------------------------------------------------------- v_ce_amimi
  d := pg_get_viewdef('public.v_ce_amimi'::regclass, true);

  select count(*) into n_sl from regexp_matches(d, 'sum\(shopify_line_items\.cogs_snapshot\)', 'g');
  select count(*) into n_qr from regexp_matches(d, 'sum\(qromo_sales\.cogs\)', 'g');
  if n_sl <> 1 or n_qr <> 1 then
    raise exception 'v_ce_amimi: attese 1 occorrenza per somma, trovate sl=% qr=%', n_sl, n_qr;
  end if;

  nd := replace(d,  'sum(shopify_line_items.cogs_snapshot)',
                    'sum(shopify_line_items.cogs_snapshot * shopify_line_items.quantita)');
  nd := replace(nd, 'sum(qromo_sales.cogs)',
                    'sum(qromo_sales.cogs * qromo_sales.quantita)');
  execute 'create or replace view public.v_ce_amimi as ' || nd;

  ---------------------------------------------------------------- v_ce_totale
  d := pg_get_viewdef('public.v_ce_totale'::regclass, true);

  select count(*) into n_sl from regexp_matches(d, 'sum\(shopify_line_items\.cogs_snapshot\)', 'g');
  select count(*) into n_qr from regexp_matches(d, 'sum\(qromo_sales\.cogs\)', 'g');
  if n_sl <> 1 or n_qr <> 1 then
    raise exception 'v_ce_totale: attese 1 occorrenza per somma, trovate sl=% qr=%', n_sl, n_qr;
  end if;

  nd := replace(d,  'sum(shopify_line_items.cogs_snapshot)',
                    'sum(shopify_line_items.cogs_snapshot * shopify_line_items.quantita)');
  nd := replace(nd, 'sum(qromo_sales.cogs)',
                    'sum(qromo_sales.cogs * qromo_sales.quantita)');
  execute 'create or replace view public.v_ce_totale as ' || nd;
end $$;
