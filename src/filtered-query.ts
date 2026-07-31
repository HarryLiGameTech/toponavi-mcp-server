import axios, { type AxiosInstance } from "axios";
import { z } from "zod/v4";

import { deriveNodeIdFallback, topoNaviHttpClient } from "./navigation.js";

const userParamValueSchema = z.union([z.boolean(), z.number(), z.string()]);
const filterValueListSchema = z.array(z.string().trim().min(1)).min(1).max(20);

export const filteredQueryInputSchema = z.object({
  buildingName: z.string().trim().min(1),
  rawQuery: z.string().trim().min(1).describe(
    "The user's original discovery question. Preserve it across interpretation retries.",
  ),
  filters: z.object({
    tag: filterValueListSchema.optional().describe(
      "Fuzzy node or edge tag values. Values inside this list are ORed.",
    ),
    shop_category: filterValueListSchema.optional().describe(
      "Fuzzy shop-category values. Values inside this list are ORed.",
    ),
    action_required: filterValueListSchema.optional().describe(
      "Fuzzy required-action values for edge search. Values inside this list are ORed.",
    ),
  }).strict().refine(
    (filters) => Object.values(filters).some((values) => values && values.length > 0),
    { message: "At least one filter field is required" },
  ),
  userParams: z.record(z.string(), userParamValueSchema).default({}),
  limit: z.number().int().min(1).max(25).default(10),
}).strict();

export type FilteredQueryInput = z.infer<typeof filteredQueryInputSchema>;

const interpretationCandidateSchema = z.object({
  value: z.string(),
  confidence: z.number().min(0).max(1),
});

const interpretationSchema = z.object({
  field: z.enum(["tag", "shop_category", "action_required"]),
  input: z.string(),
  candidates: z.array(interpretationCandidateSchema),
});

const nodeResultSchema = z.object({
  nodeId: z.string(),
  graph: z.string(),
  localNodeId: z.string(),
  displayName: z.string(),
  shopCategory: z.string().optional(),
  tags: z.array(z.string()),
});

const proximityNodeSchema = z.object({
  nodeIdentifier: z.string(),
  graph: z.string(),
  nodeId: z.string(),
  displayName: z.string(),
  costSeconds: z.number(),
  viaNodeIdentifier: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  edgeTags: z.array(z.string()),
  requiredActions: z.array(z.string()),
});

const edgeResultSchema = z.object({
  graph: z.string(),
  from: z.string(),
  to: z.string(),
  fromPlace: z.string(),
  toPlace: z.string(),
  costSeconds: z.number(),
  tags: z.array(z.string()),
  requiredActions: z.array(z.string()),
  bidirectional: z.boolean(),
  proximityNodes: z.array(proximityNodeSchema),
});

export const filteredQueryOutputSchema = z.object({
  status: z.enum(["success", "needs_interpretation", "not_found", "error"]),
  entityType: z.enum(["node", "edge"]).optional(),
  rawQuery: z.string().optional(),
  requestedFilters: z.record(z.string(), z.array(z.string())).optional(),
  appliedFilters: z.record(z.string(), z.array(z.string())).optional(),
  interpretations: z.array(interpretationSchema).optional(),
  retryInstruction: z.string().optional(),
  totalMatches: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  nodes: z.array(nodeResultSchema).optional(),
  edges: z.array(edgeResultSchema).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  httpStatus: z.number().int().optional(),
}).passthrough();

export type FilteredQueryOutput = z.infer<typeof filteredQueryOutputSchema>;

type FilteredQueryToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type FilterField = "tag" | "shop_category" | "action_required";
type FilterSet = Partial<Record<FilterField, string[]>>;
type NodeAttributes = Record<string, unknown>;
type NodeResult = z.infer<typeof nodeResultSchema>;
type EdgeResult = z.infer<typeof edgeResultSchema>;
type ProximityNode = z.infer<typeof proximityNodeSchema>;

const nodeCatalogResponseSchema = z.object({
  status: z.literal("success"),
  allNodes: z.record(z.string(), z.record(z.string(), z.unknown())),
}).passthrough();

