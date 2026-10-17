-- 0165_push_canale_guardie.sql (2026-10-17): interruttore del canale degli avvisi di ce-guard e sales-guard (PR B delle
-- notifiche native, modifica al core con brief suo: Cowork12/_CLAUDE_CODE_INBOX/2026-10-17_BRIEF_notifiche_guardie_PR_B.md).
--
-- app_flags.push_canale_guardie: 'ntfy' (come prima della PR B) | 'entrambi' (ntfy e notifica dell'app; lo stato
-- dell'avviso lo decide ntfy) | 'push' (notifica dell'app, ntfy solo se non arriva a nessun telefono). Valore assente o
-- sconosciuto = 'ntfy'; con push_enabled diverso da 'true' vale comunque 'ntfy'. La regola sta in
-- supabase/functions/_shared/push.ts (canaleEffettivo, consegnata).
-- Nasce 'ntfy': applicata la migrazione e deployati i guardiani, gli avvisi partono esattamente come prima.
-- Rollback = rimettere 'ntfy', senza deploy. on conflict do nothing: un valore cambiato a mano non viene sovrascritto.
begin;

do $$ begin
  insert into app_flags (key, value) values ('push_canale_guardie', 'ntfy') on conflict (key) do nothing;
  perform set_config('amimi.push_canale_nato_qui', found::text, true);
end $$;

do $$
declare
  v_flag text;
  v_nato text := current_setting('amimi.push_canale_nato_qui', true);
begin
  select value into v_flag from app_flags where key = 'push_canale_guardie';
  if not found then raise exception '0165: manca app_flags.push_canale_guardie'; end if;
  if v_nato is null then raise exception '0165: non so se push_canale_guardie e'' nato in questa migrazione'; end if;
  if v_nato = 'true' and v_flag is distinct from 'ntfy' then
    raise exception '0165: push_canale_guardie nato qui vale % invece di ntfy', v_flag;
  end if;
end $$;

commit;
