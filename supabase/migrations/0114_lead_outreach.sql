-- 0114: outreach, tappa 1 (PIANO_Outreach_CRM.md, owner "sviluppalo" 10-09): pipeline manuale,
-- timeline dei tocchi registrati dalla UI, prossima azione con scadenza, sequenze (template dei 4 tocchi).
-- Niente invio, niente inbound automatico (tappe 2-4). Scritture UI: INSERT su lead_touches dall'utente
-- loggato @amimi.it (stesso canale controllato di lead_reviews), trigger riflette stadio e prossima azione.

alter table lead_accounts add column if not exists prossima_azione text;
alter table lead_accounts add column if not exists prossima_azione_at date;
alter table lead_accounts add column if not exists owner_outreach text;

alter table lead_touches add column if not exists esito text;               -- interessato|chiede_info|no|piu_avanti|nessuna_risposta|bounce|opt_out|altro
alter table lead_touches add column if not exists prossima_azione text;
alter table lead_touches add column if not exists prossima_azione_at date;
alter table lead_touches add column if not exists sequenza_tocco int;

create table if not exists lead_sequences (
  id             serial primary key,
  codice         text not null,                 -- boutique_it | boutique_en
  tocco          int not null,                  -- 0 telefono, 1..4 email
  giorni_attesa  int not null default 0,        -- dopo il tocco precedente
  canale         text not null default 'email',
  lingua         text not null default 'it',
  oggetto        text,
  corpo          text not null,
  chi_default    text,
  attiva         boolean not null default true,
  updated_at     timestamptz not null default now(),
  unique (codice, tocco)
);

-- trigger: un tocco registrato aggiorna stadio, prossima azione e, se e' una risposta, lo stadio "risposto"
create or replace function lead_touches_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare cur_stage text;
begin
  select lead_stage into cur_stage from lead_accounts where id = new.account_id;
  update lead_accounts set
    lead_stage = coalesce(new.stage_dopo, case when new.direzione = 'in' and cur_stage in ('da_contattare','contattato') then 'risposto' when new.direzione = 'out' and cur_stage = 'da_contattare' then 'contattato' else cur_stage end),
    prossima_azione = case when new.prossima_azione is not null or new.prossima_azione_at is not null then new.prossima_azione else prossima_azione end,
    prossima_azione_at = case when new.prossima_azione is not null or new.prossima_azione_at is not null then new.prossima_azione_at else prossima_azione_at end,
    owner_outreach = coalesce(owner_outreach, new.chi),
    updated_at = now()
  where id = new.account_id;
  if new.esito = 'opt_out' then
    update lead_accounts set lead_stage = 'opt_out', updated_at = now() where id = new.account_id;
    update lead_contacts set opt_out = true, opt_out_at = now() where account_id = new.account_id and (new.contact_id is null or id = new.contact_id);
  end if;
  return new;
end $$;
drop trigger if exists lead_touches_apply_trg on lead_touches;
create trigger lead_touches_apply_trg after insert on lead_touches for each row execute function lead_touches_apply();