const rawEdgeSchema = z.object({
  graph: z.string(),
  from: z.string(),
  to: z.string(),
  costSeconds: z.number(),
  tags: z.array(z.string()).default([]),
  requiredActions: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

const edgeCatalogResponseSchema = z.object({
  status: z.literal("success"),
  edges: z.array(rawEdgeSchema),
}).passthrough();

const rawProximityNodeSchema = z.object({
  nodeIdentifier: z.string(),
  graph: z.string(),
  nodeId: z.string(),
  costSeconds: z.number(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  edgeTags: z.array(z.string()).default([]),
  requiredActions: z.array(z.string()).default([]),
});

const proximityResponseSchema = z.object({
  status: z.literal("success"),
  proximityNodes: z.array(rawProximityNodeSchema),
}).passthrough();

const FIELD_ALIASES: Record<FilterField, Record<string, string[]>> = {
  tag: {
    toilet: ["bathroom", "bathrooms", "lavatory", "lavatories", "restroom", "restrooms", "washroom", "washrooms", "wc"],
    shop: ["shops", "store", "stores", "retail", "retailer", "retailers"],
    bridge: ["bridges", "footbridge", "footbridges", "walkway bridge"],
    "elevator hall": ["elevator lobby", "lift lobby", "lift hall"],
  },
  shop_category: {
    "full service cafe": ["cafe", "cafes", "coffee", "coffee shop", "coffee shops"],
    "beverage shop": ["beverage", "beverages", "drink", "drinks", "tea shop", "coffee"],
    "full service restaurant": ["restaurant", "restaurants", "dining", "sit down restaurant"],
    "fast food restaurant": ["fast food", "quick meal", "quick service restaurant"],
    "snack shop": ["snack", "snacks", "dessert", "desserts"],
    bookstore: ["book shop", "book store", "books"],
    electronics: ["electronic", "electronics store", "gadgets"],
  },
  action_required: {
    "cross bridge": [
      "bridge crossing", "cross a bridge", "cross bridge", "cross the bridge",
      "crossing a bridge", "crossing the bridge", "walk across a bridge",
      "walk across the bridge", "walk through a bridge", "walk through the bridge",
      "walk thru a bridge", "walk thru the bridge",
    ],
    "cross door": ["enter through a door", "go through a door", "open a door", "walk through a door"],
    "cross turnstile": ["go through a turnstile", "pass a turnstile", "tap through a turnstile"],
  },
};

const AUTO_INTERPRETATION_THRESHOLD = 0.5;

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function compact(value: string): string {
  return normalizeText(value).replace(/\s+/gu, "");
}

function singularized(value: string): string {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token)
    .join(" ");
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function lexicalConfidence(input: string, candidate: string): number {
  const normalizedInput = normalizeText(input);
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedInput || !normalizedCandidate) return 0;
  if (compact(normalizedInput) === compact(normalizedCandidate)) return 1;
  if (compact(singularized(normalizedInput)) === compact(singularized(normalizedCandidate))) return 0.98;
  if (normalizedCandidate.includes(normalizedInput) || normalizedInput.includes(normalizedCandidate)) return 0.82;

  const inputTokens = new Set(normalizedInput.split(" "));
  const candidateTokens = new Set(normalizedCandidate.split(" "));
  const shared = [...inputTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...inputTokens, ...candidateTokens]).size;
  const tokenScore = union > 0 ? shared / union : 0;
  const maxLength = Math.max(normalizedInput.length, normalizedCandidate.length);
  const editScore = maxLength > 0
    ? 1 - levenshteinDistance(normalizedInput, normalizedCandidate) / maxLength
    : 0;
  return Math.max(tokenScore * 0.8, editScore * 0.75);
}

function scoreInterpretation(field: FilterField, input: string, canonical: string): number {
  const direct = lexicalConfidence(input, canonical);
  const aliases = FIELD_ALIASES[field][normalizeText(canonical)] || [];
  const aliasScore = aliases.reduce(
    (highest, alias) => Math.max(highest, lexicalConfidence(input, alias) * 0.96),
    0,
  );
  return Number(Math.max(direct, aliasScore).toFixed(3));
}

function valuesFromAttribute(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim());
  }
  return [];
}

function shopCategory(attributes: NodeAttributes): string | undefined {
  return ["shopCategory", "shop_category"]
    .flatMap((key) => valuesFromAttribute(attributes[key]))[0];
}

function metadataName(attributes: NodeAttributes): string | undefined {
  for (const key of [
    "shopName", "shop_name", "facilityName", "facility_name", "displayName",
    "display_name", "name", "label", "description",
  ]) {
    const value = valuesFromAttribute(attributes[key])[0];
    if (value) return value;
  }
  return undefined;
}

