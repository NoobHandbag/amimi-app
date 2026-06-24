alter table expenses drop column amimi;
alter table expenses add column amimi boolean generated always as (lower(trim(coalesce(amimi_raw,''))) = 'si') stored;
