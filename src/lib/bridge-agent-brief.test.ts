import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bridgeAgentBrief } from "./bridge-agent-brief.ts";

describe("bridgeAgentBrief", () => {
  it("gives an agent the code and safe bridge instructions", () => {
    const brief = bridgeAgentBrief("BRIDGE-123");
    assert.match(brief, /BRIDGE-123/);
    assert.match(brief, /POST https:\/\/whop\.plunderandriffle\.com\/api\/bridge\/exchange/);
    assert.match(brief, /\{"code": "BRIDGE-123"\}/);
    assert.match(brief, /https:\/\/whop\.plunderandriffle\.com\/api\/bridge\/mcp/);
    assert.match(brief, /24 hours/);
    assert.match(brief, /7 days/);
    assert.match(brief, /Never print the token back to the member/);
    assert.match(brief, /Quote the exact credit cost and wait.*"go"/);
    assert.match(brief, /https:\/\/whop\.plunderandriffle\.com\/bridge-code/);
  });
});
