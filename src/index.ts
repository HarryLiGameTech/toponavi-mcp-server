/**
 * toponavi-mcp-server — baseline MCP server entry point
 *
 * Architecture overview:
 *   LLM Host  ←→  MCP Client  ←→  MCP Server (this file)
 *
 * The MCP server:
 *  - Acts as a capability registry + request router
 *  - Declares Tools, Resources, and Prompts with schemas
 *  - Validates inputs, routes requests to handlers
 *  - Communicates with the MCP client over JSON-RPC 2.0 via stdio
 *
 * To extend this server:
 *  1. Replace the placeholder tool/resource/prompt registrations below
 *     with your real specs and handler logic.
 *  2. Look for "// TODO:" comments — those are the exact spots to fill in.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import axios from "axios";

// ---------------------------------------------------------------------------
// Server instantiation
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "toponavi-mcp-server",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// TOOLS
//
// Tools are functions the LLM can invoke. Replace the placeholder entries
// below with your real tool names, descriptions, input schemas, and handler
// logic. Each tool follows this shape:
//
//   server.registerTool(
//     "tool-name",
//     {
//       title: "Human-readable title",
//       description: "What the tool does",
//       inputSchema: z.object({ /* your fields */ }),
//     },
//     async (args) => {
//       // your logic here
//       return { content: [{ type: "text", text: "result" }] };
//     }
//   );
// ---------------------------------------------------------------------------

server.registerTool(
  "test-building-query",
  {
    title: "Test Building Query",
    description: "A tool to query test building information",
    inputSchema: z.object({
      buildingName: z.string().describe("The name of the building to query"),
    }),
  },
  async ({ buildingName }) => {
    // Make HTTP request to your Spring Boot backend
    const response = await axios.get("http://192.168.50.65:8080/api/v1/test-building-query", {
      params: { name: buildingName },
    });

    const { name, address, height, description } = response.data;

    return {
      content: [
        {
          type: "text",
          text: `${name} is a ${height}-meter building located at ${address}. ${description}`,
        },
      ],
    };
  }
);

// Basic navigation query tool
// Require exact node-name match
server.registerTool(
  "indoor-navigation-path-query",
  {
    title: "Indoor Navigation Path Query (Shanghai World Financial Center only)",
    description: "A tool to query indoor navigation paths between two locations (nodes) within a Shanghai World Financial Center. The input nodes must be in the format of '{floor}::{node}', e.g. 'B1::NodeA' or 'Floor4::NodeB'. The tool will return the navigation route, detailed steps, and estimated time.",
    inputSchema: z.object({
      startNode: z.string().describe("The starting location/node for the navigation query. It must be in '{floor}::{node}' format, e.g. 'B1::NodeA'"),
      endNode: z.string().describe("The ending location/node for the navigation query. It must be in '{floor}::{node}' format, e.g. 'Floor4::NodeB'"),
    }),
  },
  async ({ startNode, endNode }) => {
    // Make HTTP request to your Spring Boot backend
    const response = await axios.get("http://192.168.50.65:8080/api/v1/quick-demo-navigation", {
      params: { startNode: startNode, endNode: endNode },
    });

    const { steps, path } = response.data;

    return {
      content: [
        {
          type: "text",
          text: `Navigation route:\n${path}\n\nDetailed steps:\n${steps.map((step: any, index: number) =>
            `${index + 1}. ${step.description || `${step.type}: ${step.from || step.fromGraph} → ${step.to || step.toGraph}`}${step.costSeconds ? ` (${Math.round(step.costSeconds / 60)}m ${Math.round(step.costSeconds % 60)}s)` : ''}${step.namedWaypoints && step.namedWaypoints.length > 0 ? `\n   Waypoints: ${step.namedWaypoints.join(' → ')}` : ''}`
          ).join('\n\n')}`
        },
      ],
    };
  }
);

// TODO: specify this tool
server.registerTool(
  "tool-placeholder-3",
  {
    title: "Placeholder Tool 3",
    description: "TODO: specify this tool",
    inputSchema: z.object({}),
  },
  async (_args) => ({
    content: [{ type: "text", text: "TODO: implement handler" }],
  }),
);

// ---------------------------------------------------------------------------
// RESOURCES
//
// Resources expose data (files, configs, database records, etc.) for the LLM
// to read. They should be side-effect free. Replace the placeholder below
// with your real resource URI, metadata, and handler.
//
//   server.registerResource(
//     "resource-name",
//     "scheme://path/to/resource",
//     { title: "...", description: "...", mimeType: "text/plain" },
//     async (uri) => ({
//       contents: [{ uri: uri.href, text: "your data here" }],
//     })
//   );
// ---------------------------------------------------------------------------

// TODO: specify this resource
server.registerResource(
  "resource-placeholder-1",
  "toponavi://resources/placeholder-1",
  {
    title: "Placeholder Resource 1",
    description: "TODO: specify this resource",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, text: "TODO: implement handler" }],
  }),
);

// ---------------------------------------------------------------------------
// PROMPTS
//
// Prompts are reusable message templates surfaced to users or clients.
// Replace the placeholder below with your real prompt name, description,
// argument schema, and message builder.
//
//   server.registerPrompt(
//     "prompt-name",
//     {
//       title: "...",
//       description: "...",
//       argsSchema: { input: z.string() },   // raw Zod shape, NOT z.object(...)
//     },
//     ({ input }) => ({
//       messages: [{
//         role: "user" as const,
//         content: { type: "text" as const, text: `...${input}...` },
//       }],
//     })
//   );
// ---------------------------------------------------------------------------

// TODO: specify this prompt
server.registerPrompt(
  "prompt-placeholder-1",
  {
    title: "Placeholder Prompt 1",
    description: "TODO: specify this prompt",
    // argsSchema: { /* TODO: add your argument fields here, e.g. input: z.string() */ },
  },
  (_args) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: "TODO: implement handler",
        },
      },
    ],
  }),
);

// ---------------------------------------------------------------------------
// Transport & connection
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
