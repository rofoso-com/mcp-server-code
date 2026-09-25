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
      POLOPAN_SECRET_KEY: process.env.POLOPAN_SECRET_KEY || "",
      POLOPAN_USER_AGENT: process.env.POLOPAN_USER_AGENT || "PoloPan-MCP-Smoke",
      POLOPAN_TIMEOUT_MS: process.env.POLOPAN_TIMEOUT_MS || "20000",
    },
  });

  const client = new Client({
    name: "polopan-products-smoke-test",
    version: "1.0.0",
  });

  await client.connect(transport);

  const toolsRes = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
  const toolNames = new Set((toolsRes.tools || []).map((t) => t.name));
  console.log("Available tools:", [...toolNames].join(", "));

  const calls = [
    { name: "products.search.text", arguments: { query: "black dress", page: 1, page_size: 3 } },
    {
      name: "products.search.image_url",
      arguments: {
        image_url: "https://i.pinimg.com/280x280_RS/42/8c/95/428c9583212aeaa13256b4d7e619ea99.jpg",
        page: 1,
        page_size: 3,
      },
    },
    { name: "products.items.get_by_handle", arguments: { handle: "zara-tailored-waistcoat-with-linen-5566-064-v2024" } },
    {
      name: "products.search.alternatives",
      arguments: {
        handle: "zara-tailored-waistcoat-with-linen-5566-064-v2024",
        budget_range: "1501-3000",
      },
    },
    { name: "looks.curation.recommend", arguments: { handle: "zara-tailored-waistcoat-with-linen-5566-064-v2024", page: 1, page_size: 5 } },
  ];

  for (const test of calls) {
    if (!toolNames.has(test.name)) {
      console.log(`\n[FAIL] ${test.name} (tool not found)`);
      continue;
    }
    try {
      const result = await client.request(
        {
          method: "tools/call",
          params: { name: test.name, arguments: test.arguments },
        },
        CallToolResultSchema
      );
      const firstText = result.content?.find((c) => c.type === "text")?.text ?? "";
      console.log(`\n[PASS] ${test.name}`);
      console.log(firstText.slice(0, 300).replace(/\s+/g, " "));
    } catch (error) {
      console.log(`\n[FAIL] ${test.name}`);
      console.log(error instanceof Error ? error.message : String(error));
    }
  }

  await transport.close();
}

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
