-- 0213_cogs_materiali_rettifica_e_richiusura.sql (brief hub `BRIEF_cogs_materiali_e_imposte_2026-11-25.md`, Parte B)
--
-- DATI. Si applica SOLO dopo l'OK esplicito di Dan in chat sulla tabella mese per mese (Regola Ferrea 11): tocca i mesi
-- chiusi febbraio-giugno 2026 e li richiude.
--
-- 1) COGS dei materiali, febbraio-novembre 2026 (novembre: le vendite fino alla Parte A del 25-11 hanno il costo vecchio;
--    quelle dopo hanno gia' il costo nuovo e greatest() da' delta 0): righe di ce_rettifiche scritte dal calcolo vivo v_ce_rettifica_cogs_materiali
--    al momento dell'apply (una per mese e canale). Dentro c'e' anche il +2,42 a pezzo dei pezzi India venduti.
-- 2) Dazi e spedizione India: le due spese LOGISTICA/Spedizioni (08-03 UPS 425,07 e 10-05 UPS 1.015,42) escono dalla
--    logistica variabile con una rettifica di segno opposto. Il loro costo entra nel COGS a 2,42 a pezzo venduto (punto 1
--    e, per il futuro, products.cogs della Parte A): o l'uno o l'altro, mai entrambi. Le spese restano com'erano in expenses.
--    I 185 di Benny (Discord) non sono in expenses: entrano solo nei 2,42 (sovrastima prudente di 185 sull'anno).
-- 3) F24 del 16-10 (c8965abd): 1.404,29 = 1.280,72 IVA settembre (fuori dal CE, regola della 0173) + 123,57 ritenuta
--    Rita Benedetto (resta TASSE / Ritenute). Ottobre non e' chiuso.
-- 4) Ri-chiusura di febbraio-giugno (amimi e totale): patch dello snapshot sulle sole chiavi cogs, logistica_var, mc1, mc2,
--    con guardia che il live si muova ESATTAMENTE delle rettifiche (il resto dello snapshot resta com'era, come la 0154).
--    Il compenso soci non cambia: la sua base sono le vendite nette, non il margine.
--
-- Annullare: update ce_rettifiche set attiva = false, annullata_at = now(), annullata_by = '...' where gruppo in (...),
-- poi ri-chiusura dei mesi chiusi toccati con la stessa patch (nuova migrazione, OK di Dan).

------------------------------------------------------------------------------------------------ 1) COGS materiali
insert into public.ce_rettifiche (gruppo, year, month, linea, canale, in_amimi, importo, motivo, dettaglio, created_by)
select 'cogs_materiali_2026-11', r.year, r.month, 'cogs', r.canale, r.canale <> 'gift', r.importo,
       'Materiali comprati da Amimi (pelle, tessuti) e dazi India nel costo delle borse vendute',
       jsonb_build_object('di_cui_india', r.di_cui_india, 'pezzi', r.pezzi_rettificati, 'codici', r.codici,
                          'regole', 'brief 25-11 sez. 2, vista v_ce_rettifica_cogs_materiali', 'calcolato_il', now()),
       'claude-code (0213: COGS materiali, OK Dan)'
  from public.v_ce_rettifica_cogs_materiali r
 where r.year = 2026 and r.month between 2 and 11;

------------------------------------------------------------------------------------------------ 2) dazi India fuori dalla logistica
do $$
declare v_n int; v_tot numeric;
begin
  select count(*), sum(costo) into v_n, v_tot from public.expenses
   where id in ('3b5402b7-6035-4e3f-8311-c98ccf02a53a', '0118411f-0812-4d20-a1db-f7e37d85764f')
     and categoria = 'LOGISTICA' and sottocategoria = 'Spedizioni' and status = 'approved' and amimi;
  if v_n <> 2 or v_tot <> -1440.49 then
    raise exception '0213: attese le 2 spese UPS India LOGISTICA/Spedizioni per -1440,49, trovate % per %', v_n, v_tot;
  end if;
end $$;

insert into public.ce_rettifiche (gruppo, year, month, linea, canale, in_amimi, importo, motivo, dettaglio, created_by)
select 'dazi_india_2026-11', e.year, e.month, 'logistica_var', null, true, -e.costo,
       'Dazi e spedizione ordine India del 25-03 spostati nel COGS (2,42 a pezzo venduto)',
       jsonb_build_object('expense_id', e.id, 'date_paid', e.date_paid, 'costo', e.costo),
       'claude-code (0213: COGS materiali, OK Dan)'
  from public.expenses e
 where e.id in ('3b5402b7-6035-4e3f-8311-c98ccf02a53a', '0118411f-0812-4d20-a1db-f7e37d85764f');

insert into public.change_log (tbl, row_id, op, before, after, chi, source)
select 'ce_rettifiche', r.id::text, 'insert', null, to_jsonb(r), 'cogs-materiali-2026-11-25', 'claude-code-migration'
  from public.ce_rettifiche r where r.gruppo in ('cogs_materiali_2026-11', 'dazi_india_2026-11');

------------------------------------------------------------------------------------------------ 3) F24 del 16-10
create temp table _e0213 on commit drop as
select id, to_jsonb(e) as prima from public.expenses e where id = 'c8965abd-3d1c-4ef6-94d2-fca0adbd7470';

do $$
begin
  if (select count(*) from _e0213 where prima->>'categoria' = 'TASSE' and prima->>'sottocategoria' = 'F24'
        and (prima->>'costo')::numeric = -1404.29 and prima->>'status' = 'approved') <> 1 then
    raise exception '0213: la riga F24 c8965abd non e'' piu'' TASSE/F24 -1404,29 approvata';
  end if;
end $$;

