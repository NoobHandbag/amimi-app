-- Prova della migr 0198 (lead_email_utile, lead_emails_sito). Si lancia in produzione DOPO la migrazione, o in coda al
-- testo della migrazione in un solo blocco per la prova prima dell'apply: finisce sempre in un'eccezione, quindi non
-- lascia niente. 'TEST_OK' = tutto verde; 'KO ...' = il caso che non torna.
do $t$ begin
  if not public.lead_email_utile(' Info@Negozio.IT ') then raise exception 'KO 1 un''email normale non vale'; end if;
  if public.lead_email_utile('a@pec.it') or public.lead_email_utile('a@arubapec.it') or public.lead_email_utile('a@pec.conmet.it')
     or public.lead_email_utile('a@confcommerciopec.it') or public.lead_email_utile('a@legalmail.it') or public.lead_email_utile('a@cgn.legalmail.it')
     or public.lead_email_utile('a@certificata.taxmail.it') or public.lead_email_utile('a@pcert.it') or public.lead_email_utile('a@postacert.it')
     or public.lead_email_utile('a@actaliscertymail.it') or public.lead_email_utile('a@sicurezzapostale.it')
  then raise exception 'KO 2 una PEC vale come email'; end if;
  if public.lead_email_utile('nome@gmail.com') or public.lead_email_utile('utente@dominio.com') or public.lead_email_utile('xxx@xxx.xxx')
     or public.lead_email_utile('johndoe@domain.com') or public.lead_email_utile('protocollo@pec.gpdp.it') or public.lead_email_utile('assistenza@webador.it')
     or public.lead_email_utile('tu@email.address') or public.lead_email_utile('dpo@negozio.it') or public.lead_email_utile('u003einfo@negozio.it')
  then raise exception 'KO 3 un segnaposto o un indirizzo non del negozio vale come email'; end if;
  if public.lead_email_utile(null) or public.lead_email_utile('') or public.lead_email_utile('   ') or public.lead_email_utile('maria') or public.lead_email_utile('a@b')
  then raise exception 'KO 4 vuoto o non un''email vale'; end if;
  if not public.lead_email_utile('spec@specchi.it') or not public.lead_email_utile('info@pecora.it') or not public.lead_email_utile('info@spec.it') or not public.lead_email_utile('info@ipec.it') then raise exception 'KO 5 "pec" dentro un nome qualunque non deve bastare'; end if;
  if public.lead_emails_sito('{"emails":["a@pec.it","Info@x.it","info@x.it","b@x.it"]}') is distinct from array['Info@x.it','b@x.it']
  then raise exception 'KO 6 lead_emails_sito: ordine, doppioni senza maiuscole, PEC tolte'; end if;
  if public.lead_emails_sito('{"emails":"rotto"}') <> '{}' or public.lead_emails_sito('{}') <> '{}' or public.lead_emails_sito(null) <> '{}'
  then raise exception 'KO 7 lead_emails_sito su payload senza lista'; end if;
  if exists (select 1 from v_lead_dossier where email_sito is not null and not public.lead_email_utile(email_sito))
     or exists (select 1 from v_lead_outreach where email_sito is not null and not public.lead_email_utile(email_sito))
     or exists (select 1 from v_lead_lista where email_sito is not null and not public.lead_email_utile(email_sito))
  then raise exception 'KO 8 una vista espone come email_sito un indirizzo non utile'; end if;
  raise exception 'TEST_OK';
end $t$;
