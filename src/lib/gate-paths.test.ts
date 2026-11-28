import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGateExempt, safeReturnPath } from "./gate-paths.ts";

describe("isGateExempt", () => {
  it("keeps the game hand-off pages open", () => {
    for (const p of ["/gate", "/connect", "/connect/ABCD-1234", "/bridge", "/claim", "/agents", "/agent/btc-barry", "/apps", "/apps/roofing-lead-finder", "/rotator"]) {
      assert.equal(isGateExempt(p), true, p);
    }
  });

  it("keeps everything else behind the gate", () => {
    for (const p of ["/", "/admin", "/clips", "/muse-week", "/bridgex", "/claims", "/gateway", "/appsx", "/rotatorx", "/r/abc"]) {
      assert.equal(isGateExempt(p), false, p);
    }
  });
});

describe("safeReturnPath", () => {
  it("accepts the hand-off pages and keeps their query", () => {
    assert.equal(safeReturnPath("/claim?code=W1.abc.def"), "/claim?code=W1.abc.def");
    assert.equal(safeReturnPath("/bridge?ref=dave"), "/bridge?ref=dave");
    assert.equal(safeReturnPath("/bridge-code"), "/bridge-code");
    assert.equal(safeReturnPath("/bridge-code?from=teaser"), "/bridge-code?from=teaser");
    assert.equal(safeReturnPath("/"), "/");
  });

  it("drops a fragment", () => {
    assert.equal(safeReturnPath("/bridge?ref=x#links"), "/bridge?ref=x");
  });

  it("refuses anything that could leave the site", () => {
    for (const raw of [
      "https://evil.example/claim",
      "//evil.example/claim",
      "/\\evil.example/claim",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/claim\n",
      "claim",
    ]) {
      assert.equal(safeReturnPath(raw), null, JSON.stringify(raw));
    }
  });

  it("refuses pages that are not hand-off pages", () => {
    for (const raw of ["/admin", "/connect/ABCD", "/gate", "/clips?x=1", "/claim/../admin"]) {
      assert.equal(safeReturnPath(raw), null, raw);
    }
  });

  it("refuses non-strings, empties and oversized values", () => {
    assert.equal(safeReturnPath(undefined), null);
    assert.equal(safeReturnPath(42), null);
    assert.equal(safeReturnPath("   "), null);
    assert.equal(safeReturnPath(`/claim?code=${"a".repeat(1200)}`), null);
  });
});