update public.expenses e
   set sottocategoria = 'IVA', costo = -1280.72,
       note = concat_ws(' | ', nullif(e.note, ''), 'quota IVA settembre 1.280,72, fuori dal CE; 123,57 ritenuta su riga separata (migr 0213)')
 where e.id = 'c8965abd-3d1c-4ef6-94d2-fca0adbd7470';

insert into public.expenses (year, month, date_reported, date_paid, operazione, costo, categoria, sottocategoria,
                             amimi_raw, note, source, chi, status, proposed_by, approved_by)
select year, month, date_reported, date_paid,
       operazione || ' - quota ritenuta', -123.57, 'TASSE', 'Ritenute',
       amimi_raw, 'divisa da c8965abd, F24 1.404,29 = 1.280,72 IVA + 123,57 ritenuta (migr 0213)', 'migration-0213', chi,
       'approved', proposed_by, approved_by
  from public.expenses where id = 'c8965abd-3d1c-4ef6-94d2-fca0adbd7470';

insert into public.change_log (tbl, row_id, op, before, after, chi, source)
select 'expenses', t.id::text, 'update', t.prima, to_jsonb(e), 'cogs-materiali-2026-11-25', 'claude-code-migration'
  from _e0213 t join public.expenses e on e.id = t.id;
insert into public.change_log (tbl, row_id, op, before, after, chi, source)
select 'expenses', e.id::text, 'insert', null, to_jsonb(e), 'cogs-materiali-2026-11-25', 'claude-code-migration'
  from public.expenses e where e.source = 'migration-0213';

------------------------------------------------------------------------------------------------ 4) ri-chiusura feb-giu
create temp table _ce0213 on commit drop as
select s.id, s.ce, s.year, s.month, s.snapshot, s.closed_at, s.closed_by, l.j,
       coalesce(r.cogs, 0) as r_cogs, coalesce(r.lvar, 0) as r_lvar
  from public.ce_snapshots s
  join (select 'amimi'::text ce, year, month, to_jsonb(a) j from public.v_ce_amimi_summary a
        union all
        select 'totale', year, month, to_jsonb(t) from public.v_ce_totale t) l
    on l.ce = s.ce and l.year = s.year and l.month = s.month
  left join (select 'amimi'::text ce, year, month,
                    sum(importo) filter (where linea = 'cogs') cogs, sum(importo) filter (where linea = 'logistica_var') lvar
               from public.ce_rettifiche where attiva and in_amimi group by year, month
             union all
             select 'totale', year, month,
                    sum(importo) filter (where linea = 'cogs'), sum(importo) filter (where linea = 'logistica_var')
               from public.ce_rettifiche where attiva group by year, month) r
    on r.ce = s.ce and r.year = s.year and r.month = s.month;

do $$
declare v_diff text;
begin
  -- prima: ogni chiave dello snapshot e' uguale al live, salvo cogs/logistica_var/mc1/mc2 spostati ESATTAMENTE dalle rettifiche
  select string_agg(ce || '-' || month || ':' || k || ' ' || round((j->>k)::numeric - (snapshot->>k)::numeric, 2), ', ' order by ce, month, k)
    into v_diff
    from _ce0213, jsonb_object_keys(snapshot) k
   where k not in ('year', 'month')
     and abs((j->>k)::numeric - (snapshot->>k)::numeric
             - case k when 'cogs' then r_cogs when 'logistica_var' then r_lvar
                      when 'mc1' then r_cogs + r_lvar when 'mc2' then r_cogs + r_lvar else 0 end) > 0.005;
  if v_diff is not null then
    raise exception '0213: i mesi chiusi non si muovono delle sole rettifiche: %', v_diff;
  end if;
  if not exists (select 1 from _ce0213 where r_cogs <> 0) then raise exception '0213: nessuna rettifica sui mesi chiusi'; end if;
end $$;

insert into public.change_log (tbl, row_id, op, before, after, chi, source)
select 'ce_snapshots', ce || '-' || year || '-' || month, 'reclose',
       snapshot || jsonb_build_object('_closed_at', closed_at, '_closed_by', closed_by),
       snapshot || jsonb_build_object('cogs', j->'cogs', 'logistica_var', j->'logistica_var', 'mc1', j->'mc1', 'mc2', j->'mc2'),
       'cogs-materiali-2026-11-25', 'claude-code-migration'
  from _ce0213 where r_cogs <> 0 or r_lvar <> 0;

update public.ce_snapshots s
   set snapshot = s.snapshot || jsonb_build_object('cogs', t.j->'cogs', 'logistica_var', t.j->'logistica_var', 'mc1', t.j->'mc1', 'mc2', t.j->'mc2'),
       closed_at = now(), closed_by = 'claude-code (0213: COGS materiali e dazi India, OK Dan)'
  from _ce0213 t
 where s.id = t.id and (t.r_cogs <> 0 or t.r_lvar <> 0);

do $$
declare v_diff text;
begin
  select string_agg(s.ce || '-' || s.month || ' ' || k, ', ') into v_diff
    from public.ce_snapshots s
    join (select 'amimi'::text ce, year, month, to_jsonb(a) j from public.v_ce_amimi_summary a
          union all
          select 'totale', year, month, to_jsonb(t) from public.v_ce_totale t) l
      on l.ce = s.ce and l.year = s.year and l.month = s.month,
         jsonb_object_keys(s.snapshot) k
   where k not in ('year', 'month')
     and abs((l.j->>k)::numeric - (s.snapshot->>k)::numeric) > 0.005;
  if v_diff is not null then raise exception '0213: dopo la ri-chiusura restano righe diverse dal live: %', v_diff; end if;
  if exists (select 1 from public.v_ce_completezza where abs(spese_scoperte) > 0.01) then
    raise exception '0213: v_ce_completezza ha spese scoperte dopo la migrazione';
  end if;
end $$;
