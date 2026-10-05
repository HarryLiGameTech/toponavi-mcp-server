import { describe, expect, it, jest } from "@jest/globals";
import type { AxiosInstance } from "axios";

import { createBuildingCatalog } from "./building-resolution.js";
import {
  createElevatorQueryHandler,
  elevatorQueryOutputSchema,
  type ElevatorQueryInput,
} from "./elevator-query.js";

function input(overrides: Partial<ElevatorQueryInput> = {}): ElevatorQueryInput {
  return {
    buildingName: "indigoBJ",
    simple: true,
    userParams: {},
    ...overrides,
  };
}

const buildings = createBuildingCatalog(["indigoBJ", "swfc", "nbc4", "trent"]);

describe("indoor-navigation-elevator-query", () => {
  it("requests a personalized simple overview and carries the required user notice", async () => {
    const post = jest.fn(async () => ({
      data: {
        status: "success",
        inDetail: false,
        transports: [
          { transportId: "ElevNorth", type: "Elevator", displayName: null, params: { capacity: 12 }, stations: ["L3", "L2", "L1", "P1", "P2"].map(label => ({ label, nodeId: `${label}::lift` })) },
          { transportId: "ElevSouth", type: "Elevator", displayName: null, params: {}, stations: ["L3", "L2", "L1", "LG", "P1", "P2"].map(label => ({ label, nodeId: `${label}::lift` })) },
        ],
      },
    }));
    const handler = createElevatorQueryHandler(buildings, { post } as unknown as Pick<AxiosInstance, "post">);

    const result = await handler(input({ userParams: { haveCard: true } }));

    expect(post).toHaveBeenCalledWith(
      "/api/v1/buildings/indigoBJ/transports/query",
      { userParams: { haveCard: true }, inDetail: false, selection: { types: ["Elevator"] } },
    );
    expect(result.structuredContent).toMatchObject({
      status: "success",
      simple: true,
      requiredUserNotice: expect.stringContaining("reference only"),
    });
    expect(elevatorQueryOutputSchema.safeParse(result.structuredContent).success).toBe(true);
  });

  it("scopes a full follow-up and preserves an absent displayName as null", async () => {
    const post = jest.fn(async () => ({
      data: {
        status: "success",
        inDetail: true,
        transports: [
          {
            transportId: "ElevNorth",
            displayName: "North Elevator",
            type: "Elevator", params: {},
            stations: [{ label: "L3", nodeId: "Level3::north_elevator_hall", location: 3 }],
          },
          {
            transportId: "Unlabelled",
            displayName: null,
            type: "Elevator", params: {},
            stations: [{ label: "L1", nodeId: "Level1::lift", location: 1 }],
          },
        ],
      },
    }));
    const handler = createElevatorQueryHandler(buildings, { post } as unknown as Pick<AxiosInstance, "post">);

    const result = await handler(input({ simple: false, transportId: "Unlabelled" }));

    expect(result.structuredContent).toMatchObject({
      status: "success",
      simple: false,
      transports: [{ transportId: "Unlabelled", displayName: null }],
    });
    expect(elevatorQueryOutputSchema.safeParse(result.structuredContent).success).toBe(true);
  });
});
