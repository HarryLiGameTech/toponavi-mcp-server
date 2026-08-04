import type { AxiosInstance } from "axios";
import { describe, expect, it, jest } from "@jest/globals";
import {
  createPlanRouteHandler,
  deriveNodeIdFallback,
  deriveRouteOverview,
  navigationOutputSchema,
} from "./navigation.js";

function mockClientWith(result: unknown) {
  const post = jest.fn(async (_url: string, _data?: unknown, _config?: unknown) => result);
  return {
    post,
    client: { post } as unknown as Pick<AxiosInstance, "post">,
  };
}

const routeResponse = {
  status: "success",
  path: "legacy node-id path",
  routeOverview: {
    isComplex: false,
    transportCount: 0,
    transferCount: 0,
    transferGraphs: [],
    initialGuidanceThroughStep: null,
  },
  steps: [{
    step: 1,
    type: "Walk",
    graph: "LowerLobby",
    from: "wrong legacy source",
    to: "wrong legacy target",
    namedWaypoints: ["internal_start", "internal_goal"],
    waypoints: [
      {
        nodeId: "internal_start",
        graph: "LowerLobby",
        description: "Retail service elevator hall",
        tags: ["indoor"],
        narration: "explicit",
        isTrivial: false,
        isIntermediate: false,
      },
      {
        nodeId: "internal_goal",
        graph: "LowerLobby",
        description: "Loading bay",
        tags: ["service_area"],
        narration: "explicit",
        isTrivial: false,
        isIntermediate: false,
      },
    ],
    costSeconds: 20,
    tags: ["service_area"],
    requiredActions: ["cross_door"],
    requiredActionEvents: [{
      action: "cross_door",
      from: "internal_start",
      to: "internal_goal",
      graph: "LowerLobby",
    }],
  }],
  deprecations: [{
    field: "steps[].namedWaypoints",
    status: "to-be-deprecated",
    replacement: "steps[].waypoints",
    since: "2026-07-25",
    removalVersion: null,
    message: "Use waypoints",
  }],
  appliedTraversalPreference: {
    routePlanningPreference: "MinimizeTime",
    banTags: ["odor_prone"],
  },
  filesLoaded: 92,
  cacheKey: "6d78c77d",
  fromCache: true,
};

