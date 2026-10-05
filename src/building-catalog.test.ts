import { describe, expect, it, jest } from "@jest/globals";
import type { AxiosInstance } from "axios";

import { loadBuildingCatalog } from "./building-catalog.js";

describe("backend building catalog", () => {
  it("loads the installed inventory instead of a fixed list", async () => {
    const get = jest.fn(async () => ({ data: { status: "success", buildings: ["indigoBJ", "DemoTower"] } }));
    const buildings = await loadBuildingCatalog({ get } as unknown as Pick<AxiosInstance, "get">);

    expect(get).toHaveBeenCalledWith("/api/v1/buildings");
    expect(buildings.map((building) => building.backendBuildingName)).toEqual(["indigoBJ", "DemoTower"]);
  });

  it("accepts an empty installed inventory", async () => {
    const get = jest.fn(async () => ({ data: { status: "success", buildings: [] } }));
    expect(await loadBuildingCatalog({ get } as unknown as Pick<AxiosInstance, "get">)).toEqual([]);
  });

  it.each([
    { status: "error", buildings: ["swfc"] },
    { status: "success", buildings: [""] },
    { status: "success", buildings: ["swfc", "SWFC"] },
    { status: "success" },
  ])("rejects invalid inventories without a hard-coded fallback", async (data) => {
    const get = jest.fn(async () => ({ data }));
    await expect(loadBuildingCatalog({ get } as unknown as Pick<AxiosInstance, "get">))
      .rejects.toThrow("Cannot load the TopoNavi building catalog");
  });

  it("fails clearly when the backend cannot be reached", async () => {
    const get = jest.fn(async () => { throw new Error("connection refused"); });
    await expect(loadBuildingCatalog({ get } as unknown as Pick<AxiosInstance, "get">))
      .rejects.toThrow("TOPONAVI_API_BASE_URL");
  });
});
