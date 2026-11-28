import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bridgeAgentBrief, permanentAgentBrief } from "./bridge-agent-brief.ts";

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

describe("permanentAgentBrief", () => {
  it("gives an agent the claim credentials and rules for a durable connection", () => {
    const brief = permanentAgentBrief("prk_test-claim", "pru_test-update");
    assert.match(brief, /POST https:\/\/whop\.plunderandriffle\.com\/api\/bridge\/key-claim\/exchange/);
    assert.match(brief, /Authorization: Bearer pru_test-update/);
    assert.match(brief, /\{"code": "prk_test-claim"\}/);
    assert.match(brief, /works once and expires in 24 hours/);
    assert.match(brief, /https:\/\/bot\.plunderandriffle\.com\/api\/mcp/);
    assert.match(brief, /secure storage/);
    assert.match(brief, /Never print either back to the member/);
    assert.match(brief, /Quote the exact credit cost and wait.*"go"/);
    assert.match(brief, /revoke .* at https:\/\/whop\.plunderandriffle\.com\/bridge-code/);
  });
});