-- vista pipeline: i negozi con verdetto "da contattare" (o gia' in lavorazione), con ultimo tocco e scadenze
create or replace view v_lead_outreach with (security_invoker = on) as
select a.id, a.nome, a.tipo, a.citta, a.provincia, a.paese, a.website, a.ig_handle, a.email_generica, a.telefono,
  a.lead_stage, a.verdetto, a.verdetto_motivo, a.tier, a.gancio, a.prossima_azione, a.prossima_azione_at, a.owner_outreach, a.owner_note,
  s.totale, s.tier_proposto,
  t.at as ultimo_tocco_at, t.canale as ultimo_canale, t.direzione as ultima_direzione, t.esito as ultimo_esito, t.chi as ultimo_chi,
  (select count(*) from lead_touches x where x.account_id = a.id) as n_tocchi,
  (select count(*) from lead_touches x where x.account_id = a.id and x.direzione = 'out' and x.canale = 'email') as n_email_out,
  case when t.at is null then null else extract(day from now() - t.at)::int end as giorni_da_ultimo,
  (a.prossima_azione_at is not null and a.prossima_azione_at < current_date) as scaduta,
  (t.direzione = 'in' and a.lead_stage = 'risposto') as da_gestire,
  (select payload->'post'->0->>'asset_path' from lead_evidence e where e.account_id = a.id and e.tipo = 'ig_posts' and payload->'post'->0->>'asset_path' is not null order by captured_at desc limit 1) as thumb,
  (select payload->>'follower' from lead_evidence e where e.account_id = a.id and e.tipo = 'ig_metrics' order by captured_at desc limit 1)::int as follower,
  (select payload->>'telefono' from lead_evidence e where e.account_id = a.id and e.tipo = 'maps' order by captured_at desc limit 1) as telefono_maps,
  (select payload->'emails'->>0 from lead_evidence e where e.account_id = a.id and e.tipo = 'site_meta' order by captured_at desc limit 1) as email_sito,
  (select count(*) from lead_contacts c where c.account_id = a.id and c.opt_out) as n_opt_out
from lead_accounts a
left join lateral (select * from lead_scores x where x.account_id = a.id order by created_at desc limit 1) s on true
left join lateral (select * from lead_touches y where y.account_id = a.id order by at desc limit 1) t on true
where a.verdetto = 'da_contattare' or a.lead_stage <> 'da_contattare' or a.owner_outreach is not null;

-- sicurezza
alter table lead_sequences enable row level security;
revoke all on lead_sequences from anon, authenticated;
grant select on lead_sequences to authenticated;
drop policy if exists lead_sequences_sel on lead_sequences;
create policy lead_sequences_sel on lead_sequences for select to authenticated using ((auth.jwt() ->> 'email') ilike '%@amimi.it');
grant insert on lead_touches to authenticated;
drop policy if exists lead_touches_ins on lead_touches;
create policy lead_touches_ins on lead_touches for insert to authenticated with check ((auth.jwt() ->> 'email') ilike '%@amimi.it');
revoke all on v_lead_outreach from anon;
grant select on v_lead_outreach to authenticated;

-- sequenza boutique IT/EN (da Sequenze_Outreach_IT_EN.md, progetto Rappresentante_Wholesale). Segnaposto:
-- {{nome_negozio}} {{referente}} {{gancio}} {{firma}} {{citta}}. Testi modificabili a DB, mai hardcoded in UI.
insert into lead_sequences (codice, tocco, giorni_attesa, canale, lingua, oggetto, corpo, chi_default) values
('boutique_it', 0, 0, 'telefono', 'it', null,
'Buongiorno, sono Benedetta di Amimì Milano, siamo un piccolo brand di borse artigianali fatte a mano. {{gancio}} Ha un minuto?
Lavorate già con qualche brand di borse o accessori artigianali? Che fascia di prezzo funziona meglio da voi?
Le nostre borse vanno dai 50 ai 190 euro al pubblico, fatte a mano, la pelle è Made in Italy. Sono colorate e riconoscibili, la cliente le compra d''impulso. Per il negozio il margine è pieno e l''ordine minimo è basso.
Le mando il nostro catalogo con i prezzi, così dà un''occhiata con calma. A che indirizzo glielo giro?', 'Benny'),
('boutique_it', 1, 0, 'email', 'it', 'Amimì Milano per {{nome_negozio}}, il catalogo di cui parlavamo',
'Gentile {{referente}},
come anticipato, le allego il catalogo wholesale di Amimì Milano: borse artigianali fatte a mano a Milano, pelle Made in Italy e cotone colorato, prezzi al pubblico da 50 a 190 euro.

{{gancio}}

Ordine minimo basso, consegna rapida sui pezzi a magazzino. Se le va, passo volentieri con qualche borsa da vedere dal vivo.

Un caro saluto,
{{firma}}
Se preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.', 'Benedetta'),
('boutique_it', 2, 5, 'email', 'it', 'Re: Amimì Milano per {{nome_negozio}}',
'Gentile {{referente}},
volevo solo assicurarmi che le fosse arrivato il catalogo. Se ha due minuti le segnalo i tre pezzi che stanno funzionando meglio in questa stagione: la Lea in pelle cocco, la Nina in cotone colorato e gli accessori piccoli (cover e mini case), che al banco cassa girano bene.
Resto a disposizione per un salto in negozio.
{{firma}}', 'Benedetta'),
('boutique_it', 3, 7, 'email', 'it', 'Un''idea per {{nome_negozio}}: partire in piccolo',
'Gentile {{referente}},
capisco che di brand ne vedete tanti. La mia proposta è semplice: si parte con un ordine piccolo, solo i modelli che secondo lei stanno con la vostra clientela, e vediamo come vanno. Se vuole, per il primo ingresso possiamo valutare anche il conto vendita su un paio di pezzi, così il rischio è zero.
Le va se passo con il campionario?
{{firma}}', 'Benedetta'),
('boutique_it', 4, 10, 'email', 'it', 'Resto a disposizione',
'Gentile {{referente}},
non voglio disturbarla oltre. Le lascio il catalogo, se in futuro vorrà inserire le nostre borse mi trova sempre qui. Le auguro buon lavoro.
{{firma}}
Non la contatterò ulteriormente salvo un suo cenno.', 'Benedetta'),
('boutique_en', 1, 0, 'email', 'en', 'Amimì Milano, handmade Italian bags for {{nome_negozio}}',
'Dear {{referente}},
I''m Benedetta from Amimì Milano, a small Italian brand of handmade bags: Made-in-Italy leather and natural cotton, retail from 50 to 190 euros.

{{gancio}}

Low minimum order, quick delivery on stocked items. I''d be glad to send our wholesale catalogue and, if you like, a few samples.

Warm regards,
{{firma}}
If you''d rather not hear from me again, just reply "no thanks" and I won''t contact you further.', 'Benedetta'),
('boutique_en', 2, 5, 'email', 'en', 'Re: Amimì Milano for {{nome_negozio}}',
'Dear {{referente}},
just making sure the catalogue reached you. The three pieces doing best this season: the Lea in croc-embossed leather, the Nina in coloured cotton, and the small accessories (cases and covers) that sell well at the till.
Happy to send samples.
{{firma}}', 'Benedetta'),
('boutique_en', 3, 7, 'email', 'en', 'An idea for {{nome_negozio}}: start small',
'Dear {{referente}},
I know you see many brands. My proposal is simple: start with a small order, only the models you feel fit your customers, and see how they go. For a first entry we can also consider consignment on a couple of pieces.
Would samples help?
{{firma}}', 'Benedetta'),
('boutique_en', 4, 10, 'email', 'en', 'Staying available',
'Dear {{referente}},
I won''t take more of your time. The catalogue is yours, and if you ever wish to add our bags I''m here. All the best for the season.
{{firma}}
I won''t contact you again unless you get in touch.', 'Benedetta')
on conflict (codice, tocco) do nothing;

insert into app_flags (key, value) values ('lead_firma', 'Benedetta - Amimì Milano
wholesale@amimi.it - +39 333 280 8226 - P.IVA 14559580965') on conflict (key) do nothing;
insert into app_flags (key, value) values ('lead_tetto_giornaliero', '20') on conflict (key) do nothing;
