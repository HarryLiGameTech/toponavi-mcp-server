import { z } from "zod/v4";

export function buildingEndpoint(buildingId: string, operation: string): string {
  return `/api/v1/buildings/${encodeURIComponent(buildingId)}/${operation}`;
}

const attributes = z.record(z.string(), z.unknown());

export const nodeCatalogSchema = z.object({
  status: z.literal("success"),
  inDetail: z.literal(true),
  nodes: z.array(z.object({ nodeId: z.string(), attributes })),
}).transform((response) => ({
  status: response.status,
  allNodes: Object.fromEntries(response.nodes.map((node) => [node.nodeId, node.attributes])),
}));

export const edgeCatalogSchema = z.object({
  status: z.literal("success"),
  edges: z.array(z.object({
    mapId: z.string(), fromNodeId: z.string(), toNodeId: z.string(), cost: z.number(),
    tags: z.array(z.string()), requiredActions: z.array(z.string()), attributes,
  })),
}).transform((response) => ({
  status: response.status,
  edges: response.edges.map((edge) => ({
    graph: edge.mapId, from: edge.fromNodeId.split("::")[1]!, to: edge.toNodeId.split("::")[1]!,
    costSeconds: edge.cost, tags: edge.tags, requiredActions: edge.requiredActions, attributes: edge.attributes,
  })),
}));

export const neighborCatalogSchema = z.object({
  status: z.literal("success"),
  neighbors: z.array(z.object({
    nodeId: z.string(), mapId: z.string(), localNodeId: z.string(), cost: z.number(),
    nodeAttributes: attributes, tags: z.array(z.string()), requiredActions: z.array(z.string()),
  })),
}).transform((response) => ({
  status: response.status,
  proximityNodes: response.neighbors.map((node) => ({
    nodeIdentifier: node.nodeId, graph: node.mapId, nodeId: node.localNodeId, costSeconds: node.cost,
    attributes: node.nodeAttributes, edgeTags: node.tags, requiredActions: node.requiredActions,
  })),
}));

export const transportCatalogSchema = z.object({
  status: z.literal("success"),
  inDetail: z.boolean(),
  transports: z.array(z.object({
    transportId: z.string(), type: z.literal("Elevator"), displayName: z.string().nullable(), params: attributes,
    stations: z.array(z.object({ label: z.string(), nodeId: z.string(), location: z.number().optional() })),
  })),
}).transform((response) => ({
  status: response.status,
  simple: !response.inDetail,
  transports: response.transports.map((transport) => response.inDetail ? {
    transportId: transport.transportId, displayName: transport.displayName, params: transport.params,
    servedStops: transport.stations,
  } : {
    transportId: transport.transportId, params: transport.params,
    servedStops: transport.stations.map((station) => station.label),
  }),
}));

export function backendError(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const envelope = data as Record<string, unknown>;
  return envelope.error && typeof envelope.error === "object" && !Array.isArray(envelope.error)
    ? envelope.error as Record<string, unknown> : envelope;
}
