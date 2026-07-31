import axios, { type AxiosInstance } from "axios";
import { z } from "zod/v4";

import { deriveNodeIdFallback, topoNaviHttpClient } from "./navigation.js";

const userParamValueSchema = z.union([z.boolean(), z.number(), z.string()]);

export const placeResolutionInputSchema = z.object({
  buildingName: z.string().trim().min(1).describe(
    "Exact backend building identifier, such as 'indigoBJ'.",
  ),
  rawQuery: z.string().trim().min(1).describe(
    "The user's original destination phrase. Preserve it even when structured hints are supplied.",
  ),
  submapHint: z.string().trim().min(1).optional().describe(
    "The floor, level, or graph phrase extracted from the user's request, such as 'floor 3'. Do not invent an exact graph ID.",
  ),
  placeHint: z.string().trim().min(1).optional().describe(
    "The place or facility phrase extracted from the user's request, such as 'toilet' or 'Starbucks'. Do not invent an exact node ID.",
  ),
  userParams: z.record(z.string(), userParamValueSchema).default({}).describe(
    "Compile-time access and capability parameters used to obtain the same topology that routing will use.",
  ),
  maxCandidates: z.number().int().min(1).max(20).default(8),
}).strict();

export type PlaceResolutionInput = z.infer<typeof placeResolutionInputSchema>;

const submapCandidateSchema = z.object({
  graphId: z.string(),
  displayName: z.string(),
  confidence: z.number().min(0).max(1),
  matchBasis: z.string(),
});

const placeCandidateSchema = z.object({
  nodeId: z.string(),
  graph: z.string(),
  graphDisplayName: z.string(),
  displayName: z.string(),
  category: z.string().optional(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  matchBasis: z.string(),
  matchedText: z.string(),
});

export const placeResolutionOutputSchema = z.object({
  status: z.enum(["resolved", "ambiguous", "not_found", "error"]),
  query: z.object({
    rawQuery: z.string(),
    submapHint: z.string().optional(),
    placeHint: z.string(),
  }).optional(),
  resolvedSubmap: submapCandidateSchema.optional(),
  submapCandidates: z.array(submapCandidateSchema).optional(),
  place: placeCandidateSchema.optional(),
  candidates: z.array(placeCandidateSchema).optional(),
  clarification: z.object({
    reason: z.enum(["submap_ambiguous", "place_ambiguous"]),
    instruction: z.string(),
  }).optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  httpStatus: z.number().int().optional(),
}).passthrough();

export type PlaceResolutionOutput = z.infer<typeof placeResolutionOutputSchema>;

type PlaceResolutionToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type RankedSubmap = z.infer<typeof submapCandidateSchema>;
type PlaceCandidate = z.infer<typeof placeCandidateSchema>;
type NodeAttributes = Record<string, unknown>;

const catalogResponseSchema = z.object({
  status: z.literal("success"),
  allNodes: z.record(z.string(), z.record(z.string(), z.unknown())),
}).passthrough();

const NAME_FIELDS: Array<{ key: string; basis: string }> = [
  { key: "shopName", basis: "shop_name" },
  { key: "shop_name", basis: "shop_name" },
  { key: "facilityName", basis: "facility_name" },
  { key: "facility_name", basis: "facility_name" },
  { key: "displayName", basis: "display_name" },
  { key: "display_name", basis: "display_name" },
  { key: "name", basis: "name" },
  { key: "label", basis: "label" },
];

const CATEGORY_FIELDS = ["shopCategory", "shop_category", "facilityCategory", "facility_category"];
const DESCRIPTION_FIELDS = ["description"];
const ALIAS_FIELDS = ["aliases", "alias"];
const MIN_GRAPH_SCORE = 0.72;
const MIN_PLACE_SCORE = 0.75;
const UNIQUE_SCORE_GAP = 0.08;
const CONNECTOR_NODE_TOKENS = new Set([
  "conn", "connection", "end", "inner", "interm", "intermediate", "intersect",
  "intersact", "junction", "link", "outer", "outside",
]);

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

function identifierWords(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/([A-Za-z])(\d)/gu, "$1 $2")
    .replace(/(\d)([A-Za-z])/gu, "$1 $2");
}

