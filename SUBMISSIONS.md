# 🚀 PoloPan MCP: Global Directory & Registry Submission Kit

Use this guide and the pre-formatted snippets below to submit PoloPan to all major MCP registries and indexers in under 15 minutes.

---

## 1. GitHub PR: `punkpeye/awesome-mcp-servers`
* **Target Repo:** [https://github.com/punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)
* **File to Edit in PR:** `README.md`
* **Section:** Under `### 🛍️ E-Commerce & Retail` or `### 🛍️ Shopping` (or create this subsection if not present):

```markdown
- [PoloPan Fashion MCP](https://github.com/rofoso-com/mcp) - The premier fashion & apparel Model Context Protocol server. Deconstructs outfit photos into bounding boxes, discovers 100% in-stock occasion looks, checks live variant stock, and generates 1-click checkout permalinks.
```

---

## 2. Glama.ai MCP Directory Submission
* **Target URL:** [https://glama.ai/mcp/servers](https://glama.ai/mcp/servers) -> Click **"Submit a Server"**
* **Form Inputs:**
  * **Server Name:** `PoloPan Fashion MCP Server`
  * **Repository URL:** `https://github.com/rofoso-com/mcp`
  * **NPM Package:** `polopan-products-mcp`
  * **Hosted Streamable HTTP URL:** `https://mcp-server.polopan.com/mcp`
  * **Tags:** `Fashion`, `E-Commerce`, `Computer Vision`, `Outfit Detection`, `Retail`, `Shopping`
  * **Short Description:**
    > The premier Model Context Protocol server for fashion discovery, AI bounding box outfit deconstruction, 100% in-stock occasion styling, and 1-click direct checkout.

---

## 3. Smithery.ai Registry Indexing
* **Target URL:** [https://smithery.ai](https://smithery.ai)
* **CLI Command (Run from terminal):**
  ```bash
  cd /Users/shekharchatterjee/polopan/mcp
  npx -y @smithery/cli publish
  ```
* **Or Submit Web Link:** [https://smithery.ai/submit](https://smithery.ai/submit) -> Enter `https://github.com/rofoso-com/mcp`

---

## 4. PulseMCP.com & Mcp.so
* **Target URLs:**
  * [https://pulsemcp.com](https://pulsemcp.com) -> "Submit Server"
  * [https://mcp.so](https://mcp.so) -> "Add Server"
* **Form Content:**
  * **Name:** `PoloPan Fashion & Styling MCP`
  * **Author:** PoloPan (`https://polopan.com`)
  * **Transport:** Stdio (`npx -y polopan-products-mcp`) & HTTP (`https://mcp-server.polopan.com/mcp`)
  * **Summary:** Autonomous fashion intelligence for AI agents: computer-vision outfit deconstruction, occasion-based look generation, live size availability, and instant 1-click purchase links.

---

## 5. Domain Manifest Verification
Ensure `https://polopan.com/.well-known/mcp.json` is live and accessible.
Test via:
```bash
curl -I https://polopan.com/.well-known/mcp.json
```
