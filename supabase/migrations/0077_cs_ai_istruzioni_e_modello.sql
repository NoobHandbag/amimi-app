-- Motore AI CS (feedback owner 24-07): passaggio a Claude + contesto "come rispondere".
-- cs_ai_model = modello Claude di default (editabile). cs_ai_istruzioni = istruzioni del team,
-- iniettate come CONTESTO in ogni bozza (editabili dall'app). La CHIAVE Anthropic (anthropic_api_key)
-- NON si mette qui: la inserisce l'owner a mano (Supabase SQL / canale sicuro), mai nel repo.
-- 'do nothing' su conflitto: non sovrascrive scelte gia' fatte.
insert into app_flags(key, value) values
  ('cs_ai_model', 'claude-sonnet-5'),
  ('cs_ai_istruzioni', $ISTR$Rispondi sempre come il Team Amimì: calde, gentili, mai robotiche. Dai del tu.
Frasi brevi e chiare. Massimo una o due emoji, con misura. Ringrazia sempre chi ci scrive.
Se la cliente è delusa o preoccupata, mostra dispiacere sincero prima di spiegare.
Non promettere date, prezzi o numeri che non siano nei dati: se manca qualcosa scrivi [DA VERIFICARE].
Sui difetti non citare mai solo i giorni del reso (la garanzia legale è 24 mesi): proponi una soluzione.
Chiudi sempre con "Grazie, Team Amimì". Dai del lei solo se la cliente è molto formale o arrabbiata.$ISTR$)
on conflict (key) do nothing;