function ordinal(number: number): string {
  const modulo100 = number % 100;
  if (modulo100 >= 11 && modulo100 <= 13) return `${number}th`;
  switch (number % 10) {
    case 1: return `${number}st`;
    case 2: return `${number}nd`;
    case 3: return `${number}rd`;
    default: return `${number}th`;
  }
}

function graphDisplayName(graphId: string): string {
  return identifierWords(graphId).replace(/\s+/gu, " ").trim();
}

function graphAliases(graphId: string): string[] {
  const aliases = new Set([graphId, graphDisplayName(graphId)]);
  const floorMatch = graphId.match(/^(?:level|floor)[_-]?(\d+)$/iu);
  if (floorMatch) {
    const floor = Number(floorMatch[1]);
    aliases.add(`level ${floor}`);
    aliases.add(`floor ${floor}`);
    aliases.add(`${ordinal(floor)} floor`);
    aliases.add(`${floor}f`);
    aliases.add(`l${floor}`);
  }
  if (/^lower[_-]?ground$/iu.test(graphId)) {
    aliases.add("lower ground");
    aliases.add("lower ground floor");
    aliases.add("lg");
  }
  return [...aliases];
}

function tokenSubset(query: string, candidate: string): boolean {
  const queryTokens = normalizeText(query).split(" ").filter(Boolean);
  const candidateTokens = new Set(normalizeText(candidate).split(" ").filter(Boolean));
  return queryTokens.length > 0 && queryTokens.every((token) => candidateTokens.has(token));
}

function scorePhrase(query: string, candidate: string): number {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (compact(normalizedQuery) === compact(normalizedCandidate)) return 1;
  if (normalizedCandidate.split(" ").includes(normalizedQuery)) return 0.97;
  if (normalizedCandidate.startsWith(`${normalizedQuery} `)) return 0.95;
  if (normalizedCandidate.includes(normalizedQuery) && normalizedQuery.length >= 3) return 0.9;
  if (tokenSubset(normalizedQuery, normalizedCandidate)) return 0.86;
  return 0;
}

function rankSubmaps(hint: string, graphIds: string[]): RankedSubmap[] {
  return graphIds
    .map((graphId) => {
      const aliases = graphAliases(graphId);
      const confidence = Math.max(...aliases.map((alias) => scorePhrase(hint, alias)));
      return {
        graphId,
        displayName: graphDisplayName(graphId),
        confidence,
        matchBasis: confidence === 1 ? "exact_graph_alias" : "partial_graph_alias",
      };
    })
    .filter((candidate) => candidate.confidence >= MIN_GRAPH_SCORE)
    .sort((left, right) => right.confidence - left.confidence || left.graphId.localeCompare(right.graphId));
}

function stringsFromAttribute(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim());
  }
  return [];
}

function fieldsFromAttributes(
  attributes: NodeAttributes,
  fields: Array<{ key: string; basis: string }>,
): Array<{ text: string; basis: string }> {
  return fields.flatMap(({ key, basis }) =>
    stringsFromAttribute(attributes[key]).map((text) => ({ text, basis }))
  );
}

function firstAttributeString(attributes: NodeAttributes, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringsFromAttribute(attributes[key])[0];
    if (value) return value;
  }
  return undefined;
}

function semanticTags(attributes: NodeAttributes): string[] {
  return stringsFromAttribute(attributes.tags).filter((tag) => tag !== "indoor" && tag !== "outdoor");
}

function isInternalConnector(nodeId: string): boolean {
  return nodeId
    .split(/[_\-\s]+/u)
    .some((token) => CONNECTOR_NODE_TOKENS.has(token.toLocaleLowerCase()));
}

