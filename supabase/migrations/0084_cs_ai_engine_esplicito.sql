-- 0084: il motore AI del tool Assistenza diventa ESPLICITO (brief cs_ai_model_allineamento, 31-07).
--
-- Problema: `cs_ai_model` valeva 'claude-sonnet-5' mentre le bozze le scrive Gemini. Il campo era
-- inerte (senza `anthropic_api_key` cs-assist usa Gemini) ma fuorviante: chi legge app_flags credeva
-- che il tool girasse su Claude. E soprattutto il motore si deduceva dalla PRESENZA della chiave,
-- quindi rimettere la chiave un domani avrebbe fatto ripartire Claude in silenzio, senza che
-- nessuno l'avesse deciso.
--
-- Perche' NON si e' semplicemente scritto il modello Gemini dentro `cs_ai_model` (opzione (a) del
-- brief): quel valore viene passato COME NOME MODELLO all'API Anthropic (`claude(effModel, ...)`).
-- Metterci 'gemini-flash-latest' avrebbe creato una bomba a orologeria: al ritorno della chiave
-- Anthropic ogni bozza sarebbe morta con un errore di modello inesistente.
--
-- Scelta: (1) il flag torna a dire la verita' sul proprio contenuto, `cs_ai_model_claude` = nome del
-- modello usato SOLO quando il motore e' Claude; (2) nuovo flag `cs_ai_engine` ('gemini' | 'claude')
-- che e' l'UNICO selettore del motore. Default 'gemini' = comportamento di oggi, invariato.
-- Riaccendere Claude diventa un gesto deliberato in due passi (rimettere la chiave E cambiare il
-- flag), mai un effetto collaterale.
--
-- Rollback: update app_flags set key='cs_ai_model' where key='cs_ai_model_claude';
--           delete from app_flags where key='cs_ai_engine';
--           (piu' redeploy di cs-assist v14 e cs-api della versione precedente)

update public.app_flags set key = 'cs_ai_model_claude' where key = 'cs_ai_model';

insert into public.app_flags (key, value)
values ('cs_ai_engine', 'gemini')
on conflict (key) do nothing;
