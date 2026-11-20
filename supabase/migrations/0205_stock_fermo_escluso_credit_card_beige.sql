-- 0205 (2026-11-20, chiesta da Dan in chat: "hide the credit card case too"): CREDIT_CARD_CASE_COCCO_BEIGE fra i codici
-- tenuti fuori dalla scheda dei pezzi fermi (tabella stock_fermo_esclusi della 0203). Era l'unico codice rimasto nella
-- scheda dopo la 0203: 1 pezzo arrivato il 29-07, in bozza nell'anagrafica a 50 euro, nessuna pagina sul sito.
-- Dal registro delle notifiche esce la sua riga stock_fermo, come la 0203 ha fatto per gli altri codici fuori elenco.
-- Nessuna vista cambia. Rollback: delete from stock_fermo_esclusi where codice = 'CREDIT_CARD_CASE_COCCO_BEIGE'.
-- Numero 0205: in main ci sono due 0203 (lead_linesheet e stock_fermo, stesso giorno) e la 0204.

insert into public.stock_fermo_esclusi (codice, motivo, chi) values
  ('CREDIT_CARD_CASE_COCCO_BEIGE', 'Tenuto fuori dalla scheda dei pezzi fermi su richiesta di Dan (20-11-2026)', 'Claude Code')
on conflict (codice) do nothing;

delete from public.push_eventi_inviati r
 where r.evento = 'stock_fermo'
   and r.chiave like 'fermo:%'
   and not exists (select 1 from v_stock_fermo f where upper(f.codice) = upper(split_part(r.chiave, ':', 2)));

do $$
begin
  if not exists (select 1 from stock_fermo_esclusi where codice = 'CREDIT_CARD_CASE_COCCO_BEIGE') then
    raise exception '0205: CREDIT_CARD_CASE_COCCO_BEIGE non e'' fra gli esclusi';
  end if;
  if not exists (select 1 from products where codice_norm = 'CREDIT_CARD_CASE_COCCO_BEIGE') then
    raise exception '0205: CREDIT_CARD_CASE_COCCO_BEIGE non esiste in anagrafica';
  end if;
  if exists (select 1 from v_stock_fermo where upper(codice) = 'CREDIT_CARD_CASE_COCCO_BEIGE') then
    raise exception '0205: CREDIT_CARD_CASE_COCCO_BEIGE ancora in v_stock_fermo';
  end if;
  if exists (select 1 from push_eventi_inviati r where r.evento = 'stock_fermo' and r.chiave like 'fermo:%'
               and not exists (select 1 from v_stock_fermo f where upper(f.codice) = upper(split_part(r.chiave, ':', 2)))) then
    raise exception '0205: nel registro restano righe stock_fermo di codici fuori elenco';
  end if;
  if (select count(*) from v_health where k = 'stock_fermo') <> 1 then
    raise exception '0205: riga stock_fermo di v_health assente';
  end if;
end $$;
