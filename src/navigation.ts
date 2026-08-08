import axios, { type AxiosInstance } from "axios";
import { z } from "zod/v4";

import {
  BUILDING_NAME_INPUT_DESCRIPTION,
  BuildingResolutionError,
  resolveBackendBuildingName,
} from "./building-resolution.js";

const routePlanningPreferenceSchema = z.enum([
  "MinimizeTime",
  "MinimizeTransfers",
  "MinimizePhysicalDemands",
]);

const userParamValueSchema = z.union([z.boolean(), z.number(), z.string()]);

export const navigationInputSchema = z.object({
  buildingName: z.string().trim().min(1).default("swfc").describe(
    BUILDING_NAME_INPUT_DESCRIPTION,
  ),
  startNode: z.string().trim().min(1).describe(
    "Exact start node in '{submap}::{node}' format after location resolution.",
  ),
  endNode: z.string().trim().min(1).describe(
    "Exact destination node in '{submap}::{node}' format after location resolution.",
  ),
  userParams: z.record(z.string(), userParamValueSchema).default({}).describe(
    "Compile-time access and capability parameters. SWFC access parameters default to conservative values.",
  ),
  traversalPreference: z.object({
    routePlanningPreference: routePlanningPreferenceSchema.default("MinimizeTime"),
    banTags: z.array(z.string().trim().min(1)).default([]).describe(
      "Hard traversal bans such as 'outdoor', 'odor_prone', or 'staffed'.",
    ),
  }).strict().default({
    routePlanningPreference: "MinimizeTime",
    banTags: [],
  }),
}).strict();

export type NavigationInput = z.infer<typeof navigationInputSchema>;

const waypointSchema = z.object({
  nodeId: z.string(),
  graph: z.string(),
  displayName: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  shopName: z.string().nullable().optional(),
  facilityName: z.string().nullable().optional(),
  shopCategory: z.string().nullable().optional(),
  facilityCategory: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  narration: z.string().nullable().optional(),
  refVisualUrl: z.string().nullable().optional(),
  beaconId: z.string().nullable().optional(),
  isTrivial: z.boolean(),
  isIntermediate: z.boolean(),
  fallbackLabel: z.string().optional(),
  fallbackLabelKind: z.enum(["semantic_node_id", "generic_geometry"]).optional(),
}).passthrough();

const requiredActionEventSchema = z.object({
  action: z.string(),
  from: z.string(),
  to: z.string(),
  graph: z.string(),
});

const rawRouteStepSchema = z.object({
  step: z.number(),
  type: z.string(),
  graph: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  description: z.string().optional(),
  fromGraph: z.string().optional(),
  toGraph: z.string().optional(),
  namedWaypoints: z.array(z.string()).optional(),
  waypoints: z.array(waypointSchema).default([]),
  turnDirection: z.string().optional(),
  turnAtNode: z.string().optional(),
  costSeconds: z.number(),
  tags: z.array(z.string()).default([]),
  requiredActions: z.array(z.string()).default([]),
  requiredActionEvents: z.array(requiredActionEventSchema).default([]),
}).passthrough();

export const routeStepOutputSchema = z.object({
  step: z.number(),
  type: z.string(),
  graph: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  description: z.string().optional(),
  fromGraph: z.string().optional(),
  toGraph: z.string().optional(),
  waypoints: z.array(waypointSchema),
  turnDirection: z.string().optional(),
  turnAtNode: z.string().optional(),
  costSeconds: z.number(),
  tags: z.array(z.string()),
  requiredActions: z.array(z.string()),
  requiredActionEvents: z.array(requiredActionEventSchema),
}).passthrough();

