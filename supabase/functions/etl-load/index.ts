// RETIRED. This was a one-off, secret-gated, service-role bulk loader used for the 2026-07-01
// re-seed (so we never re-opened public anon write). It is now a disabled stub that never writes.
// Kept only so the deployed function has a harmless source; safe to delete the function entirely.
Deno.serve(() => new Response(JSON.stringify({ error: 'etl-load retired' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
