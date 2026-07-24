-- Motore verdetti CS (design Parte B 24-07): la finestra reso e' un DATO, non hardcode.
-- cs-assist (case_data/draft) la legge da qui con fallback 15. Cambiarla = 1 UPDATE, zero deploy.
insert into app_flags(key, value) values ('cs_reso_finestra_giorni', '15')
  on conflict (key) do update set value = excluded.value;
