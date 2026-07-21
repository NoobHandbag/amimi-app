import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Client DEDICATO alla sezione Assistenza clienti. Porta la sessione dell'utente LOGGATO
// (Supabase Auth, email @amimi.it): cosi' le letture cs_* vanno a PostgREST col JWT utente ->
// ruolo `authenticated` -> RLS. Tenuto SEPARATO dal client anon principale (lib/supabase.ts,
// persistSession:false): fare login qui non cambia MAI come il resto dell'app no-login legge i dati.
// storageKey distinto per non collidere con l'eventuale storage del client principale.
export const csClient = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'amimi-cs-auth' },
});