describe("indoor-navigation-path-query handler", () => {
  it("derives cautious user-facing hints from semantic node IDs", () => {
    expect(deriveNodeIdFallback("southwest_corner")).toEqual({
      label: "the southwest corner",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("wacker_junction")).toEqual({
      label: "Wacker junction",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("between_room_312_313")).toEqual({
      label: "between rooms 312 and 313",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("corner_0715")).toEqual({
      label: "a corner",
      kind: "generic_geometry",
    });
    expect(deriveNodeIdFallback("SH_hall")).toEqual({
      label: "a hall",
      kind: "generic_geometry",
    });
    expect(deriveNodeIdFallback("cashier")).toEqual({
      label: "cashier",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("reception_N")).toEqual({
      label: "reception",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("toilet_0715_out")).toEqual({
      label: "toilet",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("sofa_W")).toEqual({
      label: "sofa",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("facade")).toEqual({
      label: "facade",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("room_312")).toEqual({
      label: "Room 312",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("skywalk_booth_2")).toEqual({
      label: "Skywalk Booth 2",
      kind: "semantic_node_id",
    });
    expect(deriveNodeIdFallback("n_3e44fa1b")).toBeUndefined();
  });

  it("uses authoritative metadata instead of semantic node-ID fallbacks", async () => {
    const metadataResponse = JSON.parse(JSON.stringify(routeResponse));
    metadataResponse.steps[0].waypoints[0] = {
      ...metadataResponse.steps[0].waypoints[0],
      nodeId: "cashier_0715",
      displayName: "Main payment desk",
      description: null,
    };
    const { client } = mockClientWith({ data: metadataResponse });
    const result = await createPlanRouteHandler(client)({
      buildingName: "上海环球金融中心",
      startNode: "LowerLobby::cashier_0715",
      endNode: "LowerLobby::internal_goal",
      userParams: {},
      traversalPreference: { routePlanningPreference: "MinimizeTime", banTags: [] },
    });
    const waypoint = (result.structuredContent as any).steps[0].waypoints[0];
    expect(waypoint.displayName).toBe("Main payment desk");
    expect(waypoint.fallbackLabel).toBeUndefined();
    expect((result.structuredContent as any).steps[0].from).toBe("Main payment desk");
  });

  it("includes semantic fallback labels for otherwise trivial intermediate nodes", async () => {
    const semanticResponse = JSON.parse(JSON.stringify(routeResponse));
    semanticResponse.steps[0].waypoints.splice(1, 0, {
      nodeId: "cashier_0715",
      graph: "LowerLobby",
      tags: [],
      narration: null,
      isTrivial: true,
      isIntermediate: true,
    });
    const { client } = mockClientWith({ data: semanticResponse });
    const result = await createPlanRouteHandler(client)({
      buildingName: "swfc",
      startNode: "LowerLobby::internal_start",
      endNode: "LowerLobby::internal_goal",
      userParams: {},
      traversalPreference: { routePlanningPreference: "MinimizeTime", banTags: [] },
    });
    expect(result.content[0].text).toContain("cashier");
  });

  it("derives macro-route transfers and the first-transfer boundary", () => {
    expect(deriveRouteOverview([
      { step: 1, type: "Walk" },
      { step: 2, type: "Transport", toGraph: "Floor91" },
      { step: 3, type: "Walk" },
      { step: 4, type: "Transport", toGraph: "Floor96" },
      { step: 5, type: "Walk" },
      { step: 6, type: "Transport", toGraph: "SkyWalk100" },
      { step: 7, type: "Walk" },
    ])).toEqual({
      isComplex: true,
      transportCount: 3,
      transferCount: 2,
      transferGraphs: ["Floor91", "Floor96"],
      initialGuidanceThroughStep: 2,
    });
  });

  it("validates both successful and failed navigation outputs", () => {
    expect(navigationOutputSchema.safeParse(routeResponse).success).toBe(true);
    expect(navigationOutputSchema.safeParse({
      status: "error",
      code: "DESTINATION_HAS_BANNED_TAG",
      message: "Destination has banned tags",
      details: { conflictingTags: ["staffed"] },
      recoveryHint: "Ask before relaxing the ban.",
      httpStatus: 422,
    }).success).toBe(true);

    expect(navigationOutputSchema.safeParse({
      status: "success",
      code: "DESTINATION_HAS_BANNED_TAG",
      message: "Destination has banned tags",
    }).success).toBe(false);
    expect(navigationOutputSchema.safeParse({
      status: "error",
      path: "route without an error code",
    }).success).toBe(false);
  });

  it("posts traversal preferences and returns structured waypoints", async () => {
    const { client, post } = mockClientWith({ data: routeResponse });
    const handler = createPlanRouteHandler(client);

    const result = await handler({
      buildingName: "swfc",
      startNode: "LowerLobby::internal_start",
      endNode: "LowerLobby::internal_goal",
      userParams: { haveStaffCard: true },
      traversalPreference: {
        routePlanningPreference: "MinimizeTime",
        banTags: ["odor_prone", "odor_prone"],
      },
    });

    expect(post).toHaveBeenCalledWith(
      "/api/v1/quick-demo-navigation",
      {
        userParams: {
          haveStaffCard: true,
          haveManagementCard: false,
          haveRoomKey: false,
          id: 0,
          aggregatedWeight: 0,
        },
        traversalPreference: {
          routePlanningPreference: "MinimizeTime",
          banTags: ["odor_prone"],
        },
      },
      {
        params: {
          buildingName: "swfc",
          startNode: "LowerLobby::internal_start",
          endNode: "LowerLobby::internal_goal",
        },
      },
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as any;
    expect(structured.steps[0].namedWaypoints).toBeUndefined();
    expect(structured.steps[0].from).toBe("Retail service elevator hall");
    expect(structured.steps[0].to).toBe("Loading bay");
    expect(structured.steps[0].requiredActions).toEqual(["cross_door"]);
    expect(structured.routeOverview).toEqual({
      isComplex: false,
      transportCount: 0,
      transferCount: 0,
      transferGraphs: [],
      initialGuidanceThroughStep: null,
    });
    expect(result.content[0].text).not.toContain("internal_start");
    expect(result.content[0].text).toContain("cross_door");
  });

  it("preserves recoverable backend business errors", async () => {
    const post = jest.fn(async () => {
      throw {
        isAxiosError: true,
        message: "Request failed with status code 422",
        response: {
          status: 422,
          data: {
            status: "error",
            code: "DESTINATION_HAS_BANNED_TAG",
            message: "Destination has banned tags",
            details: {
              nodeIdentifier: "LowerLobby::cafe",
              conflictingTags: ["staffed"],
            },
          },
        },
      };
    });
    const handler = createPlanRouteHandler(
      { post } as unknown as Pick<AxiosInstance, "post">,
    );

    const result = await handler({
      buildingName: "swfc",
      startNode: "LowerLobby::gate_1",
      endNode: "LowerLobby::cafe",
      userParams: {},
      traversalPreference: {
        routePlanningPreference: "MinimizeTime",
        banTags: ["staffed"],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "error",
      code: "DESTINATION_HAS_BANNED_TAG",
      httpStatus: 422,
      details: {
        conflictingTags: ["staffed"],
      },
    });
  });

  it("distinguishes backend unavailability from route errors", async () => {
    const post = jest.fn(async () => {
      throw {
        isAxiosError: true,
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED",
      };
    });
    const handler = createPlanRouteHandler(
      { post } as unknown as Pick<AxiosInstance, "post">,
    );

    const result = await handler({
      buildingName: "swfc",
      startNode: "LowerLobby::gate_1",
      endNode: "LowerLobby::cafe",
      userParams: {},
      traversalPreference: {
        routePlanningPreference: "MinimizeTime",
        banTags: [],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "TOPONAVI_BACKEND_UNAVAILABLE",
    });
  });

  it("normalizes legacy no-route HTTP 500 responses as parameter business failures", async () => {
    const post = jest.fn(async () => {
      throw {
        isAxiosError: true,
        message: "Request failed with status code 500",
        response: {
          status: 500,
          data: {
            exceptionType: "java.lang.RuntimeException",
            error: "No intra-map route found within high-rise building LowerLobby from gate_2 to L1_hall",
          },
        },
      };
    });
    const handler = createPlanRouteHandler(
      { post } as unknown as Pick<AxiosInstance, "post">,
    );

    const result = await handler({
      buildingName: "swfc",
      startNode: "LowerLobby::gate_2",
      endNode: "LowerLobby::L1_hall",
      userParams: { haveStaffCard: false },
      traversalPreference: {
        routePlanningPreference: "MinimizeTime",
        banTags: [],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "error",
      code: "NO_ROUTE_FOR_USER_PARAMS",
      message: "No route is available with the supplied access and capability parameters.",
      httpStatus: 500,
      details: {
        userParams: {
          haveStaffCard: false,
          haveManagementCard: false,
          haveRoomKey: false,
          id: 0,
          aggregatedWeight: 0,
        },
      },
    });
    expect((result.structuredContent as any).recoveryHint).not.toContain("backend availability");
  });
});
