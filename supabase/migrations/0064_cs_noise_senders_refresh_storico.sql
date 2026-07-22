-- Refresh denylist rumore CS: allinea app_flags.cs_noise_senders al deliverable
-- DENYLIST_cs_noise_senders.txt aggiornato (77 voci, +41 mittenti-rumore dallo storico
-- Takeout della vecchia casella). Brief Cowork 2026-07-22, OK owner. Regola Ferrea 16.
-- Semantica edge cs-sync v2 (verificata su index.ts riga 131): value split /[\n,]+/, trim,
-- match SUBSTRING case-insensitive di ogni voce su From(email) E Subject.
-- Le 36 voci gia' presenti restano (nessuna regressione); si aggiungono solo le mancanti.
-- Nessun dominio consumer, nessun form/chat cliente Shopify (esclusi di proposito).
-- Caveat: 'ups.com' e' una substring corta (match teorico su @startups.com); rischio pratico
-- nullo e non distruttivo (instrada solo la coda CS come rumore). 'shopifyemail.com' e' ridondante
-- (branch Shopify gestito prima di isNoiseSender) ma innocuo.
-- UNION idempotente: distinct-on(lower(tok)), le voci esistenti (ord basso) vincono e mantengono
-- posizione; le nuove (ord 1000+) appendono in coda. Rieseguibile senza effetti (no-op a regime).
update app_flags set value = (
  select string_agg(tok, E'\n' order by ord)
  from (
    select distinct on (lower(tok)) tok, ord from (
      select trim(t) tok, ord
        from unnest(regexp_split_to_array(value, '[\n,]+')) with ordinality as x(t, ord)
        where trim(t) <> ''
      union all
      select v, 1000 + ord from (values
        ('Report Domain: amimi.it', 1),
        ('dmarc.yahoo.com', 2),
        ('mimecastreport.com', 3),
        ('dmarcreport@microsoft.com', 4),
        ('noreply-dmarc-support@google.com', 5),
        ('dmarcreport@aruba.it', 6),
        ('omegatheme.com', 7),
        ('klaviyo.com', 8),
        ('supabase.com', 9),
        ('email.shopify.com', 10),
        ('ads-service.tiktok.com', 11),
        ('anthropic.com', 12),
        ('claude.com', 13),
        ('openai.com', 14),
        ('larksuite.com', 15),
        ('miro.com', 16),
        ('updates.notion.so', 17),
        ('github.com', 18),
        ('facebookmail.com', 19),
        ('business-marketing.facebook.com', 20),
        ('developers.facebook.com', 21),
        ('paypal.it', 22),
        ('paypal.com', 23),
        ('klarna.com', 24),
        ('twsexpresscourier.it', 25),
        ('accounts.google.com', 26),
        ('workspace-noreply@google.com', 27),
        ('meetings-noreply@google.com', 28),
        ('drive-shares-dm-noreply@google.com', 29),
        ('bancodesio.it', 30),
        ('studiocssf.it', 31),
        ('zerow.it', 32),
        ('marketing.ryanairemail.it', 33),
        ('articolipromozionali.eu', 34),
        ('message@adobe.com', 35),
        ('booking.email.ikea.it', 36),
        ('gls-italy.com', 37),
        ('brt.it', 38),
        ('ups.com', 39),
        ('sendcloud.com', 40),
        ('wetransfer.com', 41),
        ('sumup.com', 42),
        ('crm.sumup.com', 43),
        ('notification.sumup.com', 44),
        ('sumup.it', 45),
        ('stripe.com', 46),
        ('shopifyemail.com', 47),
        ('e.mailchimp.com', 48),
        ('mailchimpapp.com', 49),
        ('brevosend.com', 50),
        ('squalomail.it', 51),
        ('newsletter.hearst.it', 52),
        ('mailing.italotreno.it', 53),
        ('mlmitalia.it', 54),
        ('portfoliomail.com', 55),
        ('pixartprinting.com', 56),
        ('packhelp.com', 57),
        ('samplelover.it', 58),
        ('allfabrics.it', 59),
        ('tessiland.com', 60),
        ('sipec.com', 61),
        ('lineapelle-fair.it', 62),
        ('gima-accessori.com', 63),
        ('sartoriafiorella.com', 64),
        ('zeusnoto.com', 65),
        ('manufacto-store.com', 66),
        ('scilemilano.com', 67),
        ('bonvigioielli.com', 68),
        ('arcobaleno.eu', 69),
        ('tributarioassociato.it', 70),
        ('cdcsrl.net', 71),
        ('sistemi.com', 72),
        ('senesidesign.it', 73),
        ('vivaioventures.it', 74),
        ('beyond-artists.com', 75),
        ('miista.com', 76),
        ('saudilifestyleweek.com', 77)
      ) nw(v, ord)
    ) u order by lower(tok), ord
  ) d
)
where key = 'cs_noise_senders';
