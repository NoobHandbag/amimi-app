-- 0209 (24-11, Dan in chat: "togli anche l'ultima riga, come ha fatto lui. Ignora la privacy"): il tocco 1 delle due
-- sequenze (boutique_it e boutique_en) non chiude piu' con la riga di opt-out; Giovanni la toglieva a mano (13 email su
-- 15). L'email finisce con la firma. Insieme a lead-outreach v20, che non la aggiunge e non la chiede piu' all'invio.
-- Il tocco 4 tiene la sua chiusura ("Non vi contatterò ulteriormente..."), che e' testo della email, non la riga di
-- opt-out. Un "no grazie" scritto da un negozio resta un opt-out riconosciuto dal giro.
-- Solo dati del modulo lead_* (Regola Ferrea 19). Before in change_log. Rollback: i before con source 'migr 0209'.

begin;

create temp table vecchi on commit drop as
select id, codice, oggetto, corpo from lead_sequences
 where codice in ('boutique_it', 'boutique_en') and tocco = 1;

update lead_sequences s set updated_at = now(),
  corpo = regexp_replace(s.corpo, E'\\n[^\\n]*(no grazie|no thanks)[^\\n]*$', '')
  from vecchi v
 where s.id = v.id and s.corpo ~ '(no grazie|no thanks)[^\n]*$';

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'lead_sequences', s.id::text, 'update', jsonb_build_object('corpo', v.corpo), jsonb_build_object('corpo', s.corpo),
       'claude-code', 'migr 0209'
  from lead_sequences s join vecchi v on v.id = s.id
 where s.corpo is distinct from v.corpo;

do $$
begin
  if (select count(*) from lead_sequences
       where codice in ('boutique_it', 'boutique_en') and tocco = 1 and corpo ~ '\{\{firma\}\}$') <> 2 then
    raise exception '0209: attesi 2 template (tocco 1 IT e EN) che finiscono con {{firma}}';
  end if;
  if exists (select 1 from lead_sequences where codice in ('boutique_it', 'boutique_en') and tocco between 1 and 3
              and corpo ~* '(no grazie|no thanks)') then
    raise exception '0209: resta una riga di opt-out nei tocchi 1-3';
  end if;
end $$;

commit;
