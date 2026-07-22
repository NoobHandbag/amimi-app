-- Scheda "Gia' arrivati": fallback di VISUALIZZAZIONE della data consegna (brief Cowork 22-07, OK owner).
-- Gli ordini creati in-app compilano data_ultimo_arrivo ma non data_consegna -> la card restava senza data.
-- Additivo/non distruttivo: nuova colonna display in coda (CREATE OR REPLACE VIEW aggiunge solo in fondo).
-- data_consegna e data_ultimo_arrivo grezze restano invariate; nessun UPDATE dei dati.
create or replace view v_ordini_arrivo as
 SELECT o.id,
    o.gruppo,
    o.codice,
    o.item,
    o.variant,
    o.fornitore,
    o.qty_ordered,
    o.qty_arrived,
    COALESCE(o.qty_ordered, 0::numeric) - COALESCE(o.qty_arrived, 0::numeric) AS mancano,
        CASE
            WHEN o.wip THEN COALESCE(o.qty_arrived, 0::numeric) > 0::numeric
            ELSE COALESCE(o.qty_arrived, 0::numeric) >= COALESCE(o.qty_ordered, 0::numeric)
        END AS completo,
    o.nuovo_riordino,
    o.costo_unitario,
    o.data_consegna,
    o.data_ordine,
    o.data_ultimo_arrivo,
    o.note,
    COALESCE(p.image_url, ss.image_url) AS image_url,
    o.wip,
    COALESCE(o.data_consegna, o.data_ultimo_arrivo) AS data_consegna_display
   FROM supplier_orders o
     LEFT JOIN products p ON p.codice_norm = upper(regexp_replace(COALESCE(o.codice, ''::text), '\s+'::text, '_'::text, 'g'::text))
     LEFT JOIN ( SELECT upper(regexp_replace(COALESCE(shopify_stock.codice, ''::text), '\s+'::text, '_'::text, 'g'::text)) AS codice_norm,
            max(shopify_stock.image_url) AS image_url
           FROM shopify_stock
          GROUP BY (upper(regexp_replace(COALESCE(shopify_stock.codice, ''::text), '\s+'::text, '_'::text, 'g'::text)))) ss ON ss.codice_norm = upper(regexp_replace(COALESCE(o.codice, ''::text), '\s+'::text, '_'::text, 'g'::text));
