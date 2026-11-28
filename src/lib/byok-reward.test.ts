import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "./bridge-byok" ? "./bridge-byok.ts" : specifier, context);
  },
});
const { splitByokReward, syncByokRewardsWithStore } = await import("./byok-reward.ts").finally(() => hooks.deregister());

type SyncInput = Parameters<typeof syncByokRewardsWithStore>[0];
type GrantRow = Awaited<ReturnType<SyncInput["store"]["listGrants"]>>[number];

const saved = { links: true, llm: true, giphy: true, fish: true, herenow: true, renderer: true };

function fixture(overrides: Partial<SyncInput> = {}) {
  const rows = new Map<string, GrantRow>();
  const calls: { externalId: string; amount: number }[] = [];
  const input: SyncInput = {
    userId: "member",
    hasEngineKey: true,
    settings: { enabled: true, total: 500 },
    saved,
    linkSaveFreeGens: 25,
    store: {
      async listGrants() { return [...rows.values()]; },
      async recordGrant(_userId, row) {
        assert.ok(!rows.has(row.externalId));
        rows.set(row.externalId, row);
        return row;
      },
    },
    async grant(externalId, amount) {
      calls.push({ externalId, amount });
      return true;
    },
    ...overrides,
  };
  return { input, rows, calls, sync: () => syncByokRewardsWithStore(input) };
}

test("splits evenly with the remainder on the last step", () => {
  assert.deepEqual(splitByokReward(500), [83, 83, 83, 83, 83, 85]);
  assert.deepEqual(splitByokReward(0), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(splitByokReward(6), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(splitByokReward(100_001.5), splitByokReward(100_000));
});

test("each saved step pays once, in order, with links net of the existing 25", async () => {
  const { sync, input, calls, rows } = fixture({ saved: { ...saved, fish: false } });
  const first = await sync();
  assert.deepEqual(first.steps.map(({ key, granted }) => [key, granted]), [
    ["links", true], ["llm", true], ["giphy", true], ["fish", false], ["herenow", true], ["renderer", true],
  ]);
  assert.deepEqual(calls.map(({ amount }) => amount), [58, 83, 83, 83, 85]);
  assert.equal(rows.get("byok-step:member:links")?.amount, 58);
  assert.equal(first.earned, 417);
  assert.deepEqual(await sync(), first);
  assert.equal(calls.length, 5);

  input.saved = saved;
  const complete = await sync();
  assert.deepEqual(calls.at(-1), { externalId: "byok-step:member:fish", amount: 83 });
  assert.equal(complete.earned, 500);
});

test("a links slice below 25 is record-only and keeps its historical value", async () => {
  const { sync, input, calls, rows } = fixture({ settings: { enabled: true, total: 100 } });
  const first = await sync();
  assert.deepEqual(first.steps[0], { key: "links", label: "offer links", amount: 16, granted: true });
  assert.equal(first.earned, 100);
  assert.equal(rows.get("byok-step:member:links")?.amount, 0);
  assert.deepEqual(calls.map(({ amount }) => amount), [16, 16, 16, 16, 20]);

  input.settings = { enabled: true, total: 500 };
  const next = await sync();
  assert.deepEqual(next.steps, first.steps);
  assert.equal(next.earned, 100);
  assert.equal(calls.length, 5);
});

test("a total change updates only the pending steps", async () => {
  const { sync, input } = fixture({ saved: { ...saved, renderer: false } });
  await sync();
  input.settings = { enabled: true, total: 600 };
  const next = await sync();
  assert.deepEqual(next.steps.map(({ amount }) => amount), [83, 83, 83, 83, 83, 100]);
  assert.equal(next.earned, 415);
});

test("disabled and zero totals report rewards without granting", async () => {
  const { sync, input, calls, rows } = fixture({ settings: { enabled: false, total: 500 } });
  assert.equal((await sync()).enabled, false);
  input.settings = { enabled: true, total: 0 };
  const zero = await sync();
  assert.equal(zero.earned, 0);
  assert.ok(zero.steps.every(({ amount, granted }) => amount === 0 && !granted));
  assert.equal(calls.length, 0);
  assert.equal(rows.size, 0);
});

test("a failed bot response or network error leaves no row and retries", async () => {
  const { sync, input, rows, calls } = fixture();
  const grant = input.grant;
  let failing = true;
  input.grant = async (externalId, amount) => {
    if (failing && externalId.endsWith(":llm")) return false;
    if (failing && externalId.endsWith(":renderer")) throw new Error("Bot unavailable");
    return grant(externalId, amount);
  };
  assert.equal((await sync()).earned, 332);
  assert.equal(rows.has("byok-step:member:llm"), false);
  assert.equal(rows.has("byok-step:member:renderer"), false);
  failing = false;
  assert.equal((await sync()).earned, 500);
  assert.deepEqual(calls.slice(-2), [
    { externalId: "byok-step:member:llm", amount: 83 }, { externalId: "byok-step:member:renderer", amount: 85 },
  ]);
});

test("no engine key or no trusted unlock payload cannot trigger grants", async () => {
  const { sync, input, calls, rows } = fixture({ hasEngineKey: false });
  assert.equal((await sync()).earned, 0);
  input.hasEngineKey = true;
  input.saved = null;
  assert.equal((await sync()).earned, 0);
  assert.equal(rows.size, 0);
  assert.equal(calls.length, 0);
});
