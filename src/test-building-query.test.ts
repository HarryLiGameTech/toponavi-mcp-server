import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, it, expect, jest } from '@jest/globals';
import { z } from "zod";
import axios from "axios";

describe("test-building-query tool", () => {
  it("should return building info for a valid building name", async () => {

    // Import the tool handler directly if possible, or recreate logic
    const buildingName = "Test Tower";
    const response = await axios.get("http://192.168.50.65:8080/api/v1/test-building-query", {
      params: { name: buildingName },
    });
    const { name, address, height, description } = response.data;
    const result = {
      content: [
        {
          type: "text",
          text: `${name} is a ${height}-meter building located at ${address}. ${description}`,
        },
      ],
    };
    expect(result.content[0].text).toBe(
      "Shanghai World Financial Center is a 492-meter building located at Lujiazui Shanghai. A super-tall building recognized as a bottle-opener, built by Mori in 2008. It survived the economic crisis in late 1990s, and eventually completed without big issues"
    );
  });
});
