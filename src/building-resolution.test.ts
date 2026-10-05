import { describe, expect, it } from "@jest/globals";

import {
  BuildingResolutionError,
  createBuildingCatalog,
  describeBuildings,
  resolveBackendBuildingName,
  resolveBuildingName,
} from "./building-resolution.js";

describe("building name resolution", () => {
  const buildings = createBuildingCatalog(["indigoBJ", "swfc", "nbc4", "trent"]);

  it.each([
    ["北京颐堤港", "indigoBJ", "indigoBJ"],
    ["颐堤港", "indigoBJ", "indigoBJ"],
    ["上海环球金融中心", "SWFC", "swfc"],
    ["环球", "SWFC", "swfc"],
    ["宁波中心大厦", "NBC4", "nbc4"],
    ["宁波中心", "NBC4", "nbc4"],
    ["宁波诺丁汉大学行政楼", "trent", "trent"],
    ["宁诺主楼", "trent", "trent"],
  ])("resolves %s to %s", (query, buildingId, backendBuildingName) => {
    expect(resolveBuildingName(query, buildings)).toMatchObject({
      status: "resolved",
      buildingId,
      backendBuildingName,
    });
  });

  it("matches a known name inside a natural Chinese request", () => {
    expect(resolveBuildingName("请带我去颐堤港一层北门", buildings)).toMatchObject({
      status: "resolved",
      buildingId: "indigoBJ",
    });
    expect(resolveBackendBuildingName("我现在在宁诺主楼里面", buildings)).toBe("trent");
  });

  it("matches canonical IDs without depending on letter case", () => {
    expect(resolveBackendBuildingName("SWFC", buildings)).toBe("swfc");
    expect(resolveBackendBuildingName("NBC4", buildings)).toBe("nbc4");
    expect(resolveBackendBuildingName("INDIGOBJ", buildings)).toBe("indigoBJ");
  });

  it("does not silently choose when multiple buildings are mentioned", () => {
    const resolution = resolveBuildingName("从颐堤港到环球", buildings);
    expect(resolution).toMatchObject({
      status: "ambiguous",
      candidates: [
        { buildingId: "indigoBJ" },
        { buildingId: "SWFC" },
      ],
    });
    expect(() => resolveBackendBuildingName("中心", buildings)).toThrow(BuildingResolutionError);
  });

  it("returns not_found for unknown or overly broad one-character input", () => {
    expect(resolveBuildingName("上海中心大厦", buildings)).toMatchObject({ status: "not_found" });
    expect(resolveBuildingName("楼", buildings)).toMatchObject({ status: "not_found" });
  });

  it.each(["GalleriaBJ", "凤凰汇", "CWTC", "国贸"])("does not advertise or resolve absent %s", (name) => {
    expect(resolveBuildingName(name, buildings)).toMatchObject({ status: "not_found" });
    expect(describeBuildings(buildings)).not.toContain(name);
  });

  it("uses the same deployment inventory for descriptions and resolution", () => {
    const deployed = createBuildingCatalog(["DemoTower", "INDIGOBJ", "A"]);
    const description = describeBuildings(deployed);
    expect(description).toContain("DemoTower");
    expect(description).toContain("北京颐堤港 (INDIGOBJ)");
    expect(description).not.toContain("SWFC");
    expect(resolveBackendBuildingName("demotower", deployed)).toBe("DemoTower");
    expect(resolveBackendBuildingName("颐堤港", deployed)).toBe("INDIGOBJ");
    expect(resolveBackendBuildingName("A", deployed)).toBe("A");
    expect(resolveBuildingName("mall", deployed).status).toBe("not_found");
    expect(resolveBuildingName("swfc", deployed).status).toBe("not_found");
  });

  it("does not fall back to known aliases for an empty deployment", () => {
    expect(resolveBuildingName("环球", []).status).toBe("not_found");
    expect(describeBuildings([])).toContain("Installed map projects: none");
  });

  it("rejects ambiguous case variants in the backend inventory", () => {
    expect(() => createBuildingCatalog(["swfc", "SWFC"])).toThrow("unique ignoring case");
  });
});