function scoreNode(
  canonicalNodeId: string,
  attributes: NodeAttributes,
  query: string,
): PlaceCandidate | undefined {
  const separator = canonicalNodeId.indexOf("::");
  if (separator < 1) return undefined;
  const graph = canonicalNodeId.slice(0, separator);
  const localNodeId = canonicalNodeId.slice(separator + 2);
  const names = fieldsFromAttributes(attributes, NAME_FIELDS);
  const aliases = ALIAS_FIELDS.flatMap((key) =>
    stringsFromAttribute(attributes[key]).map((text) => ({ text, basis: "alias" }))
  );
  const categories = CATEGORY_FIELDS.flatMap((key) => stringsFromAttribute(attributes[key]));
  const descriptions = DESCRIPTION_FIELDS.flatMap((key) => stringsFromAttribute(attributes[key]));
  const tags = stringsFromAttribute(attributes.tags);
  const fallback = names.length === 0 && descriptions.length === 0 && !isInternalConnector(localNodeId)
    ? deriveNodeIdFallback(localNodeId)
    : undefined;

  const scored: Array<{ confidence: number; basis: string; text: string }> = [];
  for (const field of [...names, ...aliases]) {
    const confidence = scorePhrase(query, field.text);
    if (confidence > 0) scored.push({ confidence, basis: field.basis, text: field.text });
  }
  for (const category of categories) {
    const confidence = scorePhrase(query, category) * 0.9;
    if (confidence > 0) scored.push({ confidence, basis: "category", text: category });
  }
  for (const tag of semanticTags(attributes)) {
    const confidence = scorePhrase(query, tag) * 0.94;
    if (confidence > 0) scored.push({ confidence, basis: "tag", text: tag });
  }
  for (const description of descriptions) {
    const confidence = scorePhrase(query, description) * 0.7;
    if (confidence > 0) scored.push({ confidence, basis: "description", text: description });
  }
  if (fallback) {
    const confidence = scorePhrase(query, fallback.label) * 0.88;
    if (confidence > 0) {
      scored.push({ confidence, basis: fallback.kind, text: fallback.label });
    }
  }

  const best = scored.sort((left, right) => right.confidence - left.confidence)[0];
  if (!best || best.confidence < MIN_PLACE_SCORE) return undefined;

  const displayName = names[0]?.text
    || descriptions[0]
    || fallback?.label
    || categories[0]
    || semanticTags(attributes)[0]
    || "Unnamed place";

  return {
    nodeId: canonicalNodeId,
    graph,
    graphDisplayName: graphDisplayName(graph),
    displayName,
    category: categories[0] || semanticTags(attributes)[0],
    tags,
    confidence: Number(best.confidence.toFixed(3)),
    matchBasis: best.basis,
    matchedText: best.text,
  };
}

