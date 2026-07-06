-- 0037_dedup_codice_and_revoke_truncate — Step 4/5 remediation audit 2026-07-06.
-- B12: due prodotti hanno lo stesso codice_norm (differiscono solo per casing), quindi v_inventory
-- emette 2 righe che portano ENTRAMBE l'aggregato pieno -> giacenza/valore raddoppiano appena la
-- giacenza torna > 0. Prezzi identici nelle coppie, nessuna immagine/seo da perdere: si tiene la riga
-- piu' referenziata e si elimina il doppione, poi UNIQUE su codice_norm perche' non ricapiti.
-- (le vendite referenziano per stringa codice, nessun FK -> nessun orfano: il codice_norm della
--  vendita continua a combaciare con la riga tenuta.)
delete from products where id in (
  '8a4cdfe5-4e21-4f0c-a008-c34e886f34ba',  -- dup AGATA_BAG_ROSE_PINK (tengo Agata_Bag_ROSE_PINK)
  '3023fe6a-0bd7-4886-bd27-0300628d6f3b'   -- dup Agata_Bag_Tie_Dye_Orange (tengo Agata_Bag_TIE_DYE_ORANGE)
);
create unique index if not exists products_codice_norm_uq on products (codice_norm);

-- C27: il lockdown 0026 revoco' insert/update/delete da anon ma NON truncate, e le tabelle create dopo
-- ereditarono TRUNCATE di default. Non raggiungibile via PostgREST oggi, ma va tolto e forward-coperto.
revoke truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
