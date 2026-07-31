import { describe, expect, it, jest } from "@jest/globals";
import type { AxiosInstance } from "axios";

import {
  createFilteredQueryHandler,
  type FilteredQueryInput,
} from "./filtered-query.js";

const nodes = {
  "Level3::toilet_north": {
    tags: ["indoor", "toilet"],
  },
  "LowerGround::shop_036": {
    tags: ["indoor", "shop"],
    shop_name: "STARBUCKS 星巴克",
    shop_category: "Full-service cafe",
  },
  "Level1::shop_105": {
    tags: ["indoor", "shop"],
    shop_name: "MANNER COFFEE",
    shop_category: "Beverage shop",
  },
  "Level3::shop_301": {
    tags: ["indoor", "shop"],
    shop_name: "MUJI 无印良品",
    shop_category: "Supermarket",
  },
  "Level3::bridge_a": {
    tags: ["indoor", "bridge"],
    display_name: "Atrium bridge entrance",
  },
  "Level3::bridge_b": {
    tags: ["indoor", "bridge"],
    display_name: "Atrium bridge exit",
  },
  "Level3::near_photo_spot": {
    tags: ["indoor"],
    display_name: "Atrium window",
  },
  "Level3::near_lounge": {
    tags: ["indoor"],
    display_name: "Lounge",
  },
} as const;

const edges = [
  {
    graph: "Level3",
    from: "bridge_a",
    to: "bridge_b",
    costSeconds: 10,
    tags: ["indoor", "bridge"],
    requiredActions: ["cross_bridge"],
    attributes: { action_required: ["cross_bridge"] },
  },
  {
    graph: "Level3",
    from: "bridge_b",
    to: "bridge_a",
    costSeconds: 10,
    tags: ["indoor", "bridge"],
    requiredActions: ["cross_bridge"],
    attributes: { action_required: ["cross_bridge"] },
  },
  {
    graph: "Level3",
    from: "bridge_b",
    to: "near_lounge",
    costSeconds: 4,
    tags: ["indoor"],
    requiredActions: ["cross_door"],
    attributes: { action_required: ["cross_door"] },
  },
];

function input(overrides: Partial<FilteredQueryInput>): FilteredQueryInput {
  return {
    buildingName: "indigoBJ",
    rawQuery: "What shops do we have?",
    filters: { tag: ["shops"] },
    userParams: {},
    limit: 10,
    ...overrides,
  };
}

