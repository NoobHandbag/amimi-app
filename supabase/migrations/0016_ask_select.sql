-- FLOW 6: guarded read-only executor for NL->SQL. SELECT-only, single statement, capped at 200 rows.
create or replace function ask_select(q text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if q !~* '^\s*select' then raise exception 'solo query SELECT sono consentite'; end if;
  if q ~* ';\s*\S' then raise exception 'una sola query alla volta'; end if;
  if q ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|vacuum|merge|call|do)\M'
    then raise exception 'query non consentita'; end if;
  perform set_config('statement_timeout', '5000', true);
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (' || q || ') sub limit 200) t' into r;
  return r;
end $$;

revoke all on function ask_select(text) from public, anon, authenticated;
grant execute on function ask_select(text) to service_role;
