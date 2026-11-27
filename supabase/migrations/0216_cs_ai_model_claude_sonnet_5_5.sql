-- 0216: modello Claude delle bozze di Assistenza = claude-sonnet-5-5 (27-11, decisione di Dan in chat).
--
-- Da cs-assist v36 la chiave Anthropic e' il segreto delle Edge Functions ANTHROPIC_API_KEY (lo stesso
-- della chat del sito e dell'assistente), quindi al deploy le bozze tornano su Claude. Il nome del
-- modello lo da' `cs_ai_model_claude`, fermo dal 29-07 a 'claude-sonnet-5': si allinea al modello che
-- la chat del sito usa gia' sulla stessa chiave. Si tocca solo il valore vecchio: un modello scelto
-- dopo a mano resta com'e'.
--
-- Rollback: update app_flags set value='claude-sonnet-5' where key='cs_ai_model_claude';

update public.app_flags set value = 'claude-sonnet-5-5'
where key = 'cs_ai_model_claude' and value = 'claude-sonnet-5';
