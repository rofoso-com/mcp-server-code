---
name: polopan-fashion
description: >-
  Search PoloPan fashion catalog, discover apparel and accessories by text or image, find budget alternatives, and generate full outfit recommendations with verified s.polopan.com purchase links.
---

# PoloPan Fashion & Products Skill

This skill guides AI assistants on how to effectively query the **PoloPan Products MCP Server** to find fashion products, suggest budget alternatives, search visually by image, and recommend styled outfits.

---

## 🛠 Available MCP Tools

| Tool | Purpose | Key Arguments |
| :--- | :--- | :--- |
| `search_products_text` | Search products via natural language keywords & filters | `query`, `gender`, `price_min`, `price_max`, `size`, `vendor`, `sort_by`, `sort_order`, `page`, `page_size` |
| `search_products_image` | Find visually similar items using an image URL | `image_url`, `gender`, `category`, `style`, `color`, `price_min`, `price_max` |
| `search_products_image_upload` | Find items by uploading a local image file / base64 | `image_path` or `image_base64`, plus search filters |
| `get_product_by_handle` | Retrieve full product metadata & inventory by handle | `handle` (e.g. `ajio_700504784_green`) |
| `search_alternatives_in_budget` | Find visually similar alternatives in a target price bracket | `handle`, `budget_range` (`0-1500`, `1501-3000`, `3001-5000`, `5000+`), `limit` |
| `get_recommended_outfits` | Get curated matching outfits for a product | `handle`, `page`, `page_size` |

---

## 🎯 Best Practices for Agents

### 1. Handling Queries & Filters
* **Gender Normalization**: Use `"male"` for men / boys, `"female"` for women / girls (the server automatically normalizes `"men"` and `"women"`).
* **Price Filtering**: Always pass numerical values for `price_min` and `price_max` (e.g. `price_max: 500` when the user asks for "under 500").
* **Sorting**: Default is `relevance`. Use `sort_by: "price"` with `sort_order: "asc"` when the user specifically asks for the cheapest options.

### 2. Presenting Product Results
When showing product recommendations to the user, format them in a clean Markdown table with:
* **Product Title & Image Link**
* **Brand / Vendor**
* **Selling Price** and **Original MRP** (with discount % if applicable)
* **Available Sizes** (filter variants where `inventory_quantity > 0`)
* **Purchase Link**: Always use the returned `url` field (`https://s.polopan.com/p/{handle}`).

### 3. Outfits & Budget Alternatives Workflow
* **Alternative Discovery**: When a user likes a product but finds it expensive, call `search_alternatives_in_budget` with the product's `handle` and a lower `budget_range`.
* **Complete Looks**: When a user asks "how should I style this?" or "give me an outfit", call `get_recommended_outfits` with the item's `handle` to retrieve complementary pieces (tops, bottoms, footwear, accessories).

---

## ⚙️ MCP Server Configuration

### Hosted HTTP (Cursor / Claude Desktop / Remote Agents)
```json
{
  "mcpServers": {
    "polopan-products": {
      "type": "http",
      "url": "https://mcp-server.polopan.com/mcp"
    }
  }
}
```

### Stdio / Local CLI (Node.js 18+)
```bash
npx -y polopan-products-mcp
```