function displayName(nodeId: string, attributes: NodeAttributes): string {
  return metadataName(attributes)
    || deriveNodeIdFallback(nodeId)?.label
    || shopCategory(attributes)
    || "Unnamed place";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function vocabularyForNodes(catalog: Record<string, NodeAttributes>): Record<"tag" | "shop_category", string[]> {
  return {
    tag: uniqueSorted(Object.values(catalog).flatMap((attributes) => valuesFromAttribute(attributes.tags))),
    shop_category: uniqueSorted(Object.values(catalog).flatMap((attributes) => {
      const category = shopCategory(attributes);
      return category ? [category] : [];
    })),
  };
}

function vocabularyForEdges(edges: Array<z.infer<typeof rawEdgeSchema>>): Record<"tag" | "action_required", string[]> {
  return {
    tag: uniqueSorted(edges.flatMap((edge) => edge.tags)),
    action_required: uniqueSorted(edges.flatMap((edge) => edge.requiredActions)),
  };
}

function interpretFilters(
  requested: FilterSet,
  vocabularies: Partial<Record<FilterField, string[]>>,
): { applied: FilterSet; lowConfidence: z.infer<typeof interpretationSchema>[] } {
  const applied: FilterSet = {};
  const lowConfidence: z.infer<typeof interpretationSchema>[] = [];

  for (const field of Object.keys(requested) as FilterField[]) {
    const vocabulary = vocabularies[field] || [];
    const resolvedValues = new Set<string>();
    for (const input of requested[field] || []) {
      const ranked = vocabulary
        .map((value) => ({ value, confidence: scoreInterpretation(field, input, value) }))
        .sort((left, right) => right.confidence - left.confidence || left.value.localeCompare(right.value));
      const best = ranked[0];
      if (!best || best.confidence < AUTO_INTERPRETATION_THRESHOLD) {
        lowConfidence.push({
          field,
          input,
          candidates: ranked.slice(0, 3),
        });
        continue;
      }

      const tied = ranked.filter((candidate) => best.confidence - candidate.confidence <= 0.03);
      tied.forEach((candidate) => resolvedValues.add(candidate.value));
    }
    if (resolvedValues.size > 0) applied[field] = [...resolvedValues];
  }

  return { applied, lowConfidence };
}

function matchesAny(actual: string[], expected: string[] | undefined): boolean {
  if (!expected) return true;
  const normalizedActual = new Set(actual.map(normalizeText));
  return expected.some((value) => normalizedActual.has(normalizeText(value)));
}

function nodeResults(catalog: Record<string, NodeAttributes>, filters: FilterSet): NodeResult[] {
  return Object.entries(catalog)
    .filter(([, attributes]) => matchesAny(valuesFromAttribute(attributes.tags), filters.tag))
    .filter(([, attributes]) => matchesAny(
      shopCategory(attributes) ? [shopCategory(attributes)!] : [],
      filters.shop_category,
    ))
    .map(([canonicalNodeId, attributes]) => {
      const separator = canonicalNodeId.indexOf("::");
      const graph = canonicalNodeId.slice(0, separator);
      const localNodeId = canonicalNodeId.slice(separator + 2);
      return {
        nodeId: canonicalNodeId,
        graph,
        localNodeId,
        displayName: displayName(localNodeId, attributes),
        ...(shopCategory(attributes) ? { shopCategory: shopCategory(attributes) } : {}),
        tags: valuesFromAttribute(attributes.tags),
      };
    })
    .sort((left, right) => left.graph.localeCompare(right.graph)
      || left.displayName.localeCompare(right.displayName)
      || left.nodeId.localeCompare(right.nodeId));
}

type DedupedEdge = z.infer<typeof rawEdgeSchema> & { bidirectional: boolean };

function dedupeEdges(
  edges: Array<z.infer<typeof rawEdgeSchema>>,
  filters: FilterSet,
): DedupedEdge[] {
  const matches = edges
    .filter((edge) => matchesAny(edge.tags, filters.tag))
    .filter((edge) => matchesAny(edge.requiredActions, filters.action_required));
  const grouped = new Map<string, DedupedEdge>();
  for (const edge of matches) {
    const endpoints = [edge.from, edge.to].sort();
    const key = [edge.graph, ...endpoints, edge.costSeconds, ...edge.requiredActions.slice().sort()].join("|");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...edge, bidirectional: false });
    } else if (existing.from === edge.to && existing.to === edge.from) {
      existing.bidirectional = true;
    }
  }
  return [...grouped.values()].sort((left, right) => left.graph.localeCompare(right.graph)
    || left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to));
}

function requestFilters(input: FilteredQueryInput): FilterSet {
  return {
    ...(input.filters.tag ? { tag: input.filters.tag } : {}),
    ...(input.filters.shop_category ? { shop_category: input.filters.shop_category } : {}),
    ...(input.filters.action_required ? { action_required: input.filters.action_required } : {}),
  };
}

