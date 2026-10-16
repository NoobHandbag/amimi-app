-- 0161 (16-10-2026): il team entra anche con un account @telaioconsulting.com, e i domini del team stanno in UN posto.
-- Prima "@amimi.it" era scritto a mano in 27 policy RLS (cs_*, lead_*, mat_*, storage lead-assets e mat-assets), in
-- loyalty_staff_email() (Premia: coda e decisione di recensioni e foto, bucket loyalty-ugc) e nel cancello di
-- loyalty_dashboard(). Ora tutti chiedono a public.email_del_team(text). Un dominio in piu' o in meno si cambia QUI e
-- nella costante EMAIL_TEAM delle sei edge che fanno getUser (ai-compila, cs-api, cs-assist, cs-send, lead-outreach,
-- mat-api) e in DOMINI_TEAM del web (lib/csClient.ts): tests/dominio_team.mjs controlla che le tre liste coincidano.
-- Il primo cancello resta l'account: in produzione la registrazione e' chiusa (disable_signup), quindi un indirizzo
-- @telaioconsulting.com entra solo dopo che l'owner gli ha creato l'utente in Supabase Auth.
-- Restano @amimi.it le regole che parlano delle NOSTRE caselle, non di chi entra: destinatari bloccati e mittenti
-- "nostri" in cs-send, cs-sync, cs-api e lead-outreach.
-- Per @amimi.it non cambia niente: maiuscole indifferenti, dominio esatto in coda (x@sub.amimi.it resta fuori, come
-- con ilike '%@amimi.it').

-- 1) la lista dei domini del team
create or replace function public.email_del_team(p_email text) returns boolean
language sql immutable set search_path to '' as $$
  select coalesce(lower(p_email) ~ '@(amimi\.it|telaioconsulting\.com)$', false)
$$;
revoke all on function public.email_del_team(text) from public, anon;
grant execute on function public.email_del_team(text) to authenticated, service_role;

-- 2) le 27 policy: stesso nome, stessa tabella, stesso comando e ruolo; cambia solo chi e' del team.
alter policy cs_conv_sel on public.cs_conversations using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy cs_drf_sel on public.cs_drafts using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy cs_evt_sel on public.cs_events using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy cs_faq_sel on public.cs_faq using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy cs_msg_sel on public.cs_messages using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_accounts_sel on public.lead_accounts using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_contacts_sel on public.lead_contacts using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_drafts_sel on public.lead_drafts using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_evidence_sel on public.lead_evidence using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_inbound_esiti_sel on public.lead_inbound_esiti using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_knowledge_sel on public.lead_knowledge using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_reviews_sel on public.lead_reviews using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_runs_sel on public.lead_runs using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_scores_sel on public.lead_scores using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_sequences_sel on public.lead_sequences using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_touches_sel on public.lead_touches using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy mat_assets_sel on public.mat_assets using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy mat_items_sel on public.mat_items using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy mat_offers_sel on public.mat_offers using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy mat_order_lines_sel on public.mat_order_lines using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy mat_orders_sel on public.mat_orders using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy mat_suppliers_sel on public.mat_suppliers using ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_reviews_ins on public.lead_reviews with check ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_touches_ins on public.lead_touches with check ((select public.email_del_team(auth.jwt() ->> 'email')));
alter policy lead_assets_sel on storage.objects using (bucket_id = 'lead-assets' and (select public.email_del_team(auth.jwt() ->> 'email')));
alter policy mat_assets_sel on storage.objects using (bucket_id = 'mat-assets' and (select public.email_del_team(auth.jwt() ->> 'email')));
alter policy mat_assets_ins on storage.objects with check (bucket_id = 'mat-assets' and (select public.email_del_team(auth.jwt() ->> 'email')) and name like 'inbox/%');

-- 3) Premia: chi e' del team si legge ancora da auth.users con l'id del token ed email CONFERMATA (Gate 2 del 12-10);
--    cambia solo la lista dei domini. Vale anche per la policy loyalty_ugc_sel del bucket, che chiama questa funzione.
create or replace function public.loyalty_staff_email() returns text
language sql stable security definer set search_path to '' as $$
  select u.email::text from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null and public.email_del_team(u.email)
$$;

