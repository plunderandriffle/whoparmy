import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { betaCreateLane, betaTesterUpsertArgs, enrollmentLaneWrite } from "./beta-core.ts";

// Regression: Dave's "Error switching to muse" (2026-11-28). The enroll
// upsert's create branch carried lane: null (existing-tester switch
// shape) and no user relation connect; Prisma validates both branches
// up front, so the call failed with "Argument `user` is missing" before
// the update branch could run. These tests run the route's exact args
// builder against a real Prisma client + temp SQLite DB.

const folder = mkdtempSync(join(tmpdir(), "whop-beta-upsert-"));
const file = join(folder, "test.db");
process.env.DATABASE_URL = `file:${file}`;
const db = new PrismaClient();

const blankCreate = { museMail: "", deliveryEmail: "", niche: "", boardHandle: "", businessName: "", businessWebsite: undefined };

before(() => {
  const sqlite = new DatabaseSync(file);
  sqlite.exec(readFileSync(new URL("../../prisma/schema.sql", import.meta.url), "utf8"));
  sqlite.close();
});
after(async () => {
  await db.$disconnect();
  rmSync(folder, { recursive: true, force: true });
});

async function freshUser(email: string): Promise<string> {
  const u = await db.user.create({ data: { email, name: "Beta" } });
  return u.id;
}

test("args shape: create always connects the user and never carries a null lane", () => {
  // Dave's exact case: existing tester switching to muse.
  const laneWrite = enrollmentLaneWrite("muse", true);
  const args = betaTesterUpsertArgs({ userId: "u1", createLane: betaCreateLane(laneWrite, "agent37"), updateLane: laneWrite.update, create: blankCreate, update: {} });
  assert.equal(args.create.lane, "muse");
  assert.deepEqual(args.create.user, { connect: { id: "u1" } });
  assert.equal("userId" in args.create, false);
  assert.equal(args.update.lane, "muse");
});

test("no-row lane switch / enroll succeeds and lands on the chosen lane", async () => {
  const uid = await freshUser("norow@example.com");
  const laneWrite = enrollmentLaneWrite("muse", false);
  const t = await db.betaTester.upsert(betaTesterUpsertArgs({
    userId: uid,
    createLane: betaCreateLane(laneWrite, null),
    updateLane: laneWrite.update,
    create: blankCreate,
    update: { niche: undefined, boardHandle: undefined },
  }));
  assert.equal(t.lane, "muse");
  assert.equal(t.userId, uid);
});

test("no-row Agent37 enroll succeeds with its delivery email", async () => {
  const uid = await freshUser("agent37@example.com");
  const laneWrite = enrollmentLaneWrite("agent37", false);
  const t = await db.betaTester.upsert(betaTesterUpsertArgs({
    userId: uid,
    createLane: betaCreateLane(laneWrite, null),
    updateLane: laneWrite.update,
    create: { ...blankCreate, deliveryEmail: "agent37@example.com" },
    update: { deliveryEmail: "agent37@example.com" },
  }));
  assert.equal(t.lane, "agent37");
  assert.equal(t.deliveryEmail, "agent37@example.com");
});

test("existing-tester switch changes only the lane (Dave's failing case)", async () => {
  const uid = await freshUser("switch@example.com");
  await db.betaTester.create({
    data: { user: { connect: { id: uid } }, lane: "agent37", niche: "roofing", boardHandle: "roofking", deliveryEmail: "switch@example.com" },
  });
  const laneWrite = enrollmentLaneWrite("muse", true);
  const t = await db.betaTester.upsert(betaTesterUpsertArgs({
    userId: uid,
    createLane: betaCreateLane(laneWrite, "agent37"),
    updateLane: laneWrite.update,
    create: blankCreate,
    update: { niche: "roofing", boardHandle: "roofking" },
  }));
  assert.equal(t.lane, "muse");
  assert.equal(t.niche, "roofing");
  assert.equal(t.boardHandle, "roofking");
  assert.equal(t.deliveryEmail, "switch@example.com");
});
