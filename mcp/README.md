# Amimì App — server MCP

Server MCP (Model Context Protocol) che espone l'app al tuo Claude: leggere il business e agire.
È una **edge function** Supabase (`supabase/functions/mcp`), sempre attiva, **nessun PC**. Additivo:
non tocca i flussi dell'app, il Foglio o Cowork.

- **URL:** `https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/mcp`
- **Auth:** header `Authorization: Bearer <MCP_TOKEN>` — il token vive in `app_flags.mcp_token`
  (server-only, NON nel repo). Ruotabile con una UPDATE su quella riga.
- **Trasporto:** HTTP / JSON-RPC 2.0 (Streamable HTTP).

## Tool disponibili
Lettura: `list_inventory`, `what_to_reorder`, `sku_availability`, `pnl_summary`, `ads_summary`,
`ask_data` (domanda in linguaggio naturale → SQL). Scrittura (via write-api, loggate): `propose_expense`
(va in approvazione), `register_count`.

## Come connetterlo

### Claude Code (subito)
```bash
claude mcp add --transport http amimi \
  https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

### Claude Desktop (subito, via mcp-remote)
In `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "amimi": {
      "command": "npx",
      "args": ["-y", "mcp-remote",
        "https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/mcp",
        "--header", "Authorization: Bearer <MCP_TOKEN>"]
    }
  }
}
```

### claude.ai (web Chat) — richiede un passaggio in più
I "custom connectors" del web fanno un flusso **OAuth**, non accettano un token statico. Per usarlo dal
web serve aggiungere un wrapper OAuth davanti a questa function (TODO separato). Da Code/Desktop funziona
già adesso col token.

## Sicurezza
Token bearer obbligatorio (no token → Unauthorized). Le letture usano il service-role lato server; le
scritture passano dal write-api (stessa validazione + change_log). Posture rilassata, dati a basso
valore. Per chiudere: ruota `mcp_token`.
