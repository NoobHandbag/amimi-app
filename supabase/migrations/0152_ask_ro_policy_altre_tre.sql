-- 0152: ask_ro legge davvero mimi_state, app_guides e shipping_status (CASI_APERTI 33, OK di Dan il 12-10).
--
-- Stesso difetto chiuso dalla 0151 sulle loyalty_*: RLS accesa, SELECT dato ad ask_ro (grant largo della 0121) e
-- nessuna policy che lo riguardi, quindi Cowork e "Chiedi ad Amimi" leggevano zero righe senza errore
-- (shipping_status: 461 righe vere). Trovato dalla Gate 2 del 12-10.
--
-- Fix: una policy `for select to ask_ro using (true)` per tabella. Nessun grant cambiato, nessun dato toccato; la
-- policy `shipping_status_read_authenticated` resta com'e'. Colonne guardate prima: nessun dato personale oltre
-- shopify_customer_id (mimi_state), gia' leggibile sulle loyalty_*; app_guides e' il testo delle guide dell'assistente.
-- Idempotente (drop policy if exists), una transazione.

do $$
declare
  t text;
  tabelle text[] := array['mimi_state', 'app_guides', 'shipping_status'];
begin
  foreach t in array tabelle loop
    execute format('drop policy if exists %I on public.%I', t || '_ask_ro', t);
    execute format('create policy %I on public.%I for select to ask_ro using (true)', t || '_ask_ro', t);
  end loop;

  foreach t in array tabelle loop
    if (select count(*) from pg_policy p
         where p.polrelid = ('public.' || t)::regclass
           and 'ask_ro'::regrole = any (p.polroles)
           and p.polcmd = 'r') <> 1 then
      raise exception '0152: policy ask_ro mancante o doppia su %', t;
    end if;
  end loop;
end $$;