-- 4) loyalty_dashboard: corpo identico alla 0147 (md5 del corpo live verificato uguale al repo il 16-10), cambia solo il cancello
create or replace function public.loyalty_dashboard(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_days  int  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_from  date;
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_paid  constant text[] := array['paid', 'partially_refunded', 'refunded'];   -- stesso filtro di v_loyalty_uplift
  v_out   jsonb;
begin
  if not public.email_del_team(v_email) then
    raise exception 'loyalty_dashboard: riservato agli account del team' using errcode = '42501';
  end if;
  v_from := v_today - (v_days - 1);

  select jsonb_build_object(
    'generated_at', now(),
    'days', v_days,
    'from', v_from,
    'to', v_today,

    -- semaforo: ultima riga per chiave loyalty_* degli ultimi 7 giorni; le label possono contenere id cliente o testo
    -- d'errore (0137 elenca i membri fuori quadra): ogni sequenza di 5+ cifre viene oscurata
    'health', (select coalesce(jsonb_agg(jsonb_build_object('k', h.k, 'label', regexp_replace(coalesce(h.label, ''), '[0-9]{5,}', '…', 'g'),
                                                            'n', h.n, 'severity', h.severity, 'day', h.day) order by h.k), '[]'::jsonb)
               from (select distinct on (k) k, label, n, severity, day from health_log
                     where k like 'loyalty\_%' and day >= v_today - 7 order by k, day desc) h),

    -- flag: solo lo stato (on/off/test), mai la lista degli id di prova
    'flags', (select coalesce(jsonb_object_agg(f.key, case when lower(trim(f.value)) = 'true' then 'on'
                                                          when lower(trim(f.value)) in ('', 'false') then 'off'
                                                          else 'test' end), '{}'::jsonb)
              from app_flags f
              where f.key in ('loyalty_redeem_enabled', 'loyalty_purchase_enabled', 'loyalty_profile_enabled', 'loyalty_tier_lifetime_enabled',
                              'loyalty_bonus_second_enabled', 'loyalty_track_enabled', 'loyalty_click_enabled')),
    'orders_last_run', (select value from app_flags where key = 'loyalty_orders_last_run'),

    'kpi_daily', (select coalesce(jsonb_agg(to_jsonb(k) order by k.day), '[]'::jsonb) from v_loyalty_kpi_daily k where k.day >= v_from),

    -- ritmo del pool: riscatti degli ultimi 14 giorni e giorni EFFETTIVI della finestra (dal primo riscatto del premio
    -- se e' piu' recente di 14 giorni: un premio attivo da 4 giorni non si divide per 14)
    'pool', (select coalesce(jsonb_agg(jsonb_build_object(
                'reward', p.reward, 'label', p.label, 'cost_points', p.cost_points, 'active', p.active,
                'liberi', p.codici_liberi, 'usati', p.codici_usati, 'pending', p.riscatti_pending,
                'riscatti_14gg', (select count(*) from loyalty_redemptions r
                                  where r.reward_key = p.reward and r.status = 'fulfilled' and r.created_at >= now() - interval '14 days'),
                'giorni_ritmo',  (select least(14, greatest(1, v_today - min((r.created_at at time zone 'Europe/Rome')::date) + 1))
                                  from loyalty_redemptions r where r.reward_key = p.reward and r.status = 'fulfilled'))
              order by p.active desc, p.reward), '[]'::jsonb)
             from v_loyalty_pool p where p.active),

    'members', (select jsonb_build_object(
                  'totale',      count(*),
                  'lt50',        count(*) filter (where m.saldo < 50),
                  'b50_99',      count(*) filter (where m.saldo between 50 and 99),
                  'ge100',       count(*) filter (where m.saldo >= 100),
                  -- niente "attivi 30gg" su ultimo_evento: il retroattivo del 21-09 ha dato un evento recente a tutti i membri
                  'tier_saldo',     (select coalesce(jsonb_object_agg(t.tier, t.n), '{}'::jsonb) from (select coalesce(tier_saldo, 'n/d') as tier, count(*) n from v_loyalty_members group by 1) t),
                  'tier_cumulato',  (select coalesce(jsonb_object_agg(t.tier, t.n), '{}'::jsonb) from (select coalesce(tier_cumulato, 'n/d') as tier, count(*) n from v_loyalty_members group by 1) t))
                from v_loyalty_members m),

    'visitatori', jsonb_build_object(
      'periodo', (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day >= v_from),
      'totale',  (select count(distinct v.shopify_customer_id) from loyalty_visits v),
      'dal',     (select min(v.day) from loyalty_visits v)),

    'second', (select jsonb_build_object(
                 'finestre_aperte', count(*) filter (where s.n_ordini = 1 and s.deadline >= v_today),
                 'in_scadenza_14gg', count(*) filter (where s.n_ordini = 1 and s.deadline between v_today and v_today + 14),
                 'bonus_dati',      count(*) filter (where coalesce(s.bonus_points, 0) > 0 and coalesce(s.bonus_reversed, 0) = 0))
               from v_loyalty_second_order s),

    'redeem_rate', (select to_jsonb(x) from v_loyalty_redeem_rate x),

    'amica12', jsonb_build_object(
      'riscattati_totale',  (select count(*) from loyalty_redemptions r where r.reward_key = 'amica12' and r.status = 'fulfilled'),
      'riscattati_periodo', (select count(*) from loyalty_redemptions r where r.reward_key = 'amica12' and r.status = 'fulfilled'
                               and (r.created_at at time zone 'Europe/Rome')::date >= v_from),
      'ordini_totale',      (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)),
      'ordini_periodo',     (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)
                               and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
      'lordo_totale',       (select coalesce(sum(o.gross_total), 0) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)),
      'sconto_totale',      (select coalesce(sum(o.discount_total), 0) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)),
      'con_reso',           (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)
                               and coalesce(o.refund_amount, 0) > 0)),

    -- effetto vendite: ordini del periodo di clienti che avevano aperto l'Area Membri PRIMA dell'ordine (nei 30 giorni
    -- precedenti; la visita dello stesso giorno conta solo se e' iniziata prima dell'ordine)
    'vendite', (select jsonb_build_object(
                  'ordini_periodo',       count(*),
                  'lordo_periodo',        coalesce(sum(o.gross_total), 0),
                  'ordini_dopo_visita',   count(*) filter (where x.visto),
                  'lordo_dopo_visita',    coalesce(sum(o.gross_total) filter (where x.visto), 0))
                from shopify_orders o
                cross join lateral (
                  select exists (
                    select 1 from loyalty_order_credits c join loyalty_visits v on v.shopify_customer_id = c.shopify_customer_id
                    where c.order_name = o.order_id
                      and v.day >= (o.created_at_shop at time zone 'Europe/Rome')::date - 30
                      and v.first_at < o.created_at_shop
                  ) as visto) x
                where o.financial_status = any(v_paid) and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
    'uplift', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from v_loyalty_uplift u),

    -- funnel del periodo: clienti distinti, tranne l'ultimo passaggio (ordini)
    'funnel', jsonb_build_object(
      'aperture',       (select count(distinct v.shopify_customer_id) from loyalty_visits v where v.day >= v_from),
      'sessioni',       (select count(*) from loyalty_ui_events u where u.day >= v_from and u.event = 'page_open'),
      'visto_premio',   (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'view' and u.element like 'redeem\_%'),
      'premio_pronto',  (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'view' and u.element = 'redeem_ready'),
      'tap_riscatta',   (select count(distinct u.shopify_customer_id) from loyalty_ui_events u where u.day >= v_from and u.event = 'tap' and u.element = 'redeem'),
      'riscatti',       (select count(distinct r.shopify_customer_id) from loyalty_redemptions r where r.status = 'fulfilled' and (r.created_at at time zone 'Europe/Rome')::date >= v_from),
      'ordini_amica12', (select count(*) from shopify_orders o where o.discount_codes ilike '%AMICA12-%' and o.financial_status = any(v_paid)
                           and (o.created_at_shop at time zone 'Europe/Rome')::date >= v_from),
      'eventi',         (select count(*) from loyalty_ui_events u where u.day >= v_from),
      'dal',            (select min(u.day) from loyalty_ui_events u)),
    'elementi', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'element', e.element, 'n', e.n, 'clienti', e.clienti) order by e.n desc), '[]'::jsonb)
                 from (select u.event, u.element, count(*) n, count(distinct u.shopify_customer_id) clienti
                       from loyalty_ui_events u where u.day >= v_from and u.event <> 'page_open'
                       group by 1, 2 order by 3 desc limit 30) e)
  ) into v_out;
  return v_out;
