-- 0056: restringe la lettura delle cs_* ai soli utenti con email @amimi.it.
-- NOTA due-sessioni: applicata in DB come migration name `0055_cs_rls_amimi_domain` (version
-- 20260721171131); il numero 0055 era stato preso in parallelo da `0055_alias_annie_brown_..._orphan_1482`,
-- quindi il FILE e' rinumerato 0056 per la sequenza del repo (la version DB resta 0055_cs_rls_amimi_domain).
-- Segue la Fase 1 (migr 0053/0054, sessione parallela): questa e' una guardia di sicurezza aggiuntiva.
-- Prima la policy era `to authenticated using (true)` = QUALSIASI utente autenticato. Con signup OFF +
-- soli 2 utenti @amimi.it e' gia' sicuro OGGI, ma questa guardia lo rende robusto a prescindere dal
-- metodo di login: se un domani si attiva "Accedi con Google" (amimi.it e' Google Workspace), un
-- account Google qualsiasi che autenticasse NON potrebbe comunque leggere la posta clienti.
-- Difesa in profondita': il vero cancello resta signup OFF + provider controllati; questa e' la rete.
-- I 2 utenti attuali (info@ / support@) soddisfano il vincolo, nessuna regressione.

drop policy if exists cs_conv_sel on cs_conversations;
drop policy if exists cs_msg_sel  on cs_messages;
drop policy if exists cs_evt_sel  on cs_events;
drop policy if exists cs_drf_sel  on cs_drafts;
drop policy if exists cs_faq_sel  on cs_faq;

create policy cs_conv_sel on cs_conversations for select to authenticated using ((auth.jwt() ->> 'email') ilike '%@amimi.it');
create policy cs_msg_sel  on cs_messages      for select to authenticated using ((auth.jwt() ->> 'email') ilike '%@amimi.it');
create policy cs_evt_sel  on cs_events        for select to authenticated using ((auth.jwt() ->> 'email') ilike '%@amimi.it');
create policy cs_drf_sel  on cs_drafts        for select to authenticated using ((auth.jwt() ->> 'email') ilike '%@amimi.it');
create policy cs_faq_sel  on cs_faq           for select to authenticated using ((auth.jwt() ->> 'email') ilike '%@amimi.it');
