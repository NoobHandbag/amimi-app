-- 0191_riepilogo_ore_22.sql (2026-11-09): il riepilogo serale parte alle 22:00 ora di Roma invece che alle 18:30
-- (decisione di Dan in chat del 09-11). L'orario vive nella edge push-eventi v8 (ORA_RIEPILOGO_MIN); qui cambiano solo i
-- due testi che lo dicono: la descrizione del tema (scheda Notifiche dell'app) e quella dell'evento. Nessuna tabella,
-- flag o cron (push-eventi resta ogni 5 minuti). Nessuna scrittura in change_log: sono testi di configurazione del modulo
-- push_* (Regola 19).
-- Rollback: gli stessi due update coi testi delle 18:30 (0166), insieme alla edge v7.
begin;

do $$
declare
  n int;
begin
  update public.push_temi
     set descrizione = 'I numeri della giornata, alle 22:00 (domenica esclusa)'
   where key = 'riepilogo';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception '0191: tema riepilogo, % righe invece di 1', n;
  end if;

  update public.push_eventi
     set descrizione = 'Riepilogo serale, uno a testa: 22:00 ora di Roma, lunedi''-sabato, solo se almeno una voce non e'' zero'
   where evento = 'riepilogo';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception '0191: evento riepilogo, % righe invece di 1', n;
  end if;
end $$;

commit;
