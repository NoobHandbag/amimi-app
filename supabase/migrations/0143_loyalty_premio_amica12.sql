-- 0143 (Premia, 23-09): il premio unico 100 pt = 12% si chiama `amica12` (era `tessera12` nella 0142): l'owner vuole un
-- nome legato all'essere parte di Amimi' (i livelli sono "Amica"). Chiave minuscola come `tessera` (le chiavi del catalogo
-- sono interne e confrontate alla lettera), etichetta visibile in pagina con "Amica Amimi'". I codici del lotto Shopify
-- seguono lo stesso nome: `AMICA12-XXXXXX` (runbook §4). Nessuna riga la referenzia ancora (riscatti 0, codici 0:
-- verificato prima di applicare); la riga resta SPENTA. Accensione: update loyalty_rewards set active = (key = 'amica12')
-- where key in ('tessera','amica12'); rollback: lo stesso con 'tessera'.

do $$
begin
  if exists (select 1 from loyalty_redemptions where reward_key = 'tessera12') or exists (select 1 from loyalty_reward_codes where reward_key = 'tessera12') then
    raise exception 'pre-check: tessera12 e'' gia'' referenziata da riscatti o codici: rinominare a mano con le FK';
  end if;
end $$;

update loyalty_rewards
   set key = 'amica12',
       label = 'Amica Amimì: 12% sul tuo prossimo ordine (non cumulabile con altri codici)'
 where key = 'tessera12';

insert into loyalty_rewards (key, label, cost_points, kind, value, active, sort) values
  ('amica12', 'Amica Amimì: 12% sul tuo prossimo ordine (non cumulabile con altri codici)', 100, 'percentage', 12, false, 5)
on conflict (key) do nothing;

insert into change_log (tbl, row_id, op, before, after, chi, source) values
  ('loyalty_rewards', 'amica12', 'rename', '{"key":"tessera12"}'::jsonb,
   '{"key":"amica12","label":"Amica Amimì: 12% sul tuo prossimo ordine (non cumulabile con altri codici)","active":false,"motivo":"owner 23-09: nome legato all essere parte di Amimi"}'::jsonb,
   'claude-code', 'migration_0143');
