-- 0049 (audit 09-07, finding #5): lega gli aggiustamenti di stock del cambio-merce al reso che
-- li ha generati, cosi' return_delete (write-api) puo' revertirli in modo pulito.
alter table stock_adjustments add column if not exists return_id uuid;
comment on column stock_adjustments.return_id is 'FK logica a returns.id: aggiustamento generato da un cambio-merce (sostituto uscito); reso reversibile via write-api return_delete';
