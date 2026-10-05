# toponavi-mcp-server

A baseline **Model Context Protocol (MCP)** server for toponavi, built with the
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
TypeScript SDK.

---

## What is MCP?

**Model Context Protocol (MCP)** is an open standard introduced by Anthropic that
defines a universal interface between LLM hosts and external tools, data sources,
and prompt templates.

### Architecture

```
┌─────────────┐        JSON-RPC 2.0        ┌─────────────┐        ┌──────────────┐
│  LLM Host   │  ←──  MCP Client  ──→  │  MCP Server │        │ Your Backend │
│(Claude, etc)│                           │  (this app) │ ──────▶│  / Services  │
└─────────────┘                           └─────────────┘        └──────────────┘
```

- **LLM Host** — the AI model (e.g. Claude Desktop) that decides when to call tools.
- **MCP Client** — built into the LLM host; discovers capabilities and sends requests.
- **MCP Server** — *this* project. It declares capabilities and routes requests to
  your handlers. It never talks to the LLM directly.

### The three MCP primitives

| Primitive | Purpose |
|-----------|---------|
| **Tools** | Functions the LLM can call (e.g. search, query a DB, send an email) |
| **Resources** | Data the LLM can read (e.g. files, API responses) — side-effect free |
| **Prompts** | Reusable message templates surfaced to users/clients |

---

## Installation

**Prerequisites:** Node.js ≥ 20

```bash
npm install
```

---

## Running the server

### Development (TypeScript, no compile step)

```bash
npm run dev
```

### Production

```bash
# 1. Compile TypeScript to JavaScript
npm run build

# 2. Start the compiled server
npm start
```

The server communicates over **stdio** (standard in/out), which is the standard
transport for locally-embedded MCP servers (e.g. Claude Desktop integration).

### Backend configuration

The navigation tools call the TopoNavi Web API. Configure its base URL and
request timeout with environment variables:

```bash
export TOPONAVI_API_BASE_URL="http://127.0.0.1:8080"
export TOPONAVI_API_TIMEOUT_MS="60000"
export TOPONAVI_API_TOKEN="<platform bearer token>"
```

`TOPONAVI_API_BASE_URL` defaults to the existing development backend address. `TOPONAVI_API_TOKEN` supplies the platform JWT for protected endpoints; omit it only when the backend explicitly enables the building through `TOPONAVI_ANONYMOUS_BUILDINGS`.
The 60-second default timeout allows a cold SWFC map compilation to finish.

### Available buildings

Start the updated backend before starting MCP. At startup, MCP reads
`GET /api/v1/buildings` from `TOPONAVI_API_BASE_URL` and uses that
inventory for every navigation tool's building description and name resolution.
If the endpoint is unreachable, unsupported, or returns an invalid inventory,
startup fails with a catalog error rather than advertising a fallback list.

The backend lists immediate subdirectories of its configured `EXAMPLES_PATH`
that contain a readable `configuration.tcfg` or `configuration`. An empty
inventory advertises no buildings. Restart MCP after adding or removing map
projects so its advertised inventory is refreshed.

The engine currently ships `indigoBJ`, `swfc`, `nbc4`, and `trent`. `GalleriaBJ`
and `CWTC` are recognized aliases only when those projects are installed on the
connected backend. Custom map projects are accepted by their directory names;
known projects also support their existing Chinese names and abbreviations.
`buildingName` is required; no building is selected implicitly.

This is a source-map inventory. Compilation still requires the parameters
declared by each project's `root`, and installed maps can contain validation
errors. Availability in the catalog does not guarantee that every route exists.

### Navigation tool

`indoor-navigation-path-query` accepts exact `{submap}::{node}` identifiers,
optional compile-time `userParams`, and these implemented traversal fields:

- `routePlanningPreference`
- `banTags`

The result includes MCP `structuredContent` with structured `waypoints`, route
tags, required actions, applied preferences, and machine-readable business
errors. `minimizeTag`, `maximizeTag`, and `riskPreference` are not exposed by
this MCP adapter.

### Discovery tool

`indoor-navigation-filtered-query` searches the parameter-specific compiled
topology using fuzzy `tag`, `shop_category`, and `action_required` filters.
Different fields are ANDed, while multiple values inside one field are ORed.

Queries containing `action_required` return matching compiled edges. Each edge
includes up to five direct neighboring nodes, merged from both endpoints and
ordered by edge cost. Node queries support `tag` and `shop_category`.

The tool resolves common synonyms such as `bathroom` to `toilet` and `walk thru
the bridge` to `cross_bridge`. An interpretation below 50% confidence returns
`needs_interpretation` without search results. The agent must choose a returned
canonical candidate and make a second call before answering.

### Elevator query tool

`indoor-navigation-elevator-query` reads elevator transport declarations from
the parameter-specific compiled topology. It does not discover elevators from
elevator-hall node names.

Use `simple: true` for the initial overview. This returns complete declared `params`, `transportId`, and
`servedStops` for each elevator. After the user chooses an elevator and asks for
more detail, call again with `simple: false` and its `transportId`; the full form
returns the explicitly declared nullable `displayName` and each stop's `label`,
`nodeId`, and `location`.

Every user-facing elevator answer must state that the information is for
reference and practical access constraints may apply under local policies.

---

## Connecting to Claude Desktop

Add an entry to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "toponavi": {
      "command": "node",
      "args": ["/absolute/path/to/toponavi-mcp-server/dist/index.js"]
    }
  }
}
```

Or for the dev (no-build) variant:

```json
{
  "mcpServers": {
    "toponavi": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/toponavi-mcp-server/src/index.ts"]
    }
  }
}
```

---

## Extending the server

Tool registrations live in `src/index.ts`. Schemas and handlers live in the
navigation, place-resolution, filtered-query, and elevator-query modules.
Register new tools with explicit input/output schemas and a handler, following
those modules and their tests.

The server currently exposes four navigation and discovery tools. It does not
register resources or prompts.

---

## Project structure

```
toponavi-mcp-server/
├── src/
│   └── index.ts        # Server entry point and tool registrations
├── dist/               # Compiled output (generated by `npm run build`)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Technology

- **TypeScript** with strict mode and ESM modules
- **[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)** — official MCP server SDK
- **[Zod v4](https://zod.dev)** — schema validation for tool inputs
- **`tsx`** — zero-config TypeScript runner for development

The client uses `/api/v1/buildings/{buildingId}/find-route` and the building-scoped topology query endpoints. Discovery explicitly requests `inDetail: true` when it needs attributes. Fuzzy interpretation stays in MCP; canonical predicates execute in the backend before the MCP result limit. The placeholder `test-building-query` tool has been removed. Deploy this client with the refactored backend.
