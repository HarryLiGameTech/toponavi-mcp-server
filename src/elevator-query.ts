import axios, { type AxiosInstance } from "axios";
import { z } from "zod/v4";

import { topoNaviHttpClient } from "./navigation.js";

const userParamValueSchema = z.union([z.boolean(), z.number(), z.string()]);

export const elevatorQueryInputSchema = z.object({
  buildingName: z.string().trim().min(1).default("swfc").describe(
    "Backend example-building identifier.",
  ),
  simple: z.boolean().default(true).describe(
    "Use true for the initial elevator overview. Use false only after the user asks for a closer look.",
  ),
  transportId: z.string().trim().min(1).optional().describe(
    "Optional transport identifier from an earlier overview, used to scope a detailed follow-up.",
  ),
  userParams: z.record(z.string(), userParamValueSchema).default({}).describe(
    "Compile-time access and capability parameters for the current user.",
  ),
}).strict();

export type ElevatorQueryInput = z.infer<typeof elevatorQueryInputSchema>;

const simpleTransportSchema = z.object({
  transportId: z.string(),
  servedStops: z.array(z.string()),
});

const completeStopSchema = z.object({
  label: z.string(),
  nodeId: z.string(),
  location: z.number(),
});

const completeTransportSchema = z.object({
  transportId: z.string(),
  displayName: z.string().nullable(),
  servedStops: z.array(completeStopSchema),
});

const backendElevatorResponseSchema = z.object({
  status: z.literal("success"),
  message: z.string().optional(),
  simple: z.boolean(),
  transports: z.array(z.union([simpleTransportSchema, completeTransportSchema])),
}).passthrough();

export const elevatorQueryOutputSchema = z.object({
  status: z.enum(["success", "not_found", "error"]),
  simple: z.boolean().optional(),
  transports: z.array(z.union([simpleTransportSchema, completeTransportSchema])).optional(),
  requiredUserNotice: z.string().optional(),
  followUpInstruction: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  httpStatus: z.number().int().optional(),
});

export type ElevatorQueryOutput = z.infer<typeof elevatorQueryOutputSchema>;

type ElevatorQueryToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const REQUIRED_USER_NOTICE = "Elevator information is for reference only; local access policies may apply.";

function renderResult(result: ElevatorQueryOutput): string {
  if (result.status === "success") {
    return [
      `Found ${result.transports?.length || 0} elevator groups declared in the compiled transport specification.`,
      REQUIRED_USER_NOTICE,
      result.followUpInstruction,
    ].filter(Boolean).join(" ");
  }
  return result.message || "No elevator transport declarations were found.";
}

function errorResult(error: unknown): ElevatorQueryToolResult {
  if (axios.isAxiosError(error)) {
    const httpStatus = error.response?.status;
    const payload: ElevatorQueryOutput = {
      status: "error",
      code: httpStatus ? `TOPONAVI_HTTP_${httpStatus}` : "TOPONAVI_BACKEND_UNAVAILABLE",
      message: error.message || "TopoNavi elevator query failed",
      ...(httpStatus ? { httpStatus } : {}),
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }

  const payload: ElevatorQueryOutput = {
    status: "error",
    code: "TOPONAVI_ELEVATOR_QUERY_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function createElevatorQueryHandler(
  httpClient: Pick<AxiosInstance, "post"> = topoNaviHttpClient,
) {
  return async (value: ElevatorQueryInput): Promise<ElevatorQueryToolResult> => {
    try {
      const input = elevatorQueryInputSchema.parse(value);
      const response = await httpClient.post(
        "/api/v1/quick-demo-elevators",
        { userParams: input.userParams },
        { params: { buildingName: input.buildingName, simple: input.simple } },
      );
      const parsed = backendElevatorResponseSchema.parse(response.data);
      const transports = input.transportId
        ? parsed.transports.filter((transport) => transport.transportId === input.transportId)
        : parsed.transports;

      const result: ElevatorQueryOutput = transports.length > 0
        ? {
            status: "success",
            simple: parsed.simple,
            transports,
            requiredUserNotice: REQUIRED_USER_NOTICE,
            followUpInstruction: input.simple
              ? "Use at most 35 spoken English words total in no more than three short sentences, including the notice and question. Summarize with stop ranges or differences instead of enumerating every stop. Never speak raw transportId syntax: render a clearly semantic ID naturally, such as 'north elevator', and call an opaque ID 'an elevator group'. State the required user notice and ask which group to examine. If the user chooses one, call this tool again with simple=false and its transportId."
              : "Summarize the requested detail, repeat the required user notice, and ask one short follow-up question.",
          }
        : {
            status: "not_found",
            simple: parsed.simple,
            transports: [],
            requiredUserNotice: REQUIRED_USER_NOTICE,
            message: input.transportId
              ? "The requested elevator transport was not present in this compiled specification."
              : "No elevator transport declarations were found in this compiled specification.",
          };

      return {
        content: [{ type: "text", text: renderResult(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return errorResult(error);
    }
  };
}
