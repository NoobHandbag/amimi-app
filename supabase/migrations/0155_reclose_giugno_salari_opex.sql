-- 0155_reclose_giugno_salari_opex.sql (2026-10-13, decisione owner in chat: "Resta SALARI")
--
-- Il 09-10 l'approvazione di una spesa di GIUGNO (mese chiuso) l'ha ricodificata da OPEX a SALARI: 533,50 EUR
-- (change_log 1741, chi = Ale, nota "fornitore (preventivo 574), possibile COGS"). E' uno spostamento fra due costi
-- FISSI, quindi netto, MC1 e MC2 non cambiano e v_ce_drift (che guarda solo netto e mc2) non lo vede; lo ha trovato la
-- Gate 2 della PR #51 e lo segnala l'asserzione "ogni riga dello snapshot uguale al live" di tests/features.mjs.
-- La 0154 l'ha lasciato fuori di proposito (la sua ri-chiusura cambia solo mc1, mc2 e il compenso). L'owner il 13-10 ha
-- scelto di tenerla: qui si portano nello snapshot di giugno, in entrambi i CE, SOLO le righe salari e opex.
--
-- Guardie: prima, per giugno, le uniche righe diverse dal live sono salari (-533,50) e opex (+533,50); dopo, nessuna
-- riga di nessun mese chiuso diversa dal live. Before/after in change_log.

create temp table _ce0155 on commit drop as
select s.id, s.ce, s.year, s.month, s.snapshot, s.closed_at, s.closed_by, l.j
  from ce_snapshots s
  join (select 'amimi'::text ce, year, month, to_jsonb(a) j from v_ce_amimi_summary a
        union all
        select 'totale', year, month, to_jsonb(t) from v_ce_totale t) l
    on l.ce = s.ce and l.year = s.year and l.month = s.month
 where s.year = 2026 and s.month = 6;

do $$
declare v_n int; v_diff text;
begin
  select count(*) into v_n from _ce0155;
  if v_n <> 2 then raise exception '0155: attesi 2 snapshot di giugno (amimi, totale), trovati %', v_n; end if;

  select string_agg(ce || ':' || k || ' ' || round((j->>k)::numeric - (snapshot->>k)::numeric, 2), ', ' order by ce, k)
    into v_diff
    from _ce0155, jsonb_object_keys(snapshot) k
   where k not in ('year', 'month')
     and abs((j->>k)::numeric - (snapshot->>k)::numeric) > 0.005;
  if v_diff is distinct from 'amimi:opex 533.50, amimi:salari -533.50, totale:opex 533.50, totale:salari -533.50' then
    raise exception '0155: giugno non si muove della sola ricodifica OPEX->SALARI attesa: %', coalesce(v_diff, '(nessuna differenza)');
  end if;
end $$;

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'ce_snapshots', ce || '-' || year || '-' || month, 'reclose',
       snapshot || jsonb_build_object('_closed_at', closed_at, '_closed_by', closed_by),
       snapshot || jsonb_build_object('salari', j->'salari', 'opex', j->'opex'),
       'reclose-giugno-salari-opex-2026-10-13', 'claude-code-migration'
  from _ce0155;

update ce_snapshots s
   set snapshot = s.snapshot || jsonb_build_object('salari', t.j->'salari', 'opex', t.j->'opex'),
       closed_at = now(), closed_by = 'claude-code (0155: ricodifica OPEX->SALARI di giugno, OK owner 13-10)'
  from _ce0155 t
 where s.id = t.id;

do $$
declare v_diff text;
begin
  select string_agg(s.ce || '-' || s.month || ' ' || k, ', ') into v_diff
    from ce_snapshots s
    join (select 'amimi'::text ce, year, month, to_jsonb(a) j from v_ce_amimi_summary a
          union all
          select 'totale', year, month, to_jsonb(t) from v_ce_totale t) l
      on l.ce = s.ce and l.year = s.year and l.month = s.month,
         jsonb_object_keys(s.snapshot) k
   where k not in ('year', 'month')
     and abs((l.j->>k)::numeric - (s.snapshot->>k)::numeric) > 0.005;
  if v_diff is not null then raise exception '0155: dopo la ri-chiusura restano righe diverse dal live: %', v_diff; end if;
end $$;
