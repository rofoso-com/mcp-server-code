# PoloPan Products MCP

PoloPan product search and outfits as a **Model Context Protocol** server — public, no PoloPan account required.

Traffic flow:

```text
MCP client (Cursor, Claude, …) → https://mcp-server.polopan.com/mcp → apiv2.polopan.com
```

Browsers cannot call `apiv2` catalog APIs directly (domain / CORS / secret). Only the hosted MCP service holds the upstream secret.

---

## Hosted MCP (recommended)

**Endpoint:** `https://mcp-server.polopan.com/mcp`

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "polopan-products": {
      "type": "http",
      "url": "https://mcp-server.polopan.com/mcp",
      "headers": {}
    }
  }
}
```

Reload MCP in Cursor after saving.

### Rate limits (per IP, no login)

| Tier | Tools | Default |
|------|--------|---------|
| **Search** | `search_products_text`, `search_products_image` | 30 / min, 180 / hour |
| **Catalog** | `get_product_by_handle`, `search_alternatives_in_budget`, `get_recommended_outfits` | 45 / min, 300 / hour |
| **Upload** | `search_products_image_upload` | **2 / min, 10 / hour** |
| **Transport** | All `/mcp` JSON-RPC | 90 / min burst cap |

When limited, clients receive HTTP **429** with `Retry-After`.

---

## npm package (local stdio)

Published as [`polopan-products-mcp`](https://www.npmjs.com/package/polopan-products-mcp).

**For end users:** use the **hosted URL** above. The npm stdio binary is for local development only and does **not** ship API secrets.

```bash
npx -y polopan-products-mcp
```

Maintainers running stdio against apiv2 must set (never commit):

```bash
export POLOPAN_API_BASE_URL=https://apiv2.polopan.com
export POLOPAN_MCP_SECRET_KEY='<same value as server POLOPAN_MCP_SECRET_KEY>'
export POLOPAN_MCP_USER_AGENT=PoloPan-MCP-Public
```

---

## Requirements

- Node.js 18+
- Network access to `https://mcp-server.polopan.com` (hosted) or apiv2 (stdio dev only)

---

## Tools

- `search_products_text` — text search  
- `search_products_image` — search by image URL  
- `search_products_image_upload` — upload image then search (strict rate limit)  
- `get_product_by_handle` — product by handle  
- `search_alternatives_in_budget` — similar items in a budget band  
- `get_recommended_outfits` — outfit recommendations  

---

## Server implementation

Production HTTP MCP lives in the PoloPan API monorepo:

`api/cloudrun/mcp_products_service/`

Deploy notes: set `POLOPAN_MCP_SECRET_KEY` in Cloud Run / VM `.env` and Mongo `platform_settings` (`key: POLOPAN_MCP_SECRET_KEY`).
