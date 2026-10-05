export type BuildingDefinition = {
  buildingId: string;
  backendBuildingName: string;
  displayName: string;
  aliases: readonly string[];
};

export type ResolvedBuilding = BuildingDefinition & {
  status: "resolved";
  query: string;
  matchedAliases: string[];
};

export type BuildingResolution = ResolvedBuilding | {
  status: "ambiguous" | "not_found";
  query: string;
  candidates: Array<Pick<BuildingDefinition, "buildingId" | "displayName">>;
};

export const BUILDING_NAME_INPUT_DESCRIPTION = [
  "An installed building ID, known Chinese name, abbreviation, or natural phrase containing one.",
  "Available buildings are supplied by the configured TopoNavi backend.",
].join(" ");

const KNOWN_BUILDINGS: readonly BuildingDefinition[] = [
  {
    buildingId: "indigoBJ",
    backendBuildingName: "indigoBJ",
    displayName: "北京颐堤港",
    aliases: ["北京颐堤港", "颐堤港", "indigoBJ"],
  },
  {
    buildingId: "GalleriaBJ",
    backendBuildingName: "GalleriaBJ",
    displayName: "北京凤凰汇",
    aliases: ["北京凤凰汇", "凤凰汇", "GalleriaBJ"],
  },
  {
    buildingId: "CWTC",
    backendBuildingName: "CWTC",
    displayName: "中国国际贸易中心",
    aliases: ["中国国际贸易中心", "国贸中心", "中国国贸", "北京国贸", "国贸", "CWTC"],
  },
  {
    buildingId: "SWFC",
    backendBuildingName: "swfc",
    displayName: "上海环球金融中心",
    aliases: ["上海环球金融中心", "环球金融中心", "上海环球", "环球", "SWFC"],
  },
  {
    buildingId: "NBC4",
    backendBuildingName: "nbc4",
    displayName: "宁波中心大厦",
    aliases: ["宁波中心大厦", "宁波中心", "NBC4"],
  },
  {
    buildingId: "trent",
    backendBuildingName: "trent",
    displayName: "宁波诺丁汉大学行政楼",
    aliases: [
      "宁波诺丁汉大学行政楼",
      "宁波诺丁汉大学主楼",
      "宁诺行政楼",
      "宁诺主楼",
      "宁诺",
      "trent",
    ],
  },
] as const;

export function createBuildingCatalog(names: readonly string[]): readonly BuildingDefinition[] {
  const uniqueNames = new Set(names.map((name) => name.toLowerCase()));
  if (uniqueNames.size !== names.length) throw new Error("Backend building names must be unique ignoring case.");

  return names.map((name) => {
    const known = KNOWN_BUILDINGS.find((building) => building.backendBuildingName.toLowerCase() === name.toLowerCase());
    return known
      ? { ...known, backendBuildingName: name }
      : { buildingId: name, backendBuildingName: name, displayName: name, aliases: [name] };
  });
}

export function describeBuildings(buildings: readonly BuildingDefinition[]): string {
  const available = buildings.map((building) => `${building.displayName} (${building.backendBuildingName})`).join(", ");
  return `${BUILDING_NAME_INPUT_DESCRIPTION} Installed map projects: ${available || "none"}. `
    + "Compilation and routing depend on map validity and supplied user parameters.";
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function isUsefulPartial(value: string): boolean {
  return /[\p{Script=Han}]/u.test(value) ? value.length >= 2 : value.length >= 3;
}

export function resolveBuildingName(value: string, buildings: readonly BuildingDefinition[]): BuildingResolution {
  const query = value.trim();
  const normalizedQuery = normalize(query);
  const exact = buildings.filter((building) => building.aliases.some((alias) => normalize(alias) === normalizedQuery));
  if (!normalizedQuery || (!isUsefulPartial(normalizedQuery) && exact.length === 0)) {
    return { status: "not_found", query, candidates: [] };
  }

  const matches = (exact.length > 0 ? exact : buildings).flatMap((building) => {
    const matchedAliases = building.aliases.filter((alias) => {
      const normalizedAlias = normalize(alias);
      return normalizedQuery === normalizedAlias
        || (isUsefulPartial(normalizedAlias) && normalizedQuery.includes(normalizedAlias))
        || (isUsefulPartial(normalizedQuery) && normalizedAlias.includes(normalizedQuery));
    });
    return matchedAliases.length > 0 ? [{ building, matchedAliases }] : [];
  });

  if (matches.length === 1) {
    return {
      status: "resolved",
      query,
      ...matches[0].building,
      matchedAliases: matches[0].matchedAliases,
    };
  }

  return {
    status: matches.length > 1 ? "ambiguous" : "not_found",
    query,
    candidates: matches.map(({ building }) => ({
      buildingId: building.buildingId,
      displayName: building.displayName,
    })),
  };
}

export class BuildingResolutionError extends Error {
  readonly code: "BUILDING_NAME_AMBIGUOUS" | "BUILDING_NAME_NOT_FOUND";
  readonly details: Record<string, unknown>;

  constructor(resolution: Exclude<BuildingResolution, ResolvedBuilding>) {
    const ambiguous = resolution.status === "ambiguous";
    super(ambiguous
      ? `Building name '${resolution.query}' matches more than one supported building.`
      : `Building name '${resolution.query}' does not match a supported building.`);
    this.name = "BuildingResolutionError";
    this.code = ambiguous ? "BUILDING_NAME_AMBIGUOUS" : "BUILDING_NAME_NOT_FOUND";
    this.details = {
      query: resolution.query,
      candidates: resolution.candidates,
    };
  }
}

export function resolveBackendBuildingName(value: string, buildings: readonly BuildingDefinition[]): string {
  const resolution = resolveBuildingName(value, buildings);
  if (resolution.status !== "resolved") throw new BuildingResolutionError(resolution);
  return resolution.backendBuildingName;
}