function placeQueryFor(input: PlaceResolutionInput): string {
  if (input.placeHint) return input.placeHint;
  if (!input.submapHint) return input.rawQuery;

  const raw = normalizeText(input.rawQuery);
  const scope = normalizeText(input.submapHint);
  const withoutScope = raw.replace(scope, " ")
    .replace(/\b(?:on|at|in|the|of)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return withoutScope || input.rawQuery;
}

function baseQuery(input: PlaceResolutionInput, placeHint: string) {
  return {
    rawQuery: input.rawQuery,
    ...(input.submapHint ? { submapHint: input.submapHint } : {}),
    placeHint,
  };
}

export function resolvePlaceFromCatalog(
  value: PlaceResolutionInput,
  catalog: Record<string, NodeAttributes>,
): PlaceResolutionOutput {
  const input = placeResolutionInputSchema.parse(value);
  const placeHint = placeQueryFor(input);
  const query = baseQuery(input, placeHint);
  const graphIds = [...new Set(Object.keys(catalog).map((nodeId) => nodeId.split("::", 1)[0]!))].sort();

  let resolvedSubmap: RankedSubmap | undefined;
  if (input.submapHint) {
    const submapCandidates = rankSubmaps(input.submapHint, graphIds);
    if (submapCandidates.length === 0) {
      return {
        status: "not_found",
        query,
        message: `No compiled submap matches '${input.submapHint}'.`,
      };
    }
    const next = submapCandidates[1];
    if (next && submapCandidates[0]!.confidence - next.confidence < UNIQUE_SCORE_GAP) {
      return {
        status: "ambiguous",
        query,
        submapCandidates: submapCandidates.slice(0, input.maxCandidates),
        clarification: {
          reason: "submap_ambiguous",
          instruction: "Ask the user which floor or area they mean. Do not guess a graph ID.",
        },
      };
    }
    resolvedSubmap = submapCandidates[0];
  }

  const candidates = Object.entries(catalog)
    .filter(([nodeId]) => !resolvedSubmap || nodeId.startsWith(`${resolvedSubmap.graphId}::`))
    .map(([nodeId, attributes]) => scoreNode(nodeId, attributes, placeHint))
    .filter((candidate): candidate is PlaceCandidate => Boolean(candidate))
    .sort((left, right) => right.confidence - left.confidence || left.nodeId.localeCompare(right.nodeId));

  if (candidates.length === 0) {
    return {
      status: "not_found",
      query,
      ...(resolvedSubmap ? { resolvedSubmap } : {}),
      message: `No compiled place matches '${placeHint}'${resolvedSubmap ? ` in ${resolvedSubmap.displayName}` : ""}.`,
    };
  }

  const top = candidates[0]!;
  const next = candidates[1];
  const uniquelyRanked = !next || top.confidence - next.confidence >= UNIQUE_SCORE_GAP;
  if (uniquelyRanked) {
    return {
      status: "resolved",
      query,
      ...(resolvedSubmap ? { resolvedSubmap } : {}),
      place: top,
    };
  }

  return {
    status: "ambiguous",
    query,
    ...(resolvedSubmap ? { resolvedSubmap } : {}),
    candidates: candidates.slice(0, input.maxCandidates),
    clarification: {
      reason: "place_ambiguous",
      instruction: "Ask the user to distinguish among these candidate places using their names, floor, or clear directional labels. Do not guess a node ID.",
    },
  };
}

function renderResult(result: PlaceResolutionOutput): string {
  if (result.status === "resolved" && result.place) {
    return [
      `Resolved '${result.query?.rawQuery}' to ${result.place.displayName} on ${result.place.graphDisplayName}.`,
      `Use exact nodeId '${result.place.nodeId}' for route planning, but never speak the nodeId to the user.`,
      `Match basis: ${result.place.matchBasis} ('${result.place.matchedText}').`,
    ].join("\n");
  }
  if (result.status === "ambiguous") {
    const options = result.candidates
      ?.map((candidate) => `- ${candidate.displayName} on ${candidate.graphDisplayName}: ${candidate.nodeId}`)
      .join("\n");
    const submaps = result.submapCandidates
      ?.map((candidate) => `- ${candidate.displayName}: ${candidate.graphId}`)
      .join("\n");
    return [
      `The place request '${result.query?.rawQuery}' is ambiguous.`,
      options || submaps || "No candidate details are available.",
      result.clarification?.instruction || "Ask one short clarification question.",
      "Never expose nodeId or graphId values to the user.",
    ].join("\n");
  }
  return result.message || `No place matched '${result.query?.rawQuery}'.`;
}

function errorResult(error: unknown): PlaceResolutionToolResult {
  if (axios.isAxiosError(error)) {
    const httpStatus = error.response?.status;
    const payload: PlaceResolutionOutput = {
      status: "error",
      code: httpStatus ? `TOPONAVI_HTTP_${httpStatus}` : "TOPONAVI_BACKEND_UNAVAILABLE",
      message: error.message || "TopoNavi place catalog request failed",
      ...(httpStatus ? { httpStatus } : {}),
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }

  const payload: PlaceResolutionOutput = {
    status: "error",
    code: "TOPONAVI_PLACE_RESOLUTION_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function createResolvePlaceHandler(
  httpClient: Pick<AxiosInstance, "post"> = topoNaviHttpClient,
) {
  return async (value: PlaceResolutionInput): Promise<PlaceResolutionToolResult> => {
    try {
      const input = placeResolutionInputSchema.parse(value);
      const response = await httpClient.post(
        "/api/v1/quick-demo-all-available-nodes",
        { userParams: input.userParams },
        {
          params: {
            buildingName: input.buildingName,
            withNodesAttributes: "true",
          },
        },
      );
      const catalog = catalogResponseSchema.parse(response.data);
      const result = placeResolutionOutputSchema.parse(resolvePlaceFromCatalog(input, catalog.allNodes));
      return {
        content: [{ type: "text", text: renderResult(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return errorResult(error);
    }
  };
}
