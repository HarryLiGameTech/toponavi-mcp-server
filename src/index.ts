/**
 * toponavi-mcp-server — baseline MCP server entry point
 *
 * Architecture overview:
 *   LLM Host  ←→  MCP Client  ←→  MCP Server (this file)
 *
 * The MCP server:
 *  - Acts as a capability registry + request router
 *  - Declares navigation and discovery tools with schemas
 *  - Validates inputs, routes requests to handlers
 *  - Communicates with the MCP client over JSON-RPC 2.0 via stdio
 *
 * Tool schemas and handlers live in their respective modules; registrations
 * below attach the backend building inventory to each tool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { loadBuildingCatalog } from "./building-catalog.js";
import { describeBuildings } from "./building-resolution.js";
import {
  createPlanRouteHandler,
  topoNaviHttpClient,
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
import {
  createElevatorQueryHandler,
  elevatorQueryInputSchema,
  elevatorQueryOutputSchema,
} from "./elevator-query.js";

// ---------------------------------------------------------------------------
// Server instantiation
// ---------------------------------------------------------------------------

const buildings = await loadBuildingCatalog(topoNaviHttpClient);
const buildingNameInput = z.string().trim().min(1).describe(describeBuildings(buildings));

const server = new McpServer({
  name: "toponavi-mcp-server",
  version: "0.2.0",
}, {
  instructions: [
    "Use structured route waypoints rather than legacy namedWaypoints.",
    "Never present nodeId as a user-facing place name; prefer shopName, facilityName, or description.",
    "Always communicate requiredActions and requiredActionEvents.",
    "Treat route-tool business errors as recoverable constraints and do not silently relax user banTags.",
    "Pass the user's Chinese building name, abbreviation, or building ID through unchanged. Each TopoNavi tool resolves the supported building deterministically; do not translate or guess a backend identifier.",
    "For a fuzzy destination, preserve the user's language, separate the floor or area phrase into submapHint and the place phrase into placeHint, then call indoor-navigation-place-resolve before route planning. Never translate or rewrite the place phrase for retries; the resolver owns deterministic aliases and always preserves its resolved floor scope.",
    "For discovery questions about available places or traversable segments, call indoor-navigation-filtered-query with tag, shop_category, or action_required filters. Filter fields are ANDed while values within one field are ORed. If it returns needs_interpretation, choose a canonical candidate and call the tool again before answering.",
    "For elevator-only discovery questions, call indoor-navigation-elevator-query with simple=true instead of searching elevator-hall nodes. Keep the entire spoken answer within 35 English words and three short sentences, including the notice and question. Use stop ranges or differences rather than enumerating every stop. Never speak raw transportId syntax: render a clearly semantic ID naturally, such as 'north elevator', and call an opaque ID 'an elevator group'. Always say the elevator information is for reference only because local access policies may apply. Ask which group the user wants examined more closely; after they choose, call again with simple=false and its transportId. Never invent a missing displayName.",
  ].join(" "),
});

// ---------------------------------------------------------------------------
// TOOLS
// ---------------------------------------------------------------------------

server.registerTool(
  "indoor-navigation-elevator-query",
  {
    title: "Indoor Navigation Elevator Query",
    description: "Query elevator transport declarations from the parameter-specific compiled topology. Start with simple=true to get transport IDs and served-stop labels. If the user requests details for one result, call again with simple=false and that transportId to get its explicit nullable displayName plus stop labels, exact node IDs, and locations. Do not use elevator-hall nodes as evidence. Every user-facing answer must say this information is for reference and practical access constraints may apply under local policies.",
    inputSchema: elevatorQueryInputSchema.extend({ buildingName: buildingNameInput }),
    outputSchema: elevatorQueryOutputSchema,
  },
  createElevatorQueryHandler(buildings),
);

server.registerTool(
  "indoor-navigation-filtered-query",
  {
    title: "Indoor Navigation Filtered Query",
    description: "Search the parameter-specific compiled topology by fuzzy tag, shop_category, or action_required values. Different filter fields are ANDed; values inside one field are ORed. Node queries support tag and shop_category. Edge queries use action_required with optional edge tags and return up to five direct neighboring nodes per segment. If any interpretation is below 50% confidence, the tool returns needs_interpretation without searching; choose a canonical candidate and call again.",
    inputSchema: filteredQueryInputSchema.extend({ buildingName: buildingNameInput }),
    outputSchema: filteredQueryOutputSchema,
  },
  createFilteredQueryHandler(buildings),
);

server.registerTool(
  "indoor-navigation-place-resolve",
  {
    title: "Indoor Navigation Place Resolver",
    description: "Resolve a user-provided fuzzy destination against the parameter-specific compiled TopoNavi catalog. Preserve the user's language and separate an explicit floor or area phrase into submapHint and the remaining facility or shop phrase into placeHint. The resolver applies deterministic aliases without leaving the resolved floor. Returns a canonical nodeId only when the match is unique; when candidates remain, ask the user one short clarification question and never guess or expose internal IDs.",
    inputSchema: placeResolutionInputSchema.extend({ buildingName: buildingNameInput }),
    outputSchema: placeResolutionOutputSchema,
  },
  createResolvePlaceHandler(buildings),
);

server.registerTool(
  "indoor-navigation-path-query",
  {
    title: "Indoor Navigation Path Query",
    description: "Plan an indoor route using exact '{submap}::{node}' identifiers. Returns a structured routeOverview for macro-route and first-transfer guidance, plus metadata-first waypoints with cautious fallbackLabel hints only when metadata is missing. Speak a cleaned node-ID meaning only when it is semantically clear, reduce coded numeric or one-letter suffixes, keep generic geometry generic, and omit opaque nodes. Supports route preference, hard banTags, required actions, and recoverable business errors. Resolve fuzzy place names before calling this tool.",
    inputSchema: navigationInputSchema.extend({ buildingName: buildingNameInput }),
    outputSchema: navigationOutputSchema,
  },
  createPlanRouteHandler(buildings),
);


// ---------------------------------------------------------------------------
// Transport & connection
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
