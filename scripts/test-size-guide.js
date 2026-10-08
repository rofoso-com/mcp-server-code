import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["/Users/shekharchatterjee/polopan/mcp/src/index.js"],
    env: {
      ...process.env,
      POLOPAN_API_BASE_URL: process.env.POLOPAN_API_BASE_URL || "https://apiv2.polopan.com",
      POLOPAN_SECRET_KEY: process.env.POLOPAN_SECRET_KEY || "MCP",
      POLOPAN_USER_AGENT: process.env.POLOPAN_USER_AGENT || "PoloPan-MCP-Test",
    },
  });

  const client = new Client({
    name: "polopan-size-guide-test",
    version: "1.0.0",
  });

  await client.connect(transport);

  // 1. Search for a shirt or dress to get a real handle
  const searchRes = await client.request(
    {
      method: "tools/call",
      params: {
        name: "products.search.text",
        arguments: { query: "shirt", page: 1, page_size: 2 },
      },
    },
    CallToolResultSchema
  );

  const searchData = JSON.parse(searchRes.content[0].text);
  const handle = searchData.products[0]?.handle;
  console.log("Found sample product handle:", handle);

  // 2. Call products.items.get_size_guide in inches with waist
  console.log("\n--- Testing products.items.get_size_guide (unit: in) ---");
  const sizeGuideResIn = await client.request(
    {
      method: "tools/call",
      params: {
        name: "products.items.get_size_guide",
        arguments: {
          handle,
          unit: "in",
          user_waist: 32,
          user_unit: "in",
        },
      },
    },
    CallToolResultSchema
  );
  console.log(JSON.stringify(JSON.parse(sizeGuideResIn.content[0].text), null, 2));

  // 3. Call products.items.get_size_guide in cm
  console.log("\n--- Testing products.items.get_size_guide (unit: cm) ---");
  const sizeGuideResCm = await client.request(
    {
      method: "tools/call",
      params: {
        name: "products.items.get_size_guide",
        arguments: {
          handle,
          unit: "cm",
        },
      },
    },
    CallToolResultSchema
  );
  console.log(JSON.stringify(JSON.parse(sizeGuideResCm.content[0].text), null, 2));

  // 4. Call products.items.check_stock to ensure size_chart is populated
  console.log("\n--- Testing products.items.check_stock ---");
  const checkStockRes = await client.request(
    {
      method: "tools/call",
      params: {
        name: "products.items.check_stock",
        arguments: {
          handle,
          desired_size: "M",
        },
      },
    },
    CallToolResultSchema
  );
  const checkStockData = JSON.parse(checkStockRes.content[0].text);
  console.log("check_stock returned size_chart:", checkStockData.size_chart !== undefined);
  if (checkStockData.size_chart) {
    console.log("Size chart columns:", checkStockData.size_chart.columns);
    console.log("Size chart rows count:", checkStockData.size_chart.measurements?.length);
  }

  await transport.close();
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