const deprecationSchema = z.object({
  field: z.string(),
  status: z.string(),
  replacement: z.string().nullable().optional(),
  since: z.string().optional(),
  removalVersion: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

export const routeOverviewSchema = z.object({
  isComplex: z.boolean(),
  transportCount: z.number().int().nonnegative(),
  transferCount: z.number().int().nonnegative(),
  transferGraphs: z.array(z.string()),
  initialGuidanceThroughStep: z.number().int().positive().nullable(),
});

const rawRouteResponseSchema = z.object({
  status: z.literal("success"),
  path: z.string(),
  steps: z.array(rawRouteStepSchema),
  appliedTraversalPreference: z.object({
    routePlanningPreference: routePlanningPreferenceSchema,
    banTags: z.array(z.string()),
  }),
  deprecations: z.array(deprecationSchema).default([]),
  filesLoaded: z.number().optional(),
  cacheKey: z.string().optional(),
  fromCache: z.boolean().optional(),
}).passthrough();

export const routeResponseOutputSchema = z.object({
  status: z.literal("success"),
  path: z.string(),
  steps: z.array(routeStepOutputSchema),
  routeOverview: routeOverviewSchema,
  appliedTraversalPreference: z.object({
    routePlanningPreference: routePlanningPreferenceSchema,
    banTags: z.array(z.string()),
  }),
  deprecations: z.array(deprecationSchema),
  filesLoaded: z.number().optional(),
  cacheKey: z.string().optional(),
  fromCache: z.boolean().optional(),
}).passthrough();

export type RouteResponse = z.infer<typeof routeResponseOutputSchema>;

export const routeErrorOutputSchema = z.object({
  status: z.literal("error"),
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  recoveryHint: z.string().optional(),
  httpStatus: z.number().int().optional(),
}).passthrough();

export type RouteErrorResponse = z.infer<typeof routeErrorOutputSchema>;
export type NavigationOutput = RouteResponse | RouteErrorResponse;

// MCP tool output schemas must be rooted at an object. Keep the wire shape flat
// while enforcing the success/error branches during server-side validation.
export const navigationOutputSchema = routeResponseOutputSchema.partial().extend({
  status: z.enum(["success", "error"]),
  code: routeErrorOutputSchema.shape.code.optional(),
  message: routeErrorOutputSchema.shape.message.optional(),
  details: routeErrorOutputSchema.shape.details,
  recoveryHint: routeErrorOutputSchema.shape.recoveryHint,
  httpStatus: routeErrorOutputSchema.shape.httpStatus,
}).superRefine((value, context) => {
  const branchSchema = value.status === "success"
    ? routeResponseOutputSchema
    : routeErrorOutputSchema;
  const result = branchSchema.safeParse(value);

  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  }
});

type NavigationToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const DEFAULT_API_BASE_URL = "http://192.168.50.65:8080";
const DEFAULT_API_TIMEOUT_MS = 60_000;
const SWFC_DEFAULT_USER_PARAMS: Record<string, boolean | number | string> = {
  haveStaffCard: false,
  haveManagementCard: false,
  haveRoomKey: false,
  id: 0,
  aggregatedWeight: 0,
};

function apiBaseUrl(): string {
  return (process.env.TOPONAVI_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

function apiTimeoutMs(): number {
  const configured = Number(process.env.TOPONAVI_API_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_API_TIMEOUT_MS;
}

export const topoNaviHttpClient = axios.create({
  baseURL: apiBaseUrl(),
  timeout: apiTimeoutMs(),
});

function resolveUserParams(input: NavigationInput): Record<string, boolean | number | string> {
  if (input.buildingName.toLowerCase() !== "swfc") return input.userParams;
  return { ...SWFC_DEFAULT_USER_PARAMS, ...input.userParams };
}

export type NodeIdFallback = {
  label: string;
  kind: "semantic_node_id" | "generic_geometry";
};

const GEOMETRY_WORDS: Record<string, { noun: string; article: "a" | "an" }> = {
  corner: { noun: "corner", article: "a" },
  junction: { noun: "junction", article: "a" },
  intersection: { noun: "intersection", article: "an" },
  intersect: { noun: "intersection", article: "an" },
  corridor: { noun: "corridor", article: "a" },
  corr: { noun: "corridor", article: "a" },
  hallway: { noun: "hallway", article: "a" },
  hall: { noun: "hall", article: "a" },
  alley: { noun: "alley", article: "an" },
  lobby: { noun: "lobby", article: "a" },
  entrance: { noun: "entrance", article: "an" },
  exit: { noun: "exit", article: "an" },
  door: { noun: "door", article: "a" },
  doorway: { noun: "doorway", article: "a" },
  stairs: { noun: "staircase", article: "a" },
  staircase: { noun: "staircase", article: "a" },
  landing: { noun: "landing", article: "a" },
};

const NON_DESCRIPTIVE_TOKENS = new Set([
  "a", "b", "c", "d", "e", "n", "s", "w", "in", "out", "inside",
  "outside", "end", "interm", "intermediate", "internal", "node", "conn",
  "connection", "start", "goal", "temp", "tmp",
]);

const NUMBERED_PLACE_WORDS = new Set([
  "booth", "counter", "desk", "elevator", "entrance", "exit", "floor", "gate",
  "lift", "platform", "room", "stair", "staircase", "zone",
]);

function isOpaqueToken(token: string): boolean {
  return /^\d+$/u.test(token)
    || /^(?=[a-f\d]{6,}$)(?=.*\d)[a-f\d]+$/iu.test(token)
    || /^[a-z]{1,4}\d+$/iu.test(token)
    || /^[A-Z]{2,5}$/u.test(token)
    || NON_DESCRIPTIVE_TOKENS.has(token.toLowerCase());
}

function titleCaseWords(tokens: string[]): string {
  return tokens
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function semanticTokens(tokens: string[], excludedIndex?: number): string[] {
  const result: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (index === excludedIndex) continue;
    if (/^\d+$/u.test(token)) {
      const previous = tokens[index - 1]?.toLowerCase();
      if (previous && NUMBERED_PLACE_WORDS.has(previous)) result.push(token);
      continue;
    }
    if (!isOpaqueToken(token)) result.push(token);
  }
  return result;
}

export function deriveNodeIdFallback(nodeId: string): NodeIdFallback | undefined {
  const localId = nodeId.split("::").at(-1)?.trim() ?? "";
  if (!localId || /^(?:n|node)[_-][a-f\d]{6,}$/iu.test(localId)) return undefined;

  const betweenRooms = localId.match(
    /^between[_-]rooms?[_-]([a-z]?\d+[a-z]?)(?:[_-]and)?[_-]([a-z]?\d+[a-z]?)$/iu,
  );
  if (betweenRooms) {
    return {
      label: `between rooms ${betweenRooms[1]} and ${betweenRooms[2]}`,
      kind: "semantic_node_id",
    };
  }

  const tokens = localId.split(/[_\-\s]+/u).filter(Boolean);
  const geometryIndex = tokens.findIndex((token) => GEOMETRY_WORDS[token.toLowerCase()] !== undefined);
  if (geometryIndex >= 0) {
    const geometry = GEOMETRY_WORDS[tokens[geometryIndex]!.toLowerCase()]!;
    const descriptors = semanticTokens(tokens, geometryIndex);

    if (descriptors.length === 0) {
      return { label: `${geometry.article} ${geometry.noun}`, kind: "generic_geometry" };
    }

    const direction = descriptors.length === 1
      && /^(?:north|south|east|west|northeast|northwest|southeast|southwest)$/iu.test(descriptors[0]!);
    return {
      label: direction
        ? `the ${descriptors[0]!.toLowerCase()} ${geometry.noun}`
        : `${titleCaseWords(descriptors)} ${geometry.noun}`,
      kind: "semantic_node_id",
    };
  }

  const semantic = semanticTokens(tokens);
  if (semantic.length === 0) return undefined;
  return {
    label: semantic.length === 1
      ? semantic[0]!.toLowerCase()
      : titleCaseWords(semantic),
    kind: "semantic_node_id",
  };
}

function metadataLabel(waypoint: z.infer<typeof waypointSchema>): string | undefined {
  return waypoint.displayName
    || waypoint.display_name
    || waypoint.shopName
    || waypoint.facilityName
    || waypoint.label
    || waypoint.name
    || waypoint.description
    || waypoint.shopCategory
    || waypoint.facilityCategory
    || undefined;
}

function withFallbackLabel(
  waypoint: z.infer<typeof waypointSchema>,
): z.infer<typeof waypointSchema> {
  if (metadataLabel(waypoint)) return waypoint;
  const fallback = deriveNodeIdFallback(waypoint.nodeId);
  return fallback
    ? { ...waypoint, fallbackLabel: fallback.label, fallbackLabelKind: fallback.kind }
    : waypoint;
}

function waypointLabel(waypoint: z.infer<typeof waypointSchema>): string | undefined {
  return metadataLabel(waypoint) || waypoint.fallbackLabel;
}

export function deriveRouteOverview(
  steps: Array<{ step: number; type: string; toGraph?: string }>,
): z.infer<typeof routeOverviewSchema> {
  const transports = steps.filter((step) => step.type.toLowerCase() === "transport");
  const transferGraphs = transports
    .slice(0, -1)
    .map((step) => step.toGraph)
    .filter((graph): graph is string => Boolean(graph));
  const isComplex = transports.length >= 2;

  return {
    isComplex,
    transportCount: transports.length,
    transferCount: Math.max(0, transports.length - 1),
    transferGraphs,
    initialGuidanceThroughStep: isComplex ? transports[0]?.step ?? null : null,
  };
}

function normalizeRouteResponse(value: unknown): RouteResponse {
  const raw = rawRouteResponseSchema.parse(value);
  const steps = raw.steps.map((step) => {
    const normalized = { ...step } as Record<string, unknown>;
    delete normalized.namedWaypoints;
    delete normalized.from;
    delete normalized.to;

    const waypoints = step.waypoints.map(withFallbackLabel);
    normalized.waypoints = waypoints;

    const firstLabel = waypoints.at(0) && waypointLabel(waypoints.at(0)!);
    const lastLabel = waypoints.at(-1) && waypointLabel(waypoints.at(-1)!);
    if (firstLabel) normalized.from = firstLabel;
    if (lastLabel) normalized.to = lastLabel;

    return routeStepOutputSchema.parse(normalized);
  });

  return routeResponseOutputSchema.parse({
    ...raw,
    steps,
    routeOverview: deriveRouteOverview(steps),
  });
}

function visibleWaypointLabels(step: z.infer<typeof routeStepOutputSchema>): string[] {
  return step.waypoints
    .filter((waypoint, index, all) => {
      const isEndpoint = index === 0 || index === all.length - 1;
      if (isEndpoint) return true;
      if (waypoint.narration === "implicit") return false;
      return waypoint.narration === "explicit" || Boolean(waypointLabel(waypoint));
    })
    .map(waypointLabel)
    .filter((label): label is string => Boolean(label))
    .filter((label, index, all) => index === 0 || label !== all[index - 1]);
}

function renderRouteSummary(route: RouteResponse): string {
  const totalSeconds = route.steps.reduce((sum, step) => sum + step.costSeconds, 0);
  const lines = route.steps.map((step) => {
    const labels = visibleWaypointLabels(step);
    const movement = step.description
      || (labels.length >= 2
        ? `${step.type}: ${labels.join(" -> ")}`
        : `${step.type}: follow this route segment`);
    const actions = step.requiredActions.length > 0
      ? ` Required actions: ${step.requiredActions.join(", ")}.`
      : "";
    const tags = step.tags.length > 0 ? ` Route tags: ${step.tags.join(", ")}.` : "";
    return `${step.step}. ${movement} (${Math.round(step.costSeconds)}s).${actions}${tags}`;
  });

  return [
    `Route found: ${route.steps.length} step(s), approximately ${Math.round(totalSeconds)} seconds.`,
    route.routeOverview.isComplex
      ? `Complex route: ${route.routeOverview.transportCount} transport rides with ${route.routeOverview.transferCount} transfer(s) at ${route.routeOverview.transferGraphs.join(", ") || "unnamed transfer points"}. Start with a short macro-route sentence, then narrate steps through step ${route.routeOverview.initialGuidanceThroughStep}, ending after arrival at the first transfer point.`
      : "Simple route: give the first few actionable steps without a macro-route preface.",
    ...lines,
    "Metadata is authoritative: always use displayName, shopName, facilityName, description, or equivalent metadata when present, and never replace it with a node-ID interpretation. Only when metadata is absent, fallbackLabel may be used: semantic_node_id may be spoken when its direct meaning is clear, while generic_geometry must stay generic. Numeric and one-letter compass-like suffixes are intentionally removed unless the number belongs to a conventionally numbered place such as a room, gate, or booth. Omit opaque IDs and never pronounce raw identifier syntax. Always communicate required actions.",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recoveryHintFor(code: string): string {
  switch (code) {
    case "DESTINATION_HAS_BANNED_TAG":
      return "The destination conflicts with the requested banTags. Ask before relaxing the ban.";
    case "NO_ROUTE_WITH_BAN_TAGS":
      return "No route remains under the requested banTags. Ask whether the user wants to relax one of them.";
    case "NO_ROUTE_FOR_USER_PARAMS":
      return "No route remains in the topology compiled for the supplied access and capability parameters. Explain that the route is unavailable with the current settings, and ask before changing any card, key, or capability value.";
    case "NO_ROUTE_FOUND":
      return "No route exists between these locations in the compiled topology. Do not describe this as a temporary service failure.";
    case "TRAVERSAL_PREFERENCE_NOT_IMPLEMENTED":
      return "Do not retry with the unsupported preference fields.";
    default:
      return "Check the request and backend availability before retrying.";
  }
}

function errorResult(
  error: unknown,
  appliedUserParams?: Record<string, boolean | number | string>,
): NavigationToolResult {
  if (error instanceof BuildingResolutionError) {
    const payload: RouteErrorResponse = {
      status: "error",
      code: error.code,
      message: error.message,
      details: error.details,
      recoveryHint: "Ask the user which supported building they mean before retrying.",
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }

  if (axios.isAxiosError(error)) {
    const responseData = isRecord(error.response?.data) ? error.response.data : {};
    const httpStatus = error.response?.status;
    const legacyPlannerMessage = typeof responseData.error === "string"
      && (responseData.error.startsWith("No intra-map route found")
        || responseData.error.startsWith("No feasible transport path found"))
      ? responseData.error
      : undefined;
    const code = typeof responseData.code === "string"
      ? responseData.code
      : legacyPlannerMessage
        ? "NO_ROUTE_FOR_USER_PARAMS"
      : httpStatus
        ? `TOPONAVI_HTTP_${httpStatus}`
        : "TOPONAVI_BACKEND_UNAVAILABLE";
    const message = typeof responseData.message === "string"
      ? responseData.message
      : legacyPlannerMessage
        ? "No route is available with the supplied access and capability parameters."
        : error.message || "TopoNavi backend request failed";
    const details: Record<string, unknown> = isRecord(responseData.details)
      ? { ...responseData.details }
      : {};
    if (legacyPlannerMessage) {
      details.plannerMessage = legacyPlannerMessage;
      if (appliedUserParams) details.userParams = appliedUserParams;
    }
    const recoveryHint = recoveryHintFor(code);

    const payload: Record<string, unknown> = {
      status: "error",
      code,
      message,
      details,
      recoveryHint,
    };
    if (httpStatus) payload.httpStatus = httpStatus;

    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }

  const payload: Record<string, unknown> = {
    status: "error",
    code: "TOPONAVI_MCP_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function createPlanRouteHandler(
  httpClient: Pick<AxiosInstance, "post"> = topoNaviHttpClient,
) {
  return async (value: NavigationInput): Promise<NavigationToolResult> => {
    let appliedUserParams: Record<string, boolean | number | string> | undefined;
    try {
      const input = navigationInputSchema.parse(value);
      const buildingName = resolveBackendBuildingName(input.buildingName);
      const banTags = [...new Set(input.traversalPreference.banTags)];
      appliedUserParams = resolveUserParams({ ...input, buildingName });
      const response = await httpClient.post(
        "/api/v1/quick-demo-navigation",
        {
          userParams: appliedUserParams,
          traversalPreference: {
            routePlanningPreference: input.traversalPreference.routePlanningPreference,
            banTags,
          },
        },
        {
          params: {
            buildingName,
            startNode: input.startNode,
            endNode: input.endNode,
            isHighRise: false,
          },
        },
      );

      const route = normalizeRouteResponse(response.data);
      return {
        content: [{ type: "text", text: renderRouteSummary(route) }],
        structuredContent: { ...route },
      };
    } catch (error) {
      return errorResult(error, appliedUserParams);
    }
  };
}
