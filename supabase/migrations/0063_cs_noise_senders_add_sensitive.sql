-- Aggiunge le 2 voci sensibili (banca/commercialista) alla denylist CS. OK owner esplicito 2026-07-22.
-- Completa il deliverable a 36/36. Motivo (design 8.1): non sono clienti (fuori dalla coda CS) e restano
-- fuori dal futuro classificatore Gemini; restano interamente in Gmail. UNION idempotente sulle 34 esistenti.
update app_flags set value = (
  select string_agg(tok, E'\n' order by ord)
  from (
    select distinct on (lower(tok)) tok, ord from (
      select trim(t) tok, ord
        from unnest(regexp_split_to_array(value, '[\n,]+')) with ordinality as x(t, ord)
        where trim(t) <> ''
      union all
      select v, 1000 + ord from (values ('bancodesio.it', 1), ('studiocssf.it', 2)) nw(v, ord)
    ) u order by lower(tok), ord
  ) d
)
where key = 'cs_noise_senders';
