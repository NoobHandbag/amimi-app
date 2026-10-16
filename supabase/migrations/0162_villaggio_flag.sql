-- 0162_villaggio_flag.sql (2026-10-16): Regola Ferrea 19 per il Villaggio (ordini e magazzino come isola 3D).
-- Il Villaggio e' un modulo di SOLA INTERFACCIA: nessuna tabella nuova, nessuna azione write-api nuova. Legge
-- v_ordini_arrivo e v_inventory e scrive solo con i componenti di Ordini (ArrivoRow -> arrival_set, SupplierOrderForm ->
-- order_multi). Qui solo il suo interruttore: nasce SPENTO; acceso = tile, scheda #villaggio, bottone nel Cruscotto e
-- app a se' /amimi-app/villaggio/ visibili. Rollback = rimetterlo a 'false', senza deploy.
-- Esposizione ad anon come v_mat_settings (migr 0140): una vista che seleziona SOLO questa chiave; app_flags resta chiusa.
begin;

insert into app_flags (key, value) values ('villaggio_enabled', 'false') on conflict (key) do nothing;

create or replace view v_villaggio_settings as
select key, value from app_flags where key in ('villaggio_enabled');

revoke all on v_villaggio_settings from public;
grant select on v_villaggio_settings to anon, authenticated;

commit;
