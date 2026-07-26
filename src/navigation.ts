import axios, { type AxiosInstance } from "axios";
import { z } from "zod/v4";

const routePlanningPreferenceSchema = z.enum([
  "MinimizeTime",
  "MinimizeTransfers",
  "MinimizePhysicalDemands",
]);

const userParamValueSchema = z.union([z.boolean(), z.number(), z.string()]);

export const navigationInputSchema = z.object({
  buildingName: z.string().trim().min(1).default("swfc").describe(
    "Backend example-building identifier. Use 'swfc' for Shanghai World Financial Center.",
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

function waypointLabel(waypoint: z.infer<typeof waypointSchema>): string {
  return waypoint.shopName
    || waypoint.facilityName
    || waypoint.description
    || "an unnamed location";
}

function normalizeRouteResponse(value: unknown): RouteResponse {
  const raw = rawRouteResponseSchema.parse(value);
  const steps = raw.steps.map((step) => {
    const normalized = { ...step } as Record<string, unknown>;
    delete normalized.namedWaypoints;

    const firstWaypoint = step.waypoints.at(0);
    const lastWaypoint = step.waypoints.at(-1);
    if (firstWaypoint) normalized.from = waypointLabel(firstWaypoint);
    if (lastWaypoint) normalized.to = waypointLabel(lastWaypoint);

    return routeStepOutputSchema.parse(normalized);
  });

  return routeResponseOutputSchema.parse({ ...raw, steps });
}

function visibleWaypointLabels(step: z.infer<typeof routeStepOutputSchema>): string[] {
  return step.waypoints
    .filter((waypoint, index, all) => {
      const isEndpoint = index === 0 || index === all.length - 1;
      if (isEndpoint) return true;
      if (waypoint.narration === "implicit") return false;
      return waypoint.narration === "explicit" || !waypoint.isTrivial;
    })
    .map(waypointLabel)
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
    ...lines,
    "Use structured waypoints for narration. Do not expose nodeId as a user-facing place name. Always communicate required actions.",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResult(error: unknown): NavigationToolResult {
  if (axios.isAxiosError(error)) {
    const responseData = isRecord(error.response?.data) ? error.response.data : {};
    const httpStatus = error.response?.status;
    const code = typeof responseData.code === "string"
      ? responseData.code
      : httpStatus
        ? `TOPONAVI_HTTP_${httpStatus}`
        : "TOPONAVI_BACKEND_UNAVAILABLE";
    const message = typeof responseData.message === "string"
      ? responseData.message
      : error.message || "TopoNavi backend request failed";
    const details = isRecord(responseData.details) ? responseData.details : {};
    const recoveryHint = code === "DESTINATION_HAS_BANNED_TAG"
      ? "The destination conflicts with the requested banTags. Ask before relaxing the ban."
      : code === "NO_ROUTE_WITH_BAN_TAGS"
        ? "No route remains under the requested banTags. Ask whether the user wants to relax one of them."
        : code === "TRAVERSAL_PREFERENCE_NOT_IMPLEMENTED"
          ? "Do not retry with the unsupported preference fields."
          : "Check the request and backend availability before retrying.";

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
    try {
      const input = navigationInputSchema.parse(value);
      const banTags = [...new Set(input.traversalPreference.banTags)];
      const response = await httpClient.post(
        "/api/v1/quick-demo-navigation",
        {
          userParams: resolveUserParams(input),
          traversalPreference: {
            routePlanningPreference: input.traversalPreference.routePlanningPreference,
            banTags,
          },
        },
        {
          params: {
            buildingName: input.buildingName,
            startNode: input.startNode,
            endNode: input.endNode,
          },
        },
      );

      const route = normalizeRouteResponse(response.data);
      return {
        content: [{ type: "text", text: renderRouteSummary(route) }],
        structuredContent: { ...route },
      };
    } catch (error) {
      return errorResult(error);
    }
  };
}