end $$;

revoke all on function public.loyalty_dashboard(integer) from anon, public;
grant execute on function public.loyalty_dashboard(integer) to authenticated;

-- 5) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa
do $$
declare n int;
begin
  if exists (select 1 from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ilike '%amimi.it%') then
    raise exception '0161: resta una policy col dominio scritto a mano';
  end if;
  select count(*) into n from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%email_del_team%';
  if n <> 27 then raise exception '0161: % policy chiamano email_del_team, ne servono 27', n; end if;
  if not (public.email_del_team('Info@Amimi.it') and public.email_del_team('chiunque@telaioconsulting.com')
          and public.email_del_team('X@TelaioConsulting.COM')
          and not public.email_del_team('x@amimi.it.evil.com') and not public.email_del_team('x@sub.amimi.it')
          and not public.email_del_team('x@telaioconsulting.com.it') and not public.email_del_team('x@evil-telaioconsulting.com')
          and not public.email_del_team('amimi.it') and not public.email_del_team('x@gmail.com')
          and not public.email_del_team('') and not public.email_del_team(null)) then
    raise exception '0161: email_del_team non da'' i risultati attesi';
  end if;
  if has_function_privilege('anon', 'public.email_del_team(text)', 'execute') then
    raise exception '0161: anon non deve eseguire email_del_team';
  end if;
end $$;
