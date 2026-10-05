import { describe, expect, it } from "@jest/globals";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("MCP building discovery", () => {
  it("advertises the backend inventory and routes a custom building without assuming SWFC", async () => {
    const requests: Array<{ buildingName: string | null; body: unknown }> = [];
    const backend = createServer(async (request, response) => {
      const url = new URL(request.url!, "http://localhost");
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET" && url.pathname === "/api/v1/buildings") {
        response.end(JSON.stringify({ status: "success", buildings: ["DemoTower", "indigoBJ"] }));
      } else if (request.method === "POST" && url.pathname === "/api/v1/buildings/DemoTower/find-route") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        requests.push({ buildingName: decodeURIComponent(url.pathname.split("/")[4]!), body: JSON.parse(Buffer.concat(chunks).toString()) });
        response.end(JSON.stringify({
          status: "success",
          path: "Custom building route",
          steps: [{ step: 1, type: "Walk", graph: "Floor", from: "start", to: "goal", costSeconds: 5 }],
          appliedTraversalPreference: { routePlanningPreference: "MinimizeTime", banTags: [] },
        }));
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      backend.once("error", reject);
      backend.listen(0, "127.0.0.1", resolve);
    });
    const address = backend.address();
    if (!address || typeof address === "string") throw new Error("Expected a local HTTP address");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts"],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        TOPONAVI_API_BASE_URL: `http://127.0.0.1:${address.port}`,
        TOPONAVI_API_TIMEOUT_MS: "1000",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "catalog-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      expect(client.getServerCapabilities()?.resources).toBeUndefined();
      expect(client.getServerCapabilities()?.prompts).toBeUndefined();
      const { tools } = await client.listTools();
      const navigationTools = tools.filter((tool) => tool.name.startsWith("indoor-navigation-"));
      expect(navigationTools).toHaveLength(4);
      expect(tools.find((tool) => tool.name === "indoor-navigation-path-query")?.title)
        .toBe("Indoor Navigation Path Query");
      for (const tool of navigationTools) {
        const schema = tool.inputSchema.properties!.buildingName as { description: string; default?: string };
        expect(schema.description).toContain("DemoTower");
        expect(schema.description).toContain("北京颐堤港 (indigoBJ)");
        expect(schema.description).not.toMatch(/SWFC|swfc|GalleriaBJ|CWTC|trent|nbc4/);
        expect(schema.default).toBeUndefined();
        expect(tool.inputSchema.required).toContain("buildingName");
      }

      const unavailable = await client.callTool({
        name: "indoor-navigation-path-query",
        arguments: { buildingName: "SWFC", startNode: "Floor::start", endNode: "Floor::goal" },
      });
      expect(unavailable.structuredContent).toMatchObject({ code: "BUILDING_NAME_NOT_FOUND" });
      expect(requests).toHaveLength(0);

      const route = await client.callTool({
        name: "indoor-navigation-path-query",
        arguments: {
          buildingName: "demotower", startNode: "Floor::start", endNode: "Floor::goal",
          userParams: { haveCard: true },
        },
      });
      expect(route.isError).not.toBe(true);
      expect(requests).toEqual([{
        buildingName: "DemoTower",
        body: {
          startNode: "Floor::start", endNode: "Floor::goal", routingMode: "fullyInformed",
          userParams: { haveCard: true },
          traversalPreference: { routePlanningPreference: "MinimizeTime", banTags: [] },
        },
      }]);
    } finally {
      await client.close();
      await transport.close();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
    }
  }, 15000);
});
