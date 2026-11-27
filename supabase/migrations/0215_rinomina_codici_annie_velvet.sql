-- 0215: rinomina a cascata di 5 codici Annie Velvet gia' verificati (brief Cowork del 27-11,
-- `BRIEF_rinomina_codici_annie_velvet_2026-11-27.md`; anteprima mostrata e OK dell'utente prima dell'apply).
--
-- Perche'. Il 27-11 Benny ha verificato le Annie Velvet con varianti provvisorie: product_verify ha fissato il codice
-- definitivo da quelle (es. ANNIE_BAG_VELLUTO_OCRA -> ANNIE_BAG_VELVET_OCRA, change_log 3397-3401). Pochi minuti dopo
-- ha rinominato le varianti (AMBER VELVET, ...), ma su un prodotto gia' verificato product_verify non rinomina piu'
-- (write-api, blocco "CODICE DEFINITIVO"): variante e codice divergono.
--
-- Cosa fa, per ognuno dei 5 codici, lo stesso lavoro della cascata di product_verify:
--   products.codice (+ updated_at) e le stesse 10 tabelle, abbinate sul codice esatto come fa la write-api:
--   supplier_orders, purchases, qromo_sales, shopify_line_items, gifts_offline, returns, counts, stock_adjustments,
--   b2b_movements, product_aliases. Una riga di change_log per prodotto (op product_rename, codice_da, codice_a,
--   cascata come product_verify, piu' gli id delle righe toccate), chi valorizzato.
-- Non tocca: ANNIE_BAG_OLIVE_VELVET e ANNIE_BAG_WASABI_VELVET; item, variant, prezzo, COGS, verificato; la colonna
--   variant di purchases e supplier_orders (product_verify non la tocca); colonne generate (codice_norm si ricalcola);
--   Shopify e Qromo (nessuna scheda, nessun bottone). CE e giacenze: stessi pezzi, sotto il codice nuovo.
-- Guardie, tutto o niente (un solo blocco DO: un'eccezione annulla anche i codici gia' fatti):
--   prodotto unico, verificato, ANNIE BAG con la variante attesa; il codice nuovo e' quello che product_verify
--   deriverebbe da Modello+Variante; codice nuovo assente da products e dalle 10 tabelle; vecchio e nuovo assenti da
--   shopify_stock (guardia B.4) e dalle altre tabelle con un codice prodotto fuori cascata; righe toccate per tabella
--   uguali all'atteso (purchases 1, RUST 2; supplier_orders 1; le altre 0); dopo, nessuna riga col vecchio codice in
--   nessun case e giacenza di ogni prodotto identica prima e dopo (v_inventory).
-- Rollback: la stessa migrazione con da/a scambiati (gli id delle righe toccate sono in change_log.after.righe).
do $$
declare
  v_m record;
  v_pid uuid;
  v_t text;
  v_n int;
  v_att int;
  v_ids jsonb;
  v_cas jsonb;
  v_righe jsonb;
  v_giac_prima jsonb;
  v_giac_dopo jsonb;
  v_report jsonb := '[]'::jsonb;
  v_tabelle constant text[] := array['supplier_orders', 'purchases', 'qromo_sales', 'shopify_line_items', 'gifts_offline',
    'returns', 'counts', 'stock_adjustments', 'b2b_movements', 'product_aliases'];
  -- tabelle con un codice prodotto che la cascata di product_verify NON aggiorna: devono essere vuote per questi codici
  v_fuori constant text[] := array['shopify_stock', 'shopify_catalog', 'loyalty_ugc', 'stock_fermo_esclusi', 'non_product_codici'];
  v_chi constant text := 'Claude Code (brief Cowork 27-11, rinomina Annie Velvet)';
  v_src constant text := 'migration:0215_rinomina_codici_annie_velvet';
begin
  for v_m in
    select * from (values
      ('ANNIE_BAG_RUST_VELVET',     'ANNIE_BAG_TERRACOTTA_VELVET',   'TERRACOTTA VELVET',   2),
      ('ANNIE_BAG_VELVET_OCRA',     'ANNIE_BAG_AMBER_VELVET',        'AMBER VELVET',        1),
      ('ANNIE_BAG_VELVET_RED',      'ANNIE_BAG_CHERRY_VELVET',       'CHERRY VELVET',       1),
      ('ANNIE_BAG_VELVET_BORDEAUX', 'ANNIE_BAG_BURGUNDY_VELVET',     'BURGUNDY VELVET',     1),
      ('ANNIE_BAG_VELVET_PURPLE',   'ANNIE_BAG_BAROQUE_WINE_VELVET', 'BAROQUE WINE VELVET', 1)
    ) as x(c_da, c_a, c_variant, c_purch)
  loop
    -- 1. il codice nuovo e' quello che product_verify deriverebbe (tok v2 di ANNIE BAG + variante)
    if 'ANNIE_BAG_' || regexp_replace(v_m.c_variant, '[^A-Z0-9]+', '_', 'g') <> v_m.c_a then
      raise exception '0215: % non e'' il codice derivato da ANNIE BAG + %', v_m.c_a, v_m.c_variant;
    end if;

    -- 2. prodotto: uno solo, verificato, ANNIE BAG con la variante attesa (se Benny l'ha cambiata di nuovo, ci si ferma)
    select count(*) into v_n from public.products where codice_norm = v_m.c_da;
    if v_n <> 1 then raise exception '0215: % righe in products per %, attesa 1', v_n, v_m.c_da; end if;
    v_pid := null;
    select id into v_pid from public.products
      where codice = v_m.c_da and verificato = true
        and upper(trim(item)) = 'ANNIE BAG' and upper(trim(variant)) = v_m.c_variant;
    if v_pid is null then
      raise exception '0215: % non e'' piu'' ANNIE BAG / % verificato: stato cambiato, nulla scritto', v_m.c_da, v_m.c_variant;
    end if;

    -- 3. codice nuovo libero ovunque; vecchio e nuovo assenti dalle tabelle fuori cascata (shopify_stock = guardia B.4)
    select count(*) into v_n from public.products where codice_norm = v_m.c_a;
    if v_n <> 0 then raise exception '0215: % esiste gia'' in products', v_m.c_a; end if;
    foreach v_t in array v_tabelle loop
      execute format('select count(*) from public.%I where upper(replace(codice, '' '', ''_'')) = $1', v_t) into v_n using v_m.c_a;
      if v_n <> 0 then raise exception '0215: % ha gia'' % righe col codice nuovo %', v_t, v_n, v_m.c_a; end if;
    end loop;
    foreach v_t in array v_fuori loop
      execute format('select count(*) from public.%I where upper(replace(codice, '' '', ''_'')) in ($1, $2)', v_t) into v_n using v_m.c_da, v_m.c_a;
      if v_n <> 0 then raise exception '0215: % ha % righe con % o %: la cascata non la aggiorna, nulla scritto', v_t, v_n, v_m.c_da, v_m.c_a; end if;
    end loop;
    select count(*) into v_n from public.meta_product_set_map where codice_norm in (v_m.c_da, v_m.c_a);
    if v_n <> 0 then raise exception '0215: meta_product_set_map ha % righe con % o %', v_n, v_m.c_da, v_m.c_a; end if;

    -- 4. giacenza prima (v_inventory)
    select to_jsonb(x) into v_giac_prima from (
      select giacenza_attuale, disponibili_da_vendere from public.v_inventory where codice_norm = v_m.c_da
    ) x;

    -- 5. rinomina: products, poi le 10 tabelle sul codice esatto (come write-api product_verify)
    update public.products set codice = v_m.c_a, updated_at = now() where id = v_pid;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception '0215: products aggiornate % per %, attesa 1', v_n, v_m.c_da; end if;
    v_cas := '{}'::jsonb;
    v_righe := '{}'::jsonb;
    foreach v_t in array v_tabelle loop
      execute format(
        'with u as (update public.%I set codice = $1 where codice = $2 returning id) '
        'select count(*)::int, coalesce(jsonb_agg(id::text order by id::text), ''[]''::jsonb) from u', v_t)
        into v_n, v_ids using v_m.c_a, v_m.c_da;
      v_att := case v_t when 'purchases' then v_m.c_purch when 'supplier_orders' then 1 else 0 end;
      if v_n <> v_att then
        raise exception '0215: % righe di % aggiornate per %, attese %: nulla scritto', v_n, v_t, v_m.c_da, v_att;
      end if;
      if v_n > 0 then
        v_cas := v_cas || jsonb_build_object(v_t, v_n);
        v_righe := v_righe || jsonb_build_object(v_t, v_ids);
      end if;
    end loop;

    -- 6. dopo: nessuna riga col vecchio codice in nessun case; giacenza identica sotto il codice nuovo
    select count(*) into v_n from public.products where codice_norm = v_m.c_da;
    if v_n <> 0 then raise exception '0215: products ha ancora % dopo la rinomina', v_m.c_da; end if;
    foreach v_t in array v_tabelle loop
      execute format('select count(*) from public.%I where upper(replace(codice, '' '', ''_'')) = $1', v_t) into v_n using v_m.c_da;
      if v_n <> 0 then raise exception '0215: % ha ancora % righe con %', v_t, v_n, v_m.c_da; end if;
    end loop;
    select to_jsonb(x) into v_giac_dopo from (
      select giacenza_attuale, disponibili_da_vendere from public.v_inventory where codice_norm = v_m.c_a
    ) x;
    if v_giac_dopo is distinct from v_giac_prima then
      raise exception '0215: giacenza di % cambiata: prima %, dopo %', v_m.c_da, v_giac_prima, v_giac_dopo;
    end if;

    -- 7. change_log: una riga per prodotto, come product_verify (codice_da, codice_a, cascata) + id delle righe
    insert into public.change_log (tbl, row_id, op, before, after, chi, source)
    values ('products', v_pid::text, 'product_rename',
      jsonb_build_object('codice', v_m.c_da),
      jsonb_build_object('codice', v_m.c_a, 'codice_da', v_m.c_da, 'codice_a', v_m.c_a, 'cascata', v_cas, 'righe', v_righe,
        'motivo', 'variante rinominata dopo la verifica del 27-11: product_verify non rinomina un prodotto gia'' verificato',
        'brief', 'BRIEF_rinomina_codici_annie_velvet_2026-11-27'),
      v_chi, v_src);

    v_report := v_report || jsonb_build_object('da', v_m.c_da, 'a', v_m.c_a, 'product_id', v_pid,
      'cascata', v_cas, 'giacenza', v_giac_dopo);
  end loop;

  -- 8. le due Velvet da non toccare sono ancora li', col loro codice
  select count(*) into v_n from public.products where codice_norm in ('ANNIE_BAG_OLIVE_VELVET', 'ANNIE_BAG_WASABI_VELVET');
  if v_n <> 2 then raise exception '0215: OLIVE_VELVET/WASABI_VELVET attesi 2, trovati %', v_n; end if;

  raise notice '0215 fatto: %', v_report;
end $$;
