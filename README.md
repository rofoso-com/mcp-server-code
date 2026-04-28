# PoloPan Products MCP Server

Local production-ready MCP server for PoloPan product search.

This server wraps:
- `GET /products` for text and image search
- `GET /products/handle/{handle}` for details
- `POST /looks` for recommended outfits

## Features

- Text product search (`search_products_text`)
- Image URL product search (`search_products_image`)
- Image upload + search (`search_products_image_upload`)
- Product details by handle (`get_product_by_handle`)
- Alternatives in budget (`search_alternatives_in_budget`)
- Recommended outfits (`get_recommended_outfits`)
- Input validation with `zod`
- Timeout and robust HTTP error messages
- Local-only runtime over `stdio` (no cloud required)

## Requirements

- Node.js 18+
- Network access to `https://apiv2.polopan.com`

## Install

```bash
npm install
```

## Run

```bash
npm start
```

## Configuration

All API config is now hardcoded in `src/index.js`.

## Cursor MCP Configuration

Add this server in your MCP config:

```json
{
  "mcpServers": {
    "polopan-products": {
      "command": "node",
      "args": ["/Users/shekharchatterjee/polopan/mcp/src/index.js"]
    }
  }
}
```

## Tool Contracts

### `search_products_text`
- Required: `query`
- Optional: `page`, `page_size`, `sort_by`, `sort_order`, `gender`, `occasion`, `size[]`, `price_min`, `price_max`, `vendor[]`, `personalize`

### `search_products_image`
- Required: `image_url`
- Optional: same filters as text search

### `search_products_image_upload`
- Required: one of `image_path` or `image_base64`
- Optional:
  - `content_type` (default inferred/`image/jpeg`)
  - `expiry_hours` (default `24`)
  - same search filters as `search_products_image`

### `get_product_by_handle`
- Required: `handle`

### `search_alternatives_in_budget`
- Required: `handle`
- Optional:
  - `budget_range`: `0-1500` | `1501-3000` | `3001-5000` | `5000+` (default `1501-3000`)
  - `page` (default `1`)
  - `page_size` (default `8`)
  - `limit` (default `6`, final number returned after filtering current product)
  - `sort_by`, `sort_order`, `personalize`

### `get_recommended_outfits`
- Required: `handle`
- Optional: `page` (default `1`), `page_size` (default `20`)

