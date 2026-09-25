# PoloPan MCP Server — Dual-Track Deployment Guide

This guide documents the end-to-end deployment procedures for the **PoloPan MCP** ecosystem across the **Backend Production Infrastructure** (`/Users/shekharchatterjee/polopan/api`), the **Non-Public Engine & NPM Package** (`/Users/shekharchatterjee/polopan/mcp`), and the **Public Open Distribution & Docs** (`rofoso-com/mcp`).

---

## 🏗 System Architecture & Repository Structure

The PoloPan MCP ecosystem spans across backend microservices, client SDKs, package distribution, and public developer documentation:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. BACKEND HOSTED INFRASTRUCTURE (Repository: polopan/api)                             │
│    Location: ~/apiv2/cloudrun/mcp_products_service (Node/Express Streamable HTTP)       │
│    • Systemd Unit: polopan-mcp-products.service (Port 8008)                           │
│    • Ingress / Nginx: https://mcp-server.polopan.com -> http://127.0.0.1:8008          │
│    • Upstream Core: apiv2.polopan.com (Port 8000) & fashion-detect.polopan.com (8003) │
│    • Assistant Unit: polopan-mcp-assistant.service (Port 8012 / chat.polopan.com)     │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. NON-PUBLIC CORE ENGINE & NPM PACKAGE (Repository: rofoso-com/mcp-server-code)       │
│    Location: /Users/shekharchatterjee/polopan/mcp                                      │
│    • Local Server Engine (src/index.js, src/product_purchase_links.js)                 │
│    • E2E Integration & Smoke Tests (scripts/e2e-mcp-test.js)                           │
│    • NPM Package Release Target: npm i -g / npx -y polopan-products-mcp                │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │
                                         ▼ [Sync Docs & Skill Files]
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. PUBLIC OPEN DISTRIBUTION & DOCS (Repository: rofoso-com/mcp)                        │
│    Location: /Users/shekharchatterjee/polopan/mcp/public                                │
│    • Client Setup Guides (Cursor, Claude Desktop, Antigravity, VS Code / Cline)        │
│    • Public SKILL.md & Agent Prompt Library                                            │
│    • 1-Click Cursor Deeplink (https://polopan.com/mcp/cursor)                          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

| Component | Path / Repository | Purpose | Host / Target |
| :--- | :--- | :--- | :--- |
| **Backend MCP Service** | `/Users/shekharchatterjee/polopan/api`<br>`cloudrun/mcp_products_service` | Streamable HTTP Gateway, rate limiting & upstream proxy | Azure VM `polopan-api` (Port 8008)<br>`https://mcp-server.polopan.com` |
| **Assistant Chat Service** | `/Users/shekharchatterjee/polopan/api`<br>`cloudrun/chat_service` | In-app LLM assistant with MCP tools | Azure VM `polopan-api` (Port 8012)<br>`https://chat.polopan.com` |
| **Non-Public Engine** | `/Users/shekharchatterjee/polopan/mcp`<br>`rofoso-com/mcp-server-code` | Standalone stdio engine, automated test suites & package build | NPM Registry: `polopan-products-mcp` |
| **Public Docs & Skill** | `/Users/shekharchatterjee/polopan/mcp/public`<br>`rofoso-com/mcp` | Public documentation, setup instructions, skills, deeplinks | GitHub Public, Cursor directory |

---

## ⚡ Track 1: Backend Production Service Deployment (`polopan/api`)

The hosted MCP server is located at `cloudrun/mcp_products_service` in the `polopan/api` codebase. It runs as a systemd service (`polopan-mcp-products.service`) on the Azure `polopan-api` VM.

### 1. Architecture & Port Map

* **Systemd Unit**: `polopan-mcp-products.service`
* **Internal Localhost Port**: `8008`
* **Nginx Reverse Proxy**: `https://mcp-server.polopan.com` (configured in `scripts/deploy_services/nginx/subdomains.polopan.com.conf`)
* **Transport**: Stateless MCP over Streamable HTTP (`@modelcontextprotocol/sdk/server/streamableHttp.js`)
* **Endpoints**:
  * `GET /health` → `200 "ok"`
  * `POST /mcp` → Streamable HTTP JSON-RPC MCP gateway
  * `POST /chat` → Optional conversational endpoint
* **VM Details**:
  * **Azure VM**: `polopan-api` (IP: `4.240.94.35`, Resource Group: `POLOPAN`)
  * **User & Home**: `vedansh` / `/home/vedansh/apiv2`

---

### 2. Method A: Automated Deployment from Laptop (Recommended)

Run the Python deployment CLI from the `/Users/shekharchatterjee/polopan/api` repository:

```bash
cd /Users/shekharchatterjee/polopan/api

# 1. Commit and push your latest backend code
git add .
git commit -m "feat(mcp): update mcp products backend service"
git push origin main

# 2. Deploy only the MCP Products service to Azure VM
python3 scripts/deploy_services/deploy_apiv2_vm.py --mcp-products

# 3. (Optional) Deploy both MCP Products and MCP Assistant
python3 scripts/deploy_services/deploy_apiv2_vm.py --mcp-products --mcp-assistant
```

#### Using the Interactive Deployment Runner
You can also launch the interactive deployment menu:

```bash
cd /Users/shekharchatterjee/polopan/api
bash scripts/deploy_services/run.sh
# Select:
#   [15] mcp-products   (Deploy mcp-products Azure VM)
#   [16] mcp-assistant  (Deploy mcp-assistant Azure VM)
```

---

### 3. Method B: Direct Deployment on Azure VM via SSH

If you need to deploy directly on the VM or inspect service behavior:

```bash
# Connect to the Azure VM
az ssh vm -g POLOPAN -n polopan-api
# Alternatively: ssh vedansh@4.240.94.35

# 1. Pull latest code in apiv2
cd ~/apiv2
git pull

# 2. Install production dependencies if package.json changed
cd ~/apiv2/cloudrun/mcp_products_service
npm ci --omit=dev

# 3. Reload systemd and restart the service
sudo systemctl restart polopan-mcp-products

# 4. Verify local port 8008 is healthy
curl -sS http://127.0.0.1:8008/health
```

---

### 4. Backend Health Checks, Logs & Diagnostics

```bash
# Check service status
sudo systemctl status polopan-mcp-products

# Stream live systemd logs
sudo journalctl -u polopan-mcp-products -f --no-pager

# Check public endpoint health over HTTPS
curl -i https://mcp-server.polopan.com/health

# Test public MCP endpoint with a JSON-RPC ping
curl -sS -X POST https://mcp-server.polopan.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":1}'
```

---

### 5. Backend Environment Variables & Security

The service loads environment configuration from `~/apiv2/.env` and the MongoDB `platform_settings` collection:

| Variable | Setting / Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8008` (via systemd unit) | Port on which the Express HTTP server listens |
| `POLOPAN_API_BASE_URL` | `http://127.0.0.1:8000` (or `https://apiv2.polopan.com`) | Upstream main catalog and search API |
| `POLOPAN_FASHION_DETECT_BASE_URL` | `http://127.0.0.1:8003` (or `https://fashion-detect.polopan.com`) | Visual garment detection service |
| `POLOPAN_MCP_SECRET_KEY` | Managed in MongoDB / `.env` | Secret token verified by upstream middleware on `/products`, `/upload/image`, `/looks` |
| `POLOPAN_MCP_USER_AGENT` | `PoloPan-MCP` | Custom header for audit trails and authorization |
| `MCP_TRANSPORT_RATE_MAX` | `90` | Maximum transport requests per minute per IP |
| `MCP_TRANSPORT_RATE_WINDOW_MS`| `60000` | Rate limiting rolling window (1 minute) |

---

## 🔒 Track 2: Non-Public Core Engine & NPM Package (`polopan/mcp`)

The non-public standalone repository (`/Users/shekharchatterjee/polopan/mcp`) maintains the core MCP tools engine, unit & E2E integration tests, and the NPM packaging pipeline for `polopan-products-mcp`.

### 1. Pre-Deployment Validation & Tests

Run all checks from the `/Users/shekharchatterjee/polopan/mcp` root before publishing:

```bash
cd /Users/shekharchatterjee/polopan/mcp

# 1. Syntax and import verification
npm run check

# 2. End-to-end live API verification
npm test
```

> [!IMPORTANT]
> The automated test suite (`scripts/e2e-mcp-test.js`) verifies all 9 MCP tools, live SKU stock checking, QuickView table generation, and 1-click checkout URLs (`https://s.polopan.com/p/{handle}/{size_index}`). Ensure **all tests pass** before releasing.

---

### 2. NPM Package Release (`polopan-products-mcp`)

The local execution method (`npx -y polopan-products-mcp`) is distributed through the public npm registry.

#### Step 2.1 — Version Bump
```bash
# Bump version in package.json
npm version patch   # For bug fixes
# or: npm version minor
# or: npm version major
```

#### Step 2.2 — Dry Run Package Inspection
```bash
# Verify included bundle files (src/, README.md, LICENSE, SKILL.md)
npm pack --dry-run
```

#### Step 2.3 — Publish to NPM
```bash
npm publish --access public
```

#### Step 2.4 — Commit & Push Non-Public Repo
```bash
git add .
git commit -m "chore(release): v$(node -p "require('./package.json').version")"
git push origin main
```

---

## 🌐 Track 3: Public Open Distribution & Docs (`rofoso-com/mcp`)

The public repository (`rofoso-com/mcp`) provides the public-facing documentation, prompt catalog, and installation links for external developers and AI assistants.

### 1. Synchronize Public Repository Files

From `/Users/shekharchatterjee/polopan/mcp`, copy the updated documentation and skill assets into the `public/` directory:

```bash
cd /Users/shekharchatterjee/polopan/mcp

# Copy release files to public folder
cp README.md public/README.md
cp SKILL.md public/SKILL.md
cp LICENSE public/LICENSE
```

---

### 2. Commit & Push to Public Git Remote

```bash
cd /Users/shekharchatterjee/polopan/mcp/public

# Stage and review changes
git status
git add README.md SKILL.md LICENSE

# Commit release sync
git commit -m "docs: release sync v$(node -p "require('../package.json').version")"

# Push to public GitHub repository
git push origin main
```

---

### 3. Verify Client Connection Options

Confirm that the connection methods documented in `public/README.md` are operational:

#### Option 1: Hosted Remote Connection (Recommended — Zero Install)
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

#### Option 2: Local Node stdio (npx)
```json
{
  "mcpServers": {
    "polopan-products": {
      "command": "npx",
      "args": ["-y", "polopan-products-mcp"]
    }
  }
}
```

#### Option 3: Cursor 1-Click Deeplink
* Test the deeplink URL: `https://polopan.com/mcp/cursor`
* Verify installation badge: `https://cursor.com/deeplink/mcp-install-dark.svg`

---

## 📋 Complete Release Workflow Checklist

Use this checklist during a full product release across all three tracks:

```markdown
### Phase 1: Backend Deployment (polopan/api)
- [ ] 1. Test changes in `cloudrun/mcp_products_service`
- [ ] 2. Push backend changes to GitHub (`polopan/api`)
- [ ] 3. Run VM deploy: `python3 scripts/deploy_services/deploy_apiv2_vm.py --mcp-products`
- [ ] 4. Verify backend health: `curl -sS https://mcp-server.polopan.com/health`

### Phase 2: Engine & NPM Package Release (polopan/mcp)
- [ ] 5. Run test suite: `npm run check && npm test`
- [ ] 6. Bump version: `npm version <patch|minor|major>`
- [ ] 7. Publish to NPM: `npm publish --access public`
- [ ] 8. Commit and push non-public repo: `git push origin main`

### Phase 3: Public Documentation Sync (rofoso-com/mcp)
- [ ] 9. Sync files: `cp README.md SKILL.md LICENSE public/`
- [ ] 10. Commit & push public repo: `cd public && git add . && git commit -m "..." && git push origin main`
- [ ] 11. Verify Cursor Deeplink and remote MCP connectivity
```

---

## 🔄 Emergency Rollback Procedures

### 1. Rollback Backend Service (`polopan/api`)
```bash
# On Azure VM:
cd ~/apiv2
git checkout HEAD~1 -- cloudrun/mcp_products_service
sudo systemctl restart polopan-mcp-products
```

### 2. Rollback NPM Package
```bash
# Deprecate faulty version immediately
npm deprecate polopan-products-mcp@<broken_version> "Critical fix: please upgrade to latest"

# Republish previous stable release under new patch version
npm version patch
npm publish --access public
```

### 3. Rollback Public Documentation
```bash
cd /Users/shekharchatterjee/polopan/mcp/public
git revert HEAD --no-edit
git push origin main
```