function queryRecord(filters: FilterSet): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string[]] => Boolean(entry[1])),
  );
}

function needsInterpretationOutput(
  input: FilteredQueryInput,
  entityType: "node" | "edge",
  requested: FilterSet,
  interpretations: z.infer<typeof interpretationSchema>[],
): FilteredQueryOutput {
  return {
    status: "needs_interpretation",
    entityType,
    rawQuery: input.rawQuery,
    requestedFilters: queryRecord(requested),
    interpretations,
    retryInstruction: "Choose the intended canonical value from each low-confidence candidate list, then call this tool again with those canonical values. Do not search or answer from an unconfirmed interpretation.",
  };
}

function renderResult(result: FilteredQueryOutput): string {
  if (result.status === "needs_interpretation") {
    const lines = result.interpretations?.flatMap((interpretation) => [
      `${interpretation.field} '${interpretation.input}' is below 50% confidence.`,
      ...interpretation.candidates.map((candidate) =>
        `- ${candidate.value}: ${Math.round(candidate.confidence * 100)}%`
      ),
    ]) || [];
    return [...lines, result.retryInstruction || "Call again with a confirmed value."].join("\n");
  }
  if (result.status === "success") {
    return [
      `Found ${result.totalMatches} matching ${result.entityType === "edge" ? "traversable segments" : "places"}.`,
      result.truncated ? "Only the first requested results are included." : "All matches are included.",
      result.entityType === "edge"
        ? "Each segment includes up to five direct neighboring nodes ordered by edge cost."
        : "Use metadata names in user-facing speech and never expose node IDs.",
    ].join("\n");
  }
  return result.message || "No matching topology items were found.";
}

