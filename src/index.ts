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
import {
  createPlanRouteHandler,
  navigationInputSchema,
  navigationOutputSchema,
} from "./navigation.js";
import {
  createResolvePlaceHandler,
  placeResolutionInputSchema,
  placeResolutionOutputSchema,
} from "./place-resolution.js";
import {
  createFilteredQueryHandler,
  filteredQueryInputSchema,
  filteredQueryOutputSchema,
} from "./filtered-query.js";

// ---------------------------------------------------------------------------
// Server instantiation
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "toponavi-mcp-server",
  version: "0.2.0",
}, {
  instructions: [
    "Use structured route waypoints rather than legacy namedWaypoints.",
    "Never present nodeId as a user-facing place name; prefer shopName, facilityName, or description.",
    "Always communicate requiredActions and requiredActionEvents.",
    "Treat route-tool business errors as recoverable constraints and do not silently relax user banTags.",
    "For a fuzzy destination, separate the user's floor or area phrase into submapHint and the place phrase into placeHint, then call indoor-navigation-place-resolve before route planning.",
    "For discovery questions about available places or traversable segments, call indoor-navigation-filtered-query with tag, shop_category, or action_required filters. Filter fields are ANDed while values within one field are ORed. If it returns needs_interpretation, choose a canonical candidate and call the tool again before answering.",
  ].join(" "),
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

server.registerTool(
  "indoor-navigation-filtered-query",
  {
    title: "Indoor Navigation Filtered Query",
    description: "Search the parameter-specific compiled topology by fuzzy tag, shop_category, or action_required values. Different filter fields are ANDed; values inside one field are ORed. Node queries support tag and shop_category. Edge queries use action_required with optional edge tags and return up to five direct neighboring nodes per segment. If any interpretation is below 50% confidence, the tool returns needs_interpretation without searching; choose a canonical candidate and call again.",
    inputSchema: filteredQueryInputSchema,
    outputSchema: filteredQueryOutputSchema,
  },
  createFilteredQueryHandler(),
);

server.registerTool(
  "indoor-navigation-place-resolve",
  {
    title: "Indoor Navigation Place Resolver",
    description: "Resolve a user-provided fuzzy destination against the parameter-specific compiled TopoNavi catalog. Separate an explicit floor or area phrase into submapHint and the remaining facility or shop phrase into placeHint. Returns a canonical nodeId only when the match is unique; when candidates remain, ask the user one short clarification question and never guess or expose internal IDs.",
    inputSchema: placeResolutionInputSchema,
    outputSchema: placeResolutionOutputSchema,
  },
  createResolvePlaceHandler(),
);

server.registerTool(
  "indoor-navigation-path-query",
  {
    title: "Indoor Navigation Path Query (Shanghai World Financial Center only)",
    description: "Plan an indoor route using exact '{submap}::{node}' identifiers. Returns a structured routeOverview for macro-route and first-transfer guidance, plus metadata-first waypoints with cautious fallbackLabel hints only when metadata is missing. Speak a cleaned node-ID meaning only when it is semantically clear, reduce coded numeric or one-letter suffixes, keep generic geometry generic, and omit opaque nodes. Supports route preference, hard banTags, required actions, and recoverable business errors. Resolve fuzzy place names before calling this tool.",
    inputSchema: navigationInputSchema,
    outputSchema: navigationOutputSchema,
  },
  createPlanRouteHandler(),
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
