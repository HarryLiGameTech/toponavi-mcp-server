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
  "Level1::garden_north_gate": {
    tags: ["indoor", "automatic_door"],
    aliases: ["北门", "花园北门", "L1北门", "north gate"],
  },
  "Level3::shop_359": {
    tags: ["indoor", "shop"],
    shop_name: "麦当劳",
    shop_category: "Fast-food restaurant",
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

  it("extracts L1, preserves its scope, and resolves the configured Chinese gate alias deterministically", () => {
    const results = Array.from({ length: 10 }, () => resolvePlaceFromCatalog(
      input({
        rawQuery: "indigoBJ L1 的北门",
        placeHint: undefined,
      }),
      {
        ...catalog,
        "Level2::north_gate": {
          tags: ["indoor", "gate"],
          aliases: ["北门", "north gate"],
        },
      },
    ));

    for (const result of results) {
      expect(result).toMatchObject({
        status: "resolved",
        query: {
          submapHint: "Level1",
          placeHint: "北门",
        },
        resolvedSubmap: {
          graphId: "Level1",
        },
        place: {
          nodeId: "Level1::garden_north_gate",
          matchBasis: "alias",
          matchedText: "北门",
        },
      });
    }
  });

  it("resolves the destination floor and Chinese shop name deterministically", () => {
    const results = Array.from({ length: 10 }, () => resolvePlaceFromCatalog(
      input({
        rawQuery: "L3 的麦当劳",
        placeHint: undefined,
      }),
      catalog,
    ));

    expect(results.every((result) =>
      result.status === "resolved" && result.place?.nodeId === "Level3::shop_359"
    )).toBe(true);
  });

  it("uses deterministic translation aliases only after direct scoped matching finds nothing", () => {
    const result = resolvePlaceFromCatalog(
      input({
        rawQuery: "L1 的北门",
        submapHint: "L1",
        placeHint: "北门",
      }),
      {
        "Level1::garden_north_gate": { tags: ["indoor", "automatic_door"] },
        "Level2::north_gate": { tags: ["indoor", "gate"] },
      },
    );

    expect(result).toMatchObject({
      status: "resolved",
      resolvedSubmap: { graphId: "Level1" },
      place: {
        nodeId: "Level1::garden_north_gate",
        matchBasis: "query_alias:semantic_node_id",
      },
    });
  });

  it("returns all same-floor translated candidates as ambiguous", () => {
    const result = resolvePlaceFromCatalog(
      input({
        rawQuery: "L1 的北门",
        submapHint: "L1",
        placeHint: "北门",
      }),
      {
        "Level1::north_gate_a": { tags: ["indoor", "gate"] },
        "Level1::north_gate_b": { tags: ["indoor", "gate"] },
        "Level2::north_gate": { tags: ["indoor", "gate"] },
      },
    );

    expect(result).toMatchObject({
      status: "ambiguous",
      clarification: { reason: "place_ambiguous" },
    });
    expect(result.candidates?.map((candidate) => candidate.nodeId)).toEqual([
      "Level1::north_gate_a",
      "Level1::north_gate_b",
    ]);
  });

  it("returns cross-floor aliases as ambiguous when no floor is supplied", () => {
    const result = resolvePlaceFromCatalog(
      input({
        rawQuery: "北门",
        placeHint: "北门",
      }),
      {
        "Level1::north_gate": { tags: ["indoor", "gate"], aliases: ["北门"] },
        "Level2::north_gate": { tags: ["indoor", "gate"], aliases: ["北门"] },
      },
    );

    expect(result.status).toBe("ambiguous");
    expect(result.candidates?.map((candidate) => candidate.graph)).toEqual(["Level1", "Level2"]);
  });

  it("returns not_found after direct and equivalent scoped searches find no candidates", () => {
    const result = resolvePlaceFromCatalog(
      input({
        rawQuery: "L1 的游泳池",
        submapHint: "L1",
        placeHint: "游泳池",
      }),
      catalog,
    );

    expect(result).toMatchObject({
      status: "not_found",
      resolvedSubmap: { graphId: "Level1" },
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
      buildingName: "颐堤港",
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
