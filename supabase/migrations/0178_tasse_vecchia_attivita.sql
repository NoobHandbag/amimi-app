-- 0178_tasse_vecchia_attivita.sql (2026-10-28, OK di Dan in chat: "dagli la sottocategoria che ritieni migliore")
--
-- Il 1.012,00 del 17/03 ("Delega I24", amimi = No) non e' un'imposta di Amimi' srl (IVA di febbraio a credito, email
-- di Sergio del 04/03; riga dal conto della vecchia attivita'): CASI_APERTI 48 (a), lasciato cosi' per scelta di Dan.
-- Resta un costo in TASSE del CE Totale; prende la sottocategoria 'Vecchia attivita'' e il check
-- ce_tasse_iva_da_dividere smette di segnalarlo. Marzo e' chiuso ma il totale TASSE non cambia: snapshot invariato.

create or replace view public.v_tasse_iva_da_dividere as
select id, year, month, date_paid, operazione, sottocategoria, costo
from expenses
where status = 'approved' and categoria = 'TASSE'
  and coalesce(sottocategoria, '') not in ('IVA', 'Ritenute', 'Diritti e bolli', 'Vecchia attivita''')
  and (operazione ilike '%IVA%' or operazione ilike '%F24%' or operazione ilike '%I24%' or sottocategoria ilike 'F24%');
revoke all on public.v_tasse_iva_da_dividere from anon;

create temp table _e0178 on commit drop as
select id, to_jsonb(e) as prima from expenses e
where left(id::text, 8) = 'bc648f90'
  and categoria = 'TASSE' and costo = -1012.00 and sottocategoria is null and year = 2026 and month = 3;

do $$
begin
  if (select count(*) from _e0178) <> 1 then
    raise exception '0178: la riga TASSE da 1.012,00 del 17/03 non e'' piu'' quella attesa';
  end if;
end $$;

update expenses
   set sottocategoria = 'Vecchia attivita''',
       note = concat_ws(' | ', nullif(note, ''), 'F24 della vecchia attivita'', non di Amimi'' srl (CASI_APERTI 48, migr 0178)')
 where id in (select id from _e0178);

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'expenses', t.id::text, 'update', t.prima, to_jsonb(e), 'tasse-vecchia-attivita-2026-10-28', 'claude-code-migration'
  from _e0178 t join expenses e on e.id = t.id;

do $$
begin
  if exists (select 1 from v_tasse_iva_da_dividere) then
    raise exception '0178: restano righe fra quelle da dividere';
  end if;
  if exists (
    select 1 from ce_snapshots s join v_ce_totale t on t.year = s.year and t.month = s.month
     where s.ce = 'totale' and s.year = 2026 and s.month = 3
       and abs((s.snapshot->>'tasse')::numeric - t.tasse) > 0.005) then
    raise exception '0178: le tasse di marzo non coincidono piu'' con lo snapshot';
  end if;
end $$;