function errorResult(error: unknown): FilteredQueryToolResult {
  if (axios.isAxiosError(error)) {
    const httpStatus = error.response?.status;
    const payload: FilteredQueryOutput = {
      status: "error",
      code: httpStatus ? `TOPONAVI_HTTP_${httpStatus}` : "TOPONAVI_BACKEND_UNAVAILABLE",
      message: error.message || "TopoNavi filtered query failed",
      ...(httpStatus ? { httpStatus } : {}),
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }
  const payload: FilteredQueryOutput = {
    status: "error",
    code: "TOPONAVI_FILTERED_QUERY_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function createFilteredQueryHandler(
  httpClient: Pick<AxiosInstance, "post"> = topoNaviHttpClient,
) {
  return async (value: FilteredQueryInput): Promise<FilteredQueryToolResult> => {
    try {
      const input = filteredQueryInputSchema.parse(value);
      const requested = requestFilters(input);
      const edgeMode = Boolean(requested.action_required);
      const entityType = edgeMode ? "edge" : "node";

      if (edgeMode && requested.shop_category) {
        const payload: FilteredQueryOutput = {
          status: "error",
          entityType,
          code: "INCOMPATIBLE_FILTER_FIELDS",
          message: "shop_category applies to nodes and cannot be ANDed with action_required, which applies to edges.",
        };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload,
        };
      }

      const body = { userParams: input.userParams };
      const nodeRequest = httpClient.post(
        "/api/v1/quick-demo-all-available-nodes",
        body,
        { params: { buildingName: input.buildingName, withNodesAttributes: "true" } },
      );

      if (!edgeMode) {
        const nodeResponse = nodeCatalogResponseSchema.parse((await nodeRequest).data);
        const vocabularies = vocabularyForNodes(nodeResponse.allNodes);
        const interpreted = interpretFilters(requested, vocabularies);
        if (interpreted.lowConfidence.length > 0) {
          const result = needsInterpretationOutput(input, entityType, requested, interpreted.lowConfidence);
          return { content: [{ type: "text", text: renderResult(result) }], structuredContent: result };
        }

        const matches = nodeResults(nodeResponse.allNodes, interpreted.applied);
        const result: FilteredQueryOutput = matches.length === 0
          ? {
              status: "not_found",
              entityType,
              rawQuery: input.rawQuery,
              requestedFilters: queryRecord(requested),
              appliedFilters: queryRecord(interpreted.applied),
              totalMatches: 0,
              message: "No compiled nodes satisfy all requested filter fields.",
            }
          : {
              status: "success",
              entityType,
              rawQuery: input.rawQuery,
              requestedFilters: queryRecord(requested),
              appliedFilters: queryRecord(interpreted.applied),
              totalMatches: matches.length,
              truncated: matches.length > input.limit,
              nodes: matches.slice(0, input.limit),
            };
        return { content: [{ type: "text", text: renderResult(result) }], structuredContent: result };
      }

      const edgeRequest = httpClient.post(
        "/api/v1/quick-demo-all-available-edges",
        body,
        { params: { buildingName: input.buildingName } },
      );
      const [nodeResponseRaw, edgeResponseRaw] = await Promise.all([nodeRequest, edgeRequest]);
      const nodeResponse = nodeCatalogResponseSchema.parse(nodeResponseRaw.data);
      const edgeResponse = edgeCatalogResponseSchema.parse(edgeResponseRaw.data);
      const vocabularies = vocabularyForEdges(edgeResponse.edges);
      const interpreted = interpretFilters(requested, vocabularies);
      if (interpreted.lowConfidence.length > 0) {
        const result = needsInterpretationOutput(input, entityType, requested, interpreted.lowConfidence);
        return { content: [{ type: "text", text: renderResult(result) }], structuredContent: result };
      }

      const matches = dedupeEdges(edgeResponse.edges, interpreted.applied);
      const selected = matches.slice(0, input.limit);
      const proximityRequests = new Map<string, Promise<z.infer<typeof proximityResponseSchema>>>();
      const proximityFor = (nodeIdentifier: string) => {
        let request = proximityRequests.get(nodeIdentifier);
        if (!request) {
          request = httpClient.post(
            "/api/v1/quick-demo-proximity-nodes",
            body,
            { params: { buildingName: input.buildingName, nodeIdentifier, amount: 5 } },
          ).then((response) => proximityResponseSchema.parse(response.data));
          proximityRequests.set(nodeIdentifier, request);
        }
        return request;
      };

      const enriched: EdgeResult[] = await Promise.all(selected.map(async (edge) => {
        const fromIdentifier = `${edge.graph}::${edge.from}`;
        const toIdentifier = `${edge.graph}::${edge.to}`;
        const [fromProximity, toProximity] = await Promise.all([
          proximityFor(fromIdentifier),
          proximityFor(toIdentifier),
        ]);
        const nearby = new Map<string, ProximityNode>();
        const addNearby = (viaNodeIdentifier: string, item: z.infer<typeof rawProximityNodeSchema>) => {
          if (item.nodeIdentifier === fromIdentifier || item.nodeIdentifier === toIdentifier) return;
          const candidate: ProximityNode = {
            ...item,
            displayName: displayName(item.nodeId, item.attributes),
            viaNodeIdentifier,
          };
          const existing = nearby.get(candidate.nodeIdentifier);
          if (!existing || candidate.costSeconds < existing.costSeconds) {
            nearby.set(candidate.nodeIdentifier, candidate);
          }
        };
        fromProximity.proximityNodes.forEach((item) => addNearby(fromIdentifier, item));
        toProximity.proximityNodes.forEach((item) => addNearby(toIdentifier, item));
        const proximityNodes = [...nearby.values()]
          .sort((left, right) => left.costSeconds - right.costSeconds
            || left.nodeIdentifier.localeCompare(right.nodeIdentifier))
          .slice(0, 5);
        const fromAttributes = nodeResponse.allNodes[fromIdentifier] || {};
        const toAttributes = nodeResponse.allNodes[toIdentifier] || {};
        return {
          graph: edge.graph,
          from: edge.from,
          to: edge.to,
          fromPlace: displayName(edge.from, fromAttributes),
          toPlace: displayName(edge.to, toAttributes),
          costSeconds: edge.costSeconds,
          tags: edge.tags,
          requiredActions: edge.requiredActions,
          bidirectional: edge.bidirectional,
          proximityNodes,
        };
      }));

      const result: FilteredQueryOutput = matches.length === 0
        ? {
            status: "not_found",
            entityType,
            rawQuery: input.rawQuery,
            requestedFilters: queryRecord(requested),
            appliedFilters: queryRecord(interpreted.applied),
            totalMatches: 0,
            message: "No compiled edges satisfy all requested filter fields.",
          }
        : {
            status: "success",
            entityType,
            rawQuery: input.rawQuery,
            requestedFilters: queryRecord(requested),
            appliedFilters: queryRecord(interpreted.applied),
            totalMatches: matches.length,
            truncated: matches.length > input.limit,
            edges: enriched,
          };
      return { content: [{ type: "text", text: renderResult(result) }], structuredContent: result };
    } catch (error) {
      return errorResult(error);
    }
  };
}
