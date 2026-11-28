import "server-only";
import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { isDesignatedOperator } from "@/lib/auth";

/**
 * ─── Site gate + app settings ───────────────────────────────────────
 *
 * AppSetting is a tiny key-value table so the operator can flip
 * product state without a redeploy. Two consumers today:
 *   - the site gate ("site:gate" = "on" | "off") — while ON, every
 *     page route requires a designated-operator session;
 *   - per-stack status overrides ("stack:<id>:status") — lib/stacks.ts.
 *
 * Gate resolution order: the SITE_GATE env var ("on" | "off") wins
 * over the DB row whenever set; with neither present the gate is OFF
 * (the app's historical behavior). Reads are cached for a few seconds
 * so the root layout doesn't hit the DB on every render; writes bust
 * the cache immediately on this instance.
 */

export const GATE_KEY = "site:gate";

export type GateSource = "env" | "db" | "default";
export interface GateState {
  on: boolean;
  source: GateSource;
}

const CACHE_TTL_MS = 10_000;
let gateCache: { state: GateState; at: number } | null = null;

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string, client: Pick<Prisma.TransactionClient, "appSetting"> = db): Promise<void> {
  await client.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

function envGate(): boolean | null {
  const raw = process.env.SITE_GATE?.trim().toLowerCase();
  if (raw === "on") return true;
  if (raw === "off") return false;
  return null;
}

export async function getGateState(): Promise<GateState> {
  const env = envGate();
  if (env !== null) return { on: env, source: "env" };
  if (gateCache && Date.now() - gateCache.at < CACHE_TTL_MS) return gateCache.state;
  let state: GateState = { on: false, source: "default" };
  try {
    const value = await getSetting(GATE_KEY);
    if (value !== null) state = { on: value === "on", source: "db" };
  } catch {
    // DB not ready (e.g. first boot before apply-schema) — stay open
    // rather than locking the operator out of their own site.
    state = { on: false, source: "default" };
  }
  gateCache = { state, at: Date.now() };
  return state;
}

export async function setGate(on: boolean): Promise<GateState> {
  await setSetting(GATE_KEY, on ? "on" : "off");
  gateCache = null;
  return getGateState();
}

/**
 * The gate's pass condition: a REAL signed session belonging to a
 * designated operator. The anonymous operator fallback in lib/auth
 * (viaFallback) deliberately does NOT pass — it is not a session, and
 * treating it as one would leave the gate permanently open.
 */
export async function getSessionOperator(): Promise<User | null> {
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId) return null;
  const user = await db.user.findUnique({ where: { id: sessionUserId } });
  if (!user) return null;
  return isDesignatedOperator(user) ? user : null;
}
