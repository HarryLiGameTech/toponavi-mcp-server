import { describe, expect, it } from "@jest/globals";

import {
  BuildingResolutionError,
  resolveBackendBuildingName,
  resolveBuildingName,
} from "./building-resolution.js";

describe("building name resolution", () => {
  it.each([
    ["北京颐堤港", "indigoBJ", "indigoBJ"],
    ["颐堤港", "indigoBJ", "indigoBJ"],
    ["北京凤凰汇", "GalleriaBJ", "GalleriaBJ"],
    ["凤凰汇", "GalleriaBJ", "GalleriaBJ"],
    ["中国国际贸易中心", "CWTC", "CWTC"],
    ["国贸", "CWTC", "CWTC"],
    ["上海环球金融中心", "SWFC", "swfc"],
    ["环球", "SWFC", "swfc"],
    ["宁波中心大厦", "NBC4", "nbc4"],
    ["宁波中心", "NBC4", "nbc4"],
    ["宁波诺丁汉大学行政楼", "trent", "trent"],
    ["宁诺主楼", "trent", "trent"],
  ])("resolves %s to %s", (query, buildingId, backendBuildingName) => {
    expect(resolveBuildingName(query)).toMatchObject({
      status: "resolved",
      buildingId,
      backendBuildingName,
    });
  });

  it("matches a known name inside a natural Chinese request", () => {
    expect(resolveBuildingName("请带我去颐堤港一层北门")).toMatchObject({
      status: "resolved",
      buildingId: "indigoBJ",
    });
    expect(resolveBackendBuildingName("我现在在宁诺主楼里面")).toBe("trent");
  });

  it("matches canonical IDs without depending on letter case", () => {
    expect(resolveBackendBuildingName("swfc")).toBe("swfc");
    expect(resolveBackendBuildingName("nbc4")).toBe("nbc4");
    expect(resolveBackendBuildingName("galleriabj")).toBe("GalleriaBJ");
  });

  it("does not silently choose when multiple buildings are mentioned", () => {
    const resolution = resolveBuildingName("从颐堤港到凤凰汇");
    expect(resolution).toMatchObject({
      status: "ambiguous",
      candidates: [
        { buildingId: "indigoBJ" },
        { buildingId: "GalleriaBJ" },
      ],
    });
    expect(() => resolveBackendBuildingName("北京")).toThrow(BuildingResolutionError);
  });

  it("returns not_found for unknown or overly broad one-character input", () => {
    expect(resolveBuildingName("上海中心大厦")).toMatchObject({ status: "not_found" });
    expect(resolveBuildingName("楼")).toMatchObject({ status: "not_found" });
  });
});
