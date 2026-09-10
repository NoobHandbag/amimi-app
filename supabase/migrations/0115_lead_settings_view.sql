-- app_flags non e' leggibile dai ruoli applicativi (giusto: contiene segreti). Le sole chiavi lead_* non sensibili
-- (firma, tetto) passano da una vista di proprieta' postgres, leggibile solo dagli utenti loggati @amimi.it.
create or replace view v_lead_settings as
select key, value from app_flags where key in ('lead_enabled','lead_firma','lead_tetto_giornaliero');
revoke all on v_lead_settings from anon, public;
grant select on v_lead_settings to authenticated;