function mockHttpClient() {
  const post = jest.fn(async (url: string, _body: unknown, config?: { params?: Record<string, unknown> }) => {
    if (url.endsWith("quick-demo-all-available-nodes")) {
      return { data: { status: "success", allNodes: nodes } };
    }
    if (url.endsWith("quick-demo-all-available-edges")) {
      return { data: { status: "success", edges } };
    }
    if (url.endsWith("quick-demo-proximity-nodes")) {
      const source = config?.params?.nodeIdentifier;
      const proximityNodes = source === "Level3::bridge_a"
        ? [
            {
              nodeIdentifier: "Level3::near_photo_spot",
              graph: "Level3",
              nodeId: "near_photo_spot",
              costSeconds: 7,
              attributes: nodes["Level3::near_photo_spot"],
              edgeTags: ["indoor"],
              requiredActions: [],
            },
            {
              nodeIdentifier: "Level3::bridge_b",
              graph: "Level3",
              nodeId: "bridge_b",
              costSeconds: 10,
              attributes: nodes["Level3::bridge_b"],
              edgeTags: ["indoor", "bridge"],
              requiredActions: ["cross_bridge"],
            },
          ]
        : [
            {
              nodeIdentifier: "Level3::near_lounge",
              graph: "Level3",
              nodeId: "near_lounge",
              costSeconds: 4,
              attributes: nodes["Level3::near_lounge"],
              edgeTags: ["indoor"],
              requiredActions: [],
            },
            {
              nodeIdentifier: "Level3::near_photo_spot",
              graph: "Level3",
              nodeId: "near_photo_spot",
              costSeconds: 5,
              attributes: nodes["Level3::near_photo_spot"],
              edgeTags: ["indoor"],
              requiredActions: [],
            },
          ];
      return { data: { status: "success", proximityNodes } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  return {
    post,
    client: { post } as unknown as Pick<AxiosInstance, "post">,
  };
}

describe("indoor-navigation-filtered-query", () => {
  it("ANDs fields and ORs fuzzy values inside shop_category", async () => {
    const { client } = mockHttpClient();
    const handler = createFilteredQueryHandler(client);

    const result = await handler(input({
      rawQuery: "What coffee shops do we have?",
      filters: {
        tag: ["shops"],
        shop_category: ["coffee"],
      },
    }));

    expect(result.structuredContent).toMatchObject({
      status: "success",
      entityType: "node",
      appliedFilters: {
        tag: ["shop"],
        shop_category: ["Beverage shop", "Full-service cafe"],
      },
      totalMatches: 2,
    });
    expect((result.structuredContent?.nodes as Array<{ displayName: string }>).map((node) => node.displayName))
      .toEqual(["MANNER COFFEE", "STARBUCKS 星巴克"]);
  });

  it("maps bathroom language to the compiled toilet tag", async () => {
    const { client } = mockHttpClient();
    const handler = createFilteredQueryHandler(client);

    const result = await handler(input({
      rawQuery: "Where is a bathroom?",
      filters: { tag: ["bathroom"] },
    }));

    expect(result.structuredContent).toMatchObject({
      status: "success",
      appliedFilters: { tag: ["toilet"] },
      totalMatches: 1,
      nodes: [{ nodeId: "Level3::toilet_north" }],
    });
  });

  it("finds bridge crossings and adds direct neighbors ordered by cost", async () => {
    const { client, post } = mockHttpClient();
    const handler = createFilteredQueryHandler(client);

    const result = await handler(input({
      rawQuery: "Where can I take a photo when walking thru the bridge?",
      filters: { action_required: ["walk thru the bridge"] },
    }));

    expect(result.structuredContent).toMatchObject({
      status: "success",
      entityType: "edge",
      appliedFilters: { action_required: ["cross_bridge"] },
      totalMatches: 1,
      edges: [{
        fromPlace: "Atrium bridge entrance",
        toPlace: "Atrium bridge exit",
        bidirectional: true,
        proximityNodes: [
          { nodeIdentifier: "Level3::near_lounge", costSeconds: 4 },
          { nodeIdentifier: "Level3::near_photo_spot", costSeconds: 5 },
        ],
      }],
    });
    expect(post.mock.calls.filter(([url]) => String(url).endsWith("quick-demo-proximity-nodes")))
      .toHaveLength(2);
  });

  it("requires a second call for interpretations below 50 percent", async () => {
    const { client, post } = mockHttpClient();
    const handler = createFilteredQueryHandler(client);

    const first = await handler(input({
      rawQuery: "Where is the elevated scenic passage?",
      filters: { action_required: ["elevated scenic passage"] },
    }));

    expect(first.structuredContent).toMatchObject({
      status: "needs_interpretation",
      entityType: "edge",
      interpretations: [{
        field: "action_required",
        input: "elevated scenic passage",
      }],
    });
    expect(post.mock.calls.filter(([url]) => String(url).endsWith("quick-demo-proximity-nodes")))
      .toHaveLength(0);

    const second = await handler(input({
      rawQuery: "Where is the elevated scenic passage?",
      filters: { action_required: ["cross_bridge"] },
    }));

    expect(second.structuredContent).toMatchObject({
      status: "success",
      appliedFilters: { action_required: ["cross_bridge"] },
      totalMatches: 1,
    });
  });

  it("rejects node-only and edge-only fields in one query", async () => {
    const { client, post } = mockHttpClient();
    const handler = createFilteredQueryHandler(client);

    const result = await handler(input({
      filters: {
        shop_category: ["coffee"],
        action_required: ["cross_bridge"],
      },
    }));

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "error",
        code: "INCOMPATIBLE_FILTER_FIELDS",
      },
    });
    expect(post).not.toHaveBeenCalled();
  });
});
