-- 0177_iva_f24_settembre_diviso.sql (2026-10-28, seguito di 0173, OK di Dan in chat: "procedi autonomamente")
--
-- L'F24 del 16/09 (968,71, "IVA agosto + ritenuta nota Ginevra", email di Sergio dell'11/09) restava intero in TASSE.
-- La ritenuta e' scritta nel contratto di prestazione occasionale di Ginevra (approvato da Nicolo' il 31/07):
-- compenso lordo 3.000,00, ritenuta 20% = 600,00, netto 2.400,00 (la riga SALARI del 03/08). Quindi
-- 968,71 = 368,71 IVA agosto (TASSE / IVA, fuori dal CE) + 600,00 ritenuta (TASSE / Ritenute, costo).
-- Settembre non e' chiuso in ce_snapshots: nessuna ri-chiusura. MC2 di settembre sale di 368,71.

create temp table _e0177 on commit drop as
select id, to_jsonb(e) as prima from expenses e
where id = '66fb14c7-4a7c-4070-97ad-c2752fec89bd' and categoria = 'TASSE' and sottocategoria = 'F24'
  and costo = -968.71 and status = 'approved';

do $$
begin
  if (select count(*) from _e0177) <> 1 then
    raise exception '0177: la riga F24 del 16/09 (968,71, TASSE/F24) non e'' piu'' quella attesa';
  end if;
  if exists (select 1 from ce_snapshots where year = 2026 and month = 9) then
    raise exception '0177: settembre risulta chiuso, serve una ri-chiusura con OK';
  end if;
end $$;

update expenses
   set costo = -368.71, sottocategoria = 'IVA',
       note = concat_ws(' | ', nullif(note, ''), 'quota IVA agosto; 600,00 ritenuta Ginevra su riga separata (migr 0177)')
 where id in (select id from _e0177);

insert into expenses (year, month, date_reported, date_paid, operazione, costo, categoria, sottocategoria,
                      amimi_raw, note, source, chi, status, proposed_by, approved_by)
select year, month, date_reported, date_paid,
       operazione || ' - quota ritenuta Ginevra', -600.00, 'TASSE', 'Ritenute',
       amimi_raw, 'divisa da 66fb14c7, contratto prestazione occasionale Ginevra (migr 0177)', 'migration-0177',
       chi, 'approved', proposed_by, approved_by
  from expenses where id = '66fb14c7-4a7c-4070-97ad-c2752fec89bd';

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'expenses', t.id::text, 'update', t.prima, to_jsonb(e), 'iva-f24-settembre-2026-10-28', 'claude-code-migration'
  from _e0177 t join expenses e on e.id = t.id;
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'expenses', e.id::text, 'insert', null, to_jsonb(e), 'iva-f24-settembre-2026-10-28', 'claude-code-migration'
  from expenses e where e.source = 'migration-0177';

do $$
begin
  if (select round(sum(costo), 2) from expenses
       where id = '66fb14c7-4a7c-4070-97ad-c2752fec89bd' or source = 'migration-0177') <> -968.71 then
    raise exception '0177: le due quote non sommano a 968,71';
  end if;
  if exists (select 1 from v_ce_completezza where abs(spese_scoperte) > 0.01) then
    raise exception '0177: v_ce_completezza ha spese scoperte';
  end if;
  if exists (select 1 from v_tasse_iva_da_dividere where id = '66fb14c7-4a7c-4070-97ad-c2752fec89bd') then
    raise exception '0177: la riga e'' ancora fra quelle da dividere';
  end if;
end $$;
