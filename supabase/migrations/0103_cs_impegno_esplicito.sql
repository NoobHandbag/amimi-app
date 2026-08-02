-- 0103 — cs_impegno_esplicito: l'impegno gia' preso entra nel prompt CITATO ALLA LETTERA (v27)
--
-- Perche' esiste. La v26 aveva messo in coda a `casoBlock` una regola astratta ("se in una riga Noi:
-- abbiamo gia' promesso qualcosa, confermalo"). La rimisura cieca del 02-08 dice che sui casi facili
-- funziona, ma sul piu' duro no: su `741c7f0e`, dove il team aveva scritto "il rimborso verra'
-- effettuato una volta che il pacco sara' rientrato", **8 generazioni su 8** hanno prodotto una sola
-- alternativa e tutte e otto hanno negato il reso citando i 14 giorni. Il verdetto secco del caso e'
-- concreto e pieno di numeri, la regola era una condizionale astratta, e ha perso.
--
-- Cosa fa il flag. Solo dove il cancello di pertinenza e' gia' scattato (poche conversazioni), una
-- chiamata piccola e dedicata (flash-lite, un compito solo, vede SOLO i messaggi `out`) estrae la
-- frase con cui il team si e' impegnato, e il prompt la riceve VIRGOLETTATA alla lettera.
--
-- La guardia che rende sicura la cosa non e' il modello, e' il codice: `citazioneVerificata`
-- controlla che la frase esista davvero, normalizzata, dentro un messaggio `out`, e la scarta se non
-- la trova. Una citazione inventata non puo' arrivare alla bozza.
--
-- Nasce a `true` per la stessa ragione della 0102: sta correggendo un difetto gia' misurato, e la
-- rimisura si fa subito dopo. Rollback senza deploy:
--   update app_flags set value = 'false' where key = 'cs_impegno_esplicito';
-- Spegnendolo si torna esattamente al comportamento v26 (la coda di pertinenza resta).
--
-- Additiva: nessuna tabella core toccata, nessuna riga di dati.

insert into public.app_flags (key, value)
values ('cs_impegno_esplicito', 'true')
on conflict (key) do nothing;
