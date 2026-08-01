import { describe, expect, it, jest } from "@jest/globals";
import type { AxiosInstance } from "axios";

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

describe("indoor-navigation-elevator-query", () => {
  it("requests a personalized simple overview and carries the required user notice", async () => {
    const post = jest.fn(async () => ({
      data: {
        status: "success",
        simple: true,
        transports: [
          { transportId: "ElevNorth", servedStops: ["L3", "L2", "L1", "P1", "P2"] },
          { transportId: "ElevSouth", servedStops: ["L3", "L2", "L1", "LG", "P1", "P2"] },
        ],
      },
    }));
    const handler = createElevatorQueryHandler({ post } as unknown as Pick<AxiosInstance, "post">);

    const result = await handler(input({ userParams: { haveCard: true } }));

    expect(post).toHaveBeenCalledWith(
      "/api/v1/quick-demo-elevators",
      { userParams: { haveCard: true } },
      { params: { buildingName: "indigoBJ", simple: true } },
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
        simple: false,
        transports: [
          {
            transportId: "ElevNorth",
            displayName: "North Elevator",
            servedStops: [{ label: "L3", nodeId: "Level3::north_elevator_hall", location: 3 }],
          },
          {
            transportId: "Unlabelled",
            displayName: null,
            servedStops: [{ label: "L1", nodeId: "Level1::lift", location: 1 }],
          },
        ],
      },
    }));
    const handler = createElevatorQueryHandler({ post } as unknown as Pick<AxiosInstance, "post">);

    const result = await handler(input({ simple: false, transportId: "Unlabelled" }));

    expect(result.structuredContent).toMatchObject({
      status: "success",
      simple: false,
      transports: [{ transportId: "Unlabelled", displayName: null }],
    });
    expect(elevatorQueryOutputSchema.safeParse(result.structuredContent).success).toBe(true);
  });
});
