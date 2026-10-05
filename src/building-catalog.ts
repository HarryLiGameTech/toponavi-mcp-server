import type { AxiosInstance } from "axios";
import { z } from "zod/v4";

import { createBuildingCatalog, type BuildingDefinition } from "./building-resolution.js";

const buildingCatalogResponseSchema = z.object({
  status: z.literal("success"),
  buildings: z.array(z.string().trim().min(1)),
});

export async function loadBuildingCatalog(
  httpClient: Pick<AxiosInstance, "get">,
): Promise<readonly BuildingDefinition[]> {
  try {
    const response = await httpClient.get("/api/v1/buildings");
    return createBuildingCatalog(buildingCatalogResponseSchema.parse(response.data).buildings);
  } catch {
    throw new Error("Cannot load the TopoNavi building catalog. Check TOPONAVI_API_BASE_URL and the backend's /api/v1/buildings endpoint.");
  }
}
