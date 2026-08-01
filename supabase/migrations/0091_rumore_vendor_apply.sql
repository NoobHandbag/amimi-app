-- NEL DB: applicata come `0090_rumore_vendor_apply` (01-08 mattina). File locale rinumerato 0091
-- per la collisione di numerazione col 0089 margine della sessione parallela.
-- APPLY della proposta rumore vendor (Parte B brief cs_stato_automatico_e_rumore).
-- GATE SUPERATO: lista dei 12 domini vista e approvata dall'owner in chat il 2026-08-01
-- ("e' solo rumore, non ha nulla a che fare con assistenza clienti"); scelta owner = 'rumore'
-- secco, NIENTE canale vendor separato. File della proposta:
-- Cowork12/projects/Servizio_Clienti_2026-06/PROPOSTA_Rumore_Vendor_2026-08-01.md
-- Guardie: voci in forma '@dominio' (matcha il mittente, quasi mai un subject); nessun dominio
-- di posta personale; la riclassifica esclude qualunque conversazione con un nostro 'out'.
-- Esito reale: denylist 77 -> 88 voci; 32 conversazioni riclassificate (una in piu' della
-- proposta: arrivata nel frattempo, sempre senza nostri out); evento cs_events 'rumore_vendor'
-- per riga. Idempotente: re-run aggiunge 0 voci e riclassifica 0 righe.

update app_flags set value = value || coalesce(
  (select E'\n' || string_agg(d, E'\n')
   from unnest(array[
     '@google.com', '@learnn.com', '@nexi.it', '@email.shopify.com', '@email.trivago.com',
     '@mail.granola.ai', '@trustpilotmail.com', '@booking.com', '@marketing.ryanairemail.it',
     '@all-in-one-marketingsoftware.org', '@omegatheme.com', '@getbunbundles.com'
   ]) d
   where position(d in value) = 0), '')
where key = 'cs_noise_senders';

with target as (
  select c.id, c.canale as canale_prima
  from cs_conversations c
  where c.categoria = 'Collaborazioni e B2B' and c.canale <> 'rumore'
    and lower(split_part(coalesce(c.customer_email, ''), '@', 2)) in (
      'google.com', 'learnn.com', 'nexi.it', 'email.shopify.com', 'email.trivago.com',
      'mail.granola.ai', 'trustpilotmail.com', 'booking.com', 'marketing.ryanairemail.it',
      'all-in-one-marketingsoftware.org', 'omegatheme.com', 'getbunbundles.com')
    and not exists (select 1 from cs_messages m where m.conversation_id = c.id and m.direction = 'out')
),
upd as (
  update cs_conversations c set canale = 'rumore'
  from target t where c.id = t.id
  returning c.id, t.canale_prima
)
insert into cs_events (conversation_id, azione, chi, dettaglio)
select id, 'rumore_vendor', 'claude-code',
  jsonb_build_object('da', canale_prima, 'a', 'rumore', 'motivo', 'domini vendor approvati owner 01-08')
from upd;
