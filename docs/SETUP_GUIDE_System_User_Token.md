# Setup token Meta per l'ingest Amimì Ads (System User)

> Scopo: generare un token Meta **long-lived in sola lettura** che l'edge di ingest usa per leggere insights, campagne, ads, creative e catalogo dell'account `act_686034712784477`, e metterlo nei secret di Supabase.
>
> **Chi fa cosa:** i passaggi in Meta e in Supabase li fai TU (owner). Io non maneggio credenziali, non devo mai vedere il token e non va incollato in chat, nel client o nel repo. Recreato il 2026-09-18 perche' l'originale citato dal vecchio Apps Script non e' nel repo.

## Perche' un "System User" e non un token personale

Un token personale e' legato al tuo account e scade / si rompe se cambi password o permessi. Un **System User** e' un utente di servizio del Business: il suo token puo' essere long-lived e non dipende da una persona. E' il modo giusto per un ingest automatico.

## Prerequisiti

- Accesso **admin** al Business Manager di Amimì.
- Nel Business devono esserci gia': l'ad account `act_686034712784477` ("Amì - Leads Ads") e il catalogo `916048904718661` ("catalogo Amimi Shopify"). Ci sono, li ho visti dall'API.
- Un'**app Meta** dentro il Business (serve per generare il token). Se non ce n'e' una, se ne crea una di tipo Business in developers.facebook.com.

## Passi in Meta (business.facebook.com/settings)

1. **Impostazioni del Business → Utenti → Utenti di sistema → Aggiungi.** Nome es. `amimi-ads-ingest`, ruolo Employee (basta per la lettura) o Admin.
2. **Assegna gli asset** all'utente di sistema (bottone "Assegna asset"):
   - **Account pubblicitari** → `act_686034712784477` → almeno "Visualizza performance" (per gli insights). "Gestisci campagne" non serve, e' sola lettura.
   - **Cataloghi** → "catalogo Amimi Shopify" → accesso in visualizzazione (serve per leggere i product_set e i prodotti).
3. **Genera token**: "Genera nuovo token" → scegli l'app Meta → scope **`ads_read`** (obbligatorio: insights, campagne, ads, creative). Per il catalogo di norma basta `ads_read` + l'assegnazione dell'asset; se la lettura dei product_set dovesse chiedere di piu', aggiungi **`catalog_management`** (in lettura). Scadenza: **Mai**.
4. **Copia il token** (Meta te lo mostra una volta sola). Mettilo in un password manager.

> I label esatti dell'UI Meta cambiano ogni tanto. Se una voce non si chiama esattamente cosi', e' comunque nella sezione "Utenti di sistema" delle impostazioni Business.

## Passi in Supabase (dove l'edge legge il token)

Progetto `imszbjeyplaiovylhkgl`. Il token va in **`app_config`**, come gia' si fa per `shopify_token` (store server-side, solo service-role). Io aggiungo con una migrazione la colonna `app_config.meta_token`; **il valore lo metti tu** dalla dashboard Supabase:

1. Dashboard Supabase → **Table editor** → tabella `app_config` → riga `id = 1`.
2. Metti il token nella colonna **`meta_token`** e salva.

In alternativa, dal **SQL editor**: `update app_config set meta_token = '<IL_TUO_TOKEN>' where id = 1;` (metti il tuo token al posto del placeholder). Il valore lo scrivi tu, io non lo vedo. Se `meta_token` e' vuoto, l'edge non pulla e lo dichiara in `health_log`, senza rompere niente.

## Verifica (dopo che il token c'e')

Quando il token e' a posto, l'edge di ingest (nome provvisorio `ads-sync`) fara' un healthCheck: chiama l'account, conferma nome e valuta, e scrive l'esito in `health_log`. Te lo mostro io dopo il primo deploy.

## Alternativa: recuperare il vecchio token invece di generarne uno

Il vecchio token e' nelle Script Properties del progetto Apps Script Amimì (`META_ACCESS_TOKEN`). Si potrebbe leggere con una funzione che fa `Logger.log(PropertiesService.getScriptProperties().getProperty('META_ACCESS_TOKEN'))`. **Sconsigliato**: non conosciamo i suoi scope e potrebbe essere legato a un utente personale. Meglio generarne uno nuovo di sistema.

## Sicurezza

Il token da' accesso in lettura ai dati ads. Tienilo solo nei secret Supabase e nel password manager. Se trapela: revocalo dall'app Meta e rigeneralo. Mai nel client (il bundle del sito e' pubblico), mai nel repo, mai in chat.
