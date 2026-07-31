import { describe, expect, it, jest } from "@jest/globals";
import type { AxiosInstance } from "axios";

import {
  createResolvePlaceHandler,
  resolvePlaceFromCatalog,
  type PlaceResolutionInput,
} from "./place-resolution.js";

const catalog = {
  "Level2::toilet_north": {
    tags: ["indoor", "toilet"],
    positions: 8,
  },
  "Level3::toilet_north": {
    tags: ["indoor", "toilet"],
    positions: 8,
  },
  "Level3::toilet_south": {
    tags: ["indoor", "toilet"],
    positions: 8,
  },
  "Level3::toilet_north_link_end": {
    tags: ["indoor"],
  },
  "Level3::shop_301": {
    tags: ["indoor", "shop"],
    shop_name: "MUJI 无印良品",
    shop_category: "Supermarket",
  },
  "LowerGround::shop_036": {
    tags: ["indoor", "shop"],
    shop_name: "STARBUCKS 星巴克",
    shop_category: "Full-service cafe",
  },
};

function input(overrides: Partial<PlaceResolutionInput>): PlaceResolutionInput {
  return {
    buildingName: "indigoBJ",
    rawQuery: "Starbucks",
    userParams: {},
    maxCandidates: 8,
    ...overrides,
  };
}

describe("indoor-navigation-place-resolve", () => {
  it("resolves a unique shop through authoritative shop metadata", () => {
    const result = resolvePlaceFromCatalog(
      input({ placeHint: "Starbucks" }),
      catalog,
    );

    expect(result).toMatchObject({
      status: "resolved",
      place: {
        nodeId: "LowerGround::shop_036",
        graph: "LowerGround",
        displayName: "STARBUCKS 星巴克",
        matchBasis: "shop_name",
        matchedText: "STARBUCKS 星巴克",
      },
    });
  });

  it("resolves the floor first and preserves multiple toilet candidates", () => {
    const result = resolvePlaceFromCatalog(
      input({
        rawQuery: "the toilet on floor 3",
        submapHint: "floor 3",
        placeHint: "toilet",
      }),
      catalog,
    );

    expect(result).toMatchObject({
      status: "ambiguous",
      resolvedSubmap: {
        graphId: "Level3",
        confidence: 1,
      },
      clarification: {
        reason: "place_ambiguous",
      },
    });
    expect(result.candidates?.map((candidate) => candidate.nodeId)).toEqual([
      "Level3::toilet_north",
      "Level3::toilet_south",
    ]);
    expect(result.candidates?.every((candidate) => candidate.graph === "Level3")).toBe(true);
  });

  it("uses a clear semantic node ID only when metadata is absent", () => {
    const result = resolvePlaceFromCatalog(
      input({
        rawQuery: "the north toilet on floor 3",
        submapHint: "3rd floor",
        placeHint: "north toilet",
      }),
      catalog,
    );

    expect(result).toMatchObject({
      status: "resolved",
      resolvedSubmap: {
        graphId: "Level3",
      },
      place: {
        nodeId: "Level3::toilet_north",
        displayName: "Toilet North",
        matchBasis: "semantic_node_id",
      },
    });
  });

  it("returns not_found instead of inventing a graph", () => {
    const result = resolvePlaceFromCatalog(
      input({
        rawQuery: "the toilet on floor 99",
        submapHint: "floor 99",
        placeHint: "toilet",
      }),
      catalog,
    );

    expect(result).toMatchObject({
      status: "not_found",
      message: "No compiled submap matches 'floor 99'.",
    });
  });

  it("queries the parameter-specific compiled node catalog", async () => {
    const post = jest.fn(async () => ({
      data: {
        status: "success",
        allNodes: catalog,
      },
    }));
    const handler = createResolvePlaceHandler(
      { post } as unknown as Pick<AxiosInstance, "post">,
    );

    const result = await handler(input({
      placeHint: "Starbucks",
      userParams: { haveStaffCard: false },
    }));

    expect(post).toHaveBeenCalledWith(
      "/api/v1/quick-demo-all-available-nodes",
      { userParams: { haveStaffCard: false } },
      {
        params: {
          buildingName: "indigoBJ",
          withNodesAttributes: "true",
        },
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      status: "resolved",
      place: {
        nodeId: "LowerGround::shop_036",
      },
    });
    expect(result.content[0]?.text).toContain("never speak the nodeId");
  });
});
