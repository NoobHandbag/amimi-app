-- 0205: voce "Condizioni commerciali" di lead_knowledge allineata alla line sheet 2026 (pagina amimi-trade v8,
-- migr 0203). Owner in chat, 20-11-2026: "fix the conditions note too".
-- Due frasi che la pagina non dice piu': "accessori liberi" (gli accessori non sono nella line sheet) e
-- "Lea e Annie sono sempre su ordine" (la pagina distingue solo fra pronto a magazzino e su ordinazione).
-- Il resto delle condizioni e' identico alla pagina e non cambia. Il titolo prende la data della line sheet nuova.
-- Solo dati del modulo lead_* (Regola Ferrea 19): una riga. Le bozze gia' scritte in lead_drafts non si toccano.
-- Rieseguibile: replace sul testo, controllo finale con RAISE.

update lead_knowledge set updated_at = now(),
  titolo = 'Condizioni commerciali (line sheet 2026, in pagina dal 20-11-2026)',
  contenuto = replace(replace(contenuto,
    'Minimo per colore: 2 pezzi sulle borse, accessori liberi.',
    'Minimo per colore: 2 pezzi per ciascun colore, sui modelli di borse.'),
    '; Lea e Annie sono sempre su ordine; nessuna consegna in agosto.',
    '; nessuna consegna in agosto.')
where titolo like 'Condizioni commerciali%';

do $$
declare n_ok int; n_old int;
begin
  select count(*) into n_ok from lead_knowledge
    where attiva and titolo = 'Condizioni commerciali (line sheet 2026, in pagina dal 20-11-2026)'
      and contenuto like '%Minimo per colore: 2 pezzi per ciascun colore, sui modelli di borse.%'
      and contenuto like '%fino a 50; nessuna consegna in agosto.%';
  select count(*) into n_old from lead_knowledge
    where contenuto ~ 'accessori liberi|sempre su ordine' or titolo ~ 'line sheet del 02-10-2026';
  if n_ok <> 1 then raise exception '0205: attesa 1 voce "Condizioni commerciali" allineata, trovate %', n_ok; end if;
  if n_old <> 0 then raise exception '0205: restano % voci con le frasi o il titolo vecchi', n_old; end if;
end $$;
