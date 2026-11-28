import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { exchangeKeyClaim, handOutKeyClaim, handOutUpdateToken, revokeKeyClaimCredentials, UPDATE_TOKEN_PREFIX } from "./key-claim-core";
export { BRIDGE_KEY_CLAIM_TTL_MS, KEY_CLAIM_PREFIX, UPDATE_TOKEN_PREFIX, hashKeyClaimCode, isKeyClaimCode, isUsableKeyClaim } from "./key-claim-core";
import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { isDesignatedOperator } from "@/lib/auth";
import { EXPERIMENT_GENERATING_COSTS, codeTtlMsForScope } from "@/lib/experiment-scope";
import { publicUpdateTokenStatus, tokenKind } from "@/lib/update-token-core";
import { BRIDGE_FREE_TOOLS, bridgeToolAllowedByTables, filterBridgeTools, withMissingBridgeTools } from "@/lib/bridge-tool-policy";
export { BRIDGE_FREE_TOOLS } from "@/lib/bridge-tool-policy";
import { byokViewFromUnlockPayload, type BridgeByokView } from "@/lib/bridge-byok";
import type { ByokRewards } from "@/lib/byok-reward";
import { syncByokRewards } from "@/lib/byok-reward-server";
import { claimFreeDay, getFreeDay, getFreeDayForUser } from "@/lib/free-day-server";
import { MarketplaceError } from "@/lib/marketplace-server";
export type { BridgeByokView } from "@/lib/bridge-byok";

/**
 * ─── Muse bridge connector (Dave, 2026-11-17) ───────────────────────
 *
 * The end result Dave set: a member creates a Muse account, pastes ONE
 * command from whop.plunderandriffle.com, and their Muse makes a week
 * of content — calling the P&R MCP **linked to that member**, spending
 * **that member's credits**.
 *
 * How the link works (no new bot scope needed — verified in bot code):
 * the bot already runs a Whop bridge (`bot/src/lib/whop-bridge-routes.ts`):
 * POST /api/bridge/whop/key, authenticated by the shared WHOP_BRIDGE_KEY,
 * returns ONE agent key per Whop user, derived server-side
 * (HMAC of a bot-only secret + whopUserId), scoped mcp:read + mcp:write
 * (never publish), with plan allowances granted on the member's Whop
 * billing cycle. Every generation on that key charges the member's own
 * P&R balance; failures refund bot-side.
 *
 * This app is the face of that bridge for external agents:
 *   member's Muse ──Bearer prb_…──► POST /api/bridge/mcp (here)
 *     ──derived agent key──► bot.plunderandriffle.com/api/mcp
 *
 * Rules held throughout:
 * - The derived agent key is fetched server-to-server, cached in memory
 *   only, NEVER written to the database, NEVER returned to a browser or
 *   to the member's Muse. The only credential the agent holds is the
 *   bridge token (prb_…), stored here as a SHA-256 hash, revocable,
 *   dead after 7 days (one pairing funds one week — Dave, 2026-11-17).
 * - The token carries ONE approved budget (the week quote). Generating
 *   calls reserve their list cost against it before they run and settle
 *   at the engine's actual charge (balance delta) after; a failed call
 *   settles at 0 because the bot refunds it.
 * - Publishing and MP4 rendering are NOT in the allowlist: the member
 *   approves pieces first, per the standing approval rules. Member
 *   unlock tools are available through the derived key.
 */

// ─── Config ─────────────────────────────────────────────────────────

export function botBaseUrl(): string {
  return (process.env.BOT_BRIDGE_BASE_URL?.trim() || process.env.PR_ENGINE_BASE_URL?.trim() || "https://bot.plunderandriffle.com").replace(/\/$/, "");
}

export function bridgeSharedKey(): string | null {
  return process.env.WHOP_BRIDGE_KEY?.trim() || null;
}

export const BRIDGE_TOKEN_PREFIX = "prb_";
export const BRIDGE_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000; // one pairing = one week
export const BRIDGE_CODE_TTL_MS = 24 * 60 * 60_000; // 24 hours to paste (Dave, 2026-11-23; was 15 minutes)
/** The week at list prices: 7 × create_demo_pack (115). The member sees
 *  this number and the bot-quoted balance before anything spends. */
export const WEEK_BUDGET_CREDITS = 7 * 115;
export const MAX_BUDGET_CREDITS = 5000;
/** A budget reservation older than this is presumed abandoned and swept. */
export const RESERVATION_STALE_MS = 15 * 60_000;

// ─── The offers (Dave, 2026-11-17: add both variants) ───────────────
// Three sizes of the same content offer, available to every member. The
// token budget is the only enforcement difference between them; the
// command text on /muse-week carries what the Muse makes. Budgets
// are list-price reserves — calls settle at the actual charge.

export interface BridgeOffer {
  id: "taste" | "week" | "opener";
  name: string;
  budgetCredits: number;
  blurb: string;
}

export const BRIDGE_OFFERS: BridgeOffer[] = [
  { id: "taste", name: "The Taste", budgetCredits: 50, blurb: "One /before — Joe's video about your business, plus the starter pack." },
  { id: "week", name: "The Week", budgetCredits: WEEK_BUDGET_CREDITS, blurb: "Seven day-packs, one per day, seven angles." },
  { id: "opener", name: "Week + Opener", budgetCredits: WEEK_BUDGET_CREDITS + 50, blurb: "The Week, plus a personalized /before pitch for your business." },
];

export const DEFAULT_OFFER_ID = "week";

export function bridgeOffer(id: unknown): BridgeOffer {
  return BRIDGE_OFFERS.find((o) => o.id === id) ?? BRIDGE_OFFERS.find((o) => o.id === DEFAULT_OFFER_ID)!;
}

const WHOP_USER_RE = /^user_[A-Za-z0-9]{4,64}$/;

// ─── Plan mapping ───────────────────────────────────────────────────
// Bot bridge plans are free | creator | pro. Whoparmy's AGENCY rides
// the bot's top plan (pro); its extra seats/allowance stay Whoparmy-side.

export type BotPlan = "free" | "creator" | "pro";

export function botPlanFor(user: Pick<User, "plan">): BotPlan {
  if (user.plan === "CREATOR") return "creator";
  if (user.plan === "PRO" || user.plan === "AGENCY") return "pro";
  return "free";
}

// The bridge is available to every signed-in member. Kept as a helper
// for callers that display eligibility; plan does not affect access.

export function bridgeEligible(_user: Pick<User, "plan" | "whopId" | "whopUsername">): boolean { return true; }

export function assertBridgeEligible(user: Pick<User, "plan" | "whopId" | "whopUsername">): void {
  void user; // compatibility no-op; all signed-in members may connect.
}

// ─── Bridge scopes ──────────────────────────────────────────────────
// A bridge code/token carries ONE scope, set at mint and inherited at
// exchange. "week" is the original /muse-week special offer above.
// "clips" is the Clip Factory (Dave, 2026-11-18): a SEPARATE product
// with its own eligibility and allowlist (below). Scopes never mix:
// the MCP route enforces the token's own scope on every call.

// "experiment" is the BTC Experiment's agent connection (Dave,
// 2026-11-20, lib/experiment-scope.ts): any plan with a saved DH
// Media link, on the member's own balance, 24-hour code.
export type BridgeScope = "week" | "clips" | "experiment";

export function normalizeScope(raw: unknown): BridgeScope {
  return raw === "clips" || raw === "experiment" ? raw : "week";
}

/**
 * Strict scope read for stored rows: only the two real scopes are
 * valid. Anything else (legacy junk, corruption, a hand-edited row)
 * is NOT silently upgraded to the week offer — callers treat null as
 * an invalid code/token and refuse.
 */
export function scopeFromStored(raw: unknown): BridgeScope | null {
  return raw === "week" || raw === "clips" || raw === "experiment" ? raw : null;
}

export { redactBridgeSecrets } from "./bridge-redact";

// ─── Clips eligibility — any member spending their own credits ──────
// Dave, 2026-11-18: the Clip Factory is open to ANY signed-in member
// whose account is linked to a P&R credit account (their derived
// engine key); plan is irrelevant — they spend their own credits.
// "Linked" is the same test getMemberEngineKey applies: a real Whop
// user id. The anonymous operator fallback has none, so it cannot
// use the clips lane either (same rule as the claim bridge).

export function hasLinkedCreditAccount(user: Pick<User, "whopId">): boolean {
  return WHOP_USER_RE.test(user.whopId?.trim() ?? "");
}

export function assertClipsEligible(user: Pick<User, "whopId">): void {
  if (!hasLinkedCreditAccount(user)) {
    throw new BridgeError(
      403,
      "NOT_LINKED",
      "The Clip Factory works on your own Plunder & Riffle credits, and this account isn't linked to a credit account yet. Sign in with Whop so your account carries its Whop user id, then try again.",
    );
  }
}

// ─── Experiment eligibility — the BTC Experiment's agent ────────────
// Dave, 2026-11-24: DH Media is an offer activation, not an unlock.
// The engine still needs its own linked credit account.

export async function assertExperimentEligible(user: Pick<User, "id" | "whopId">): Promise<void> {
  if (!hasLinkedCreditAccount(user)) {
    throw new BridgeError(
      403,
      "NOT_LINKED",
      "Your agent works on your own Plunder & Riffle credits, and this account isn't linked to them yet. Sign in with Whop, then try again.",
    );
  }
}

// ─── Tool allowlist ─────────────────────────────────────────────────
// Free tools never touch the budget. Generating tools reserve their
// LIST cost (from the bot MCP's own tool descriptions) and settle at
// the actual charge. Free tools, including member unlock/key tools, are
// allowed. Publishing (publish_clip, post_to_socials) and MP4 rendering
// (request_mp4) remain refused.

/** Week-scope generating tools (the /muse-week offer's allowlist). */
export const BRIDGE_GENERATING_COSTS: Record<string, number> = {
  create_demo_pack: 115,
  create_before_pitch: 50,
  generate_ad_creative: 60,
  generate_multilanguage_ads: 60,
  // create_sitdown is deliberately NOT here: it belongs to the Clip
  // Factory's scope (below). When it also sat in the week table, a
  // week token could call the engine's general sit-down directly and
  // walk around both the plan gate and the clip intake.
};

/**
 * Clips-scope generating tools — deliberately a SEPARATE table, never
 * merged into the week's. A clips token must not be able to call the
 * week offer's generating tools, or any plan could walk around the
 * bridge token through the clips lane; and a week token
 * must not gain create_sitdown, which belongs to the Clip Factory.
 * create_sitdown list cost is 25 (the engine's own tool table).
 */
export const CLIPS_GENERATING_COSTS: Record<string, number> = {
  create_sitdown: 25,
};

export function generatingCostsForScope(scope: BridgeScope): Record<string, number> {
  if (scope === "clips") return CLIPS_GENERATING_COSTS;
  if (scope === "experiment") return EXPERIMENT_GENERATING_COSTS;
  return BRIDGE_GENERATING_COSTS;
}

export function bridgeToolAllowedForScope(scope: BridgeScope, name: string): boolean {
  // Object.hasOwn, never `in`: `in` walks the prototype chain, so a
  // tool literally named "constructor" or "toString" would pass.
  return bridgeToolAllowedByTables(name, BRIDGE_FREE_TOOLS, generatingCostsForScope(scope));
}

/** Week-scope check (the original behavior, kept for existing callers). */
export function bridgeToolAllowed(name: string): boolean {
  return bridgeToolAllowedForScope("week", name);
}

export function estimateToolCostForScope(scope: BridgeScope, name: string, args: Record<string, unknown>): number {
  const base = generatingCostsForScope(scope)[name] ?? 0;
  if (name === "generate_multilanguage_ads" && Array.isArray(args.languages)) {
    // List pricing is per language; reserve per DISTINCT language
    // (duplicates don't render twice), capped at the engine's six.
    const distinct = new Set(
      args.languages.filter((l): l is string => typeof l === "string").map((l) => l.trim().toLowerCase()),
    ).size;
    return base * Math.max(1, Math.min(6, distinct));
  }
  if (name === "create_before_pitch" && typeof args.song_url === "string" && args.song_url.trim()) {
    // The engine charges +30 for the bonus song video (song_url arg).
    return base + 30;
  }
  return base;
}

/** Week-scope estimate (the original behavior, kept for existing callers). */
export function estimateToolCost(name: string, args: Record<string, unknown>): number {
  return estimateToolCostForScope("week", name, args);
}

// ─── The member's derived engine key (memory cache only) ────────────

export interface MemberKeyResult {
  key: string;
  plan: BotPlan;
  credits: number;
  granted: number;
  period: string;
}

const keyCache = new Map<string, { whopId: string; result: MemberKeyResult; fetchedAt: number }>();
const KEY_CACHE_TTL_MS = 10 * 60_000;

export class BridgeError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Fetch (or reuse) the member's own P&R agent key from the bot bridge.
 * Side effect: upserts the BridgeConnection snapshot (status/credits —
 * never the key). Throws BridgeError with an honest code:
 * NO_WHOP_ID (operator/fallback account), NOT_CONFIGURED (the shared
 * key is unset here or the bot bridge answers 503), BLOCKED (the bot
 * refuses this customer — their key was revoked), BOT_UNREACHABLE.
 */
export async function getMemberEngineKey(user: User, opts: { fresh?: boolean } = {}): Promise<MemberKeyResult> {
  const whopId = user.whopId?.trim() ?? "";
  if (!WHOP_USER_RE.test(whopId)) {
    throw new BridgeError(400, "NO_WHOP_ID", "This account has no Whop user id, so it has no P&R credit account to link. Sign in with Whop first.");
  }
  const shared = bridgeSharedKey();
  if (!shared) {
    throw new BridgeError(503, "NOT_CONFIGURED", "The Muse bridge is not configured on this app yet (WHOP_BRIDGE_KEY is unset).");
  }
  if (!opts.fresh) {
    const cached = keyCache.get(user.id);
    if (cached?.whopId === whopId && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) return cached.result;
  }
  let res: Response;
  try {
    res = await fetch(`${botBaseUrl()}/api/bridge/whop/key`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-key": shared },
      body: JSON.stringify({ whopUserId: whopId, plan: botPlanFor(user) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new BridgeError(502, "BOT_UNREACHABLE", "The Plunder & Riffle engine did not answer. Nothing was charged; try again in a moment.");
  }
  if (res.status === 401 || res.status === 503) {
    await markConnection(user.id, "UNCONFIGURED");
    throw new BridgeError(503, "NOT_CONFIGURED", "The Muse bridge is not configured on the engine side yet.");
  }
  if (res.status === 403) {
    forgetMemberKey(user.id);
    await markConnection(user.id, "BLOCKED");
    throw new BridgeError(403, "BLOCKED", "No P&R key is available for this account. Contact support.");
  }
  if (!res.ok) {
    throw new BridgeError(502, "BOT_UNREACHABLE", `The engine answered HTTP ${res.status}. Nothing was charged.`);
  }
  const json = (await res.json()) as { ok?: boolean; key?: string; plan?: BotPlan; credits?: number; granted?: number; period?: string };
  if (!json.ok || !json.key) {
    throw new BridgeError(502, "BOT_UNREACHABLE", "The engine returned no key. Nothing was charged.");
  }
  const result: MemberKeyResult = {
    key: json.key,
    plan: json.plan ?? botPlanFor(user),
    credits: typeof json.credits === "number" ? json.credits : 0,
    granted: typeof json.granted === "number" ? json.granted : 0,
    period: typeof json.period === "string" ? json.period : "",
  };
  keyCache.set(user.id, { whopId, result, fetchedAt: Date.now() });
  await db.bridgeConnection.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      botPlan: result.plan,
      period: result.period || null,
      credits: result.credits,
      granted: result.granted,
      status: "ACTIVE",
      lastFetchedAt: new Date(),
    },
    update: {
      botPlan: result.plan,
      period: result.period || null,
      credits: result.credits,
      granted: result.granted,
      status: "ACTIVE",
      lastFetchedAt: new Date(),
    },
  }).catch(() => undefined); // the snapshot must never break the key path
  return result;
}

async function markConnection(userId: string, status: string): Promise<void> {
  await db.bridgeConnection.upsert({
    where: { userId },
    create: { userId, botPlan: "free", status },
    update: { status },
  }).catch(() => undefined);
}

/** Test seam + logout hygiene: forget the cached derived key. */
export function forgetMemberKey(userId: string): void {
  keyCache.delete(userId);
}

// ─── Raw MCP calls on a member key ──────────────────────────────────

interface McpReply {
  result?: { content?: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
  error?: { code?: number; message?: string };
}

/** Exported so the clip dispatcher drives the same MCP path as the bridge. */
export async function mcpCall(key: string, method: string, params: Record<string, unknown>): Promise<McpReply> {
  const res = await fetch(`${botBaseUrl()}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: ["Bearer", key].join(" "),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new BridgeError(502, "BOT_UNREACHABLE", `The engine answered HTTP ${res.status}.`);
  const text = await res.text();
  try {
    return JSON.parse(text) as McpReply;
  } catch {
    // SSE framing: take the last data: line, like the stdio bridge does.
    const data = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).pop();
    if (data) return JSON.parse(data.slice(5).trim()) as McpReply;
    throw new BridgeError(502, "BOT_UNREACHABLE", "The engine returned an unreadable reply.");
  }
}

function resultPayload(reply: McpReply): Record<string, unknown> | null {
  const r = reply.result;
  if (!r) return null;
  if (r.structuredContent) return r.structuredContent;
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The member's live P&R balance on their own key (-1 = unlimited). */
export async function getMemberCredits(key: string): Promise<number | null> {
  try {
    const reply = await mcpCall(key, "tools/call", { name: "get_account", arguments: {} });
    const payload = resultPayload(reply);
    const credits = payload?.credits;
    return typeof credits === "number" ? credits : null;
  } catch {
    return null;
  }
}

/**
 * The member's BYOK state, read with their own derived key through the
 * engine's check_my_unlock (Dave, 2026-11-24): which unlocks are saved
 * on their record + the live MP4 quote. Null whenever the check can't
 * run or answers an unrecognizable payload — the account view must
 * degrade to its plain presentation, never break over this.
 */
export async function getMemberByok(key: string): Promise<BridgeByokView | null> {
  try {
    const reply = await mcpCall(key, "tools/call", { name: "check_my_unlock", arguments: {} });
    if (reply.result?.isError) return null;
    return byokViewFromUnlockPayload(resultPayload(reply));
  } catch {
    return null;
  }
}

// ─── Bridge codes + tokens ──────────────────────────────────────────

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function newBridgeCode(): string {
  const raw = randomBytes(8).toString("hex").toUpperCase(); // 16 chars
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function keyHandoutSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new BridgeError(503, "NOT_CONFIGURED", "Durable key handout is not configured.");
  return secret;
}

let sqliteKeyClaimWriteQueue: Promise<unknown> = Promise.resolve();

function keyClaimTransaction<Result>(write: (tx: Prisma.TransactionClient) => Promise<Result>): Promise<Result> {
  const result = sqliteKeyClaimWriteQueue.then(() => db.$transaction(write));
  sqliteKeyClaimWriteQueue = result.catch(() => undefined);
  return result;
}

function keyHandoutStore(tx: Prisma.TransactionClient): Parameters<typeof handOutKeyClaim>[0] {
  return {
    findLiveToken: (userId) => tx.bridgeUpdateToken.findFirst({ where: { userId, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    findLiveClaim: (userId, now) => tx.bridgeKeyClaim.findFirst({ where: { userId, usedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } }),
    revokeTokens: async (userId, now) => (await tx.bridgeUpdateToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })).count,
    retireClaims: async (userId, now) => { await tx.bridgeKeyClaim.updateMany({ where: { userId, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } }); },
    createToken: async (data) => { await tx.bridgeUpdateToken.create({ data }); },
    createClaim: async (data) => { await tx.bridgeKeyClaim.create({ data }); },
  };
}

export async function getOrCreateBridgeKeyClaim(userId: string): Promise<{ code: string; expiresAt: Date; token: string }> {
  const secret = keyHandoutSecret();
  return keyClaimTransaction((tx) => handOutKeyClaim(keyHandoutStore(tx), userId, secret, new Date()));
}

export async function exchangeBridgeKeyClaim(rawCode: string, updateToken: string | null): Promise<{ key: string; plan: BotPlan; credits: number; period: string; userId: string }> {
  const { member, userId } = await exchangeKeyClaim({
    findToken: (tokenHash) => db.bridgeUpdateToken.findUnique({ where: { tokenHash } }),
    findClaim: (codeHash) => db.bridgeKeyClaim.findUnique({ where: { codeHash } }),
    findMember: (id) => db.user.findUnique({ where: { id } }),
    fetchEngineKey: (owner) => getMemberEngineKey(owner, { fresh: true }),
    consume: (claimId, tokenId, userId) => keyClaimTransaction(async (tx) => {
      const token = await tx.bridgeUpdateToken.findFirst({ where: { id: tokenId, userId, revokedAt: null }, select: { id: true } });
      if (!token) return "token_revoked";
      const now = new Date();
      const claimed = await tx.bridgeKeyClaim.updateMany({
        where: { id: claimId, userId, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        const expired = await tx.bridgeKeyClaim.findFirst({ where: { id: claimId, userId, usedAt: null, expiresAt: { lte: now } }, select: { id: true } });
        return expired ? "claim_expired" : "claim_race_lost";
      }
      await tx.bridgeUpdateToken.update({ where: { id: tokenId }, data: { lastUsedAt: now } });
      return "claimed";
    }),
  }, rawCode, updateToken);
  return { key: member.key, plan: member.plan, credits: member.credits, period: member.period, userId };
}

export async function mintBridgeCode(
  userId: string,
  budgetCredits: number,
  scope: BridgeScope = "week",
): Promise<{ code: string; expiresAt: Date; budgetCredits: number; scope: BridgeScope }> {
  // All codes snapshot the member's own balance; zero is a real value.
  const truncated = Math.trunc(budgetCredits);
  // Experiment codes budget like clips: the member's own balance,
  // where zero is real.
  const budget =
    Math.max(0, Math.min(MAX_BUDGET_CREDITS, Number.isFinite(truncated) ? truncated : 0));
  const code = newBridgeCode();
  // 24 hours for every scope (Dave, 2026-11-23; experiment codes were already 24h, 2026-11-20),
  // so a code survives the member setting up their agent.
  const expiresAt = new Date(Date.now() + codeTtlMsForScope(scope));
  // A fresh code retires every unused one before it: only one live code
  // per member (across BOTH scopes), so a code left on an old page can
  // never be exchanged. Retire + create run in ONE transaction: two
  // concurrent mints can no longer interleave into two live codes.
  await db.$transaction(async (tx) => {
    await tx.bridgeCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.bridgeCode.create({ data: { userId, codeHash: sha256(code), budgetCredits: budget, expiresAt, scope } });
  });
  return { code, expiresAt, budgetCredits: budget, scope };
}

export async function exchangeBridgeCode(rawCode: string): Promise<{ token: string; expiresAt: Date; budgetCredits: number; userId: string; scope: BridgeScope }> {
  const code = (rawCode ?? "").trim().toUpperCase();
  if (!code) throw new BridgeError(400, "BAD_CODE", "That bridge code isn't valid.");
  const row = await db.bridgeCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!row || row.usedAt) throw new BridgeError(400, "BAD_CODE", "That bridge code isn't valid.");
  const scope = scopeFromStored(row.scope);
  if (!scope) throw new BridgeError(400, "BAD_CODE", "That bridge code isn't valid.");
  if (row.expiresAt.getTime() <= Date.now()) {
    const where = scope === "clips" ? "in the Clip Factory" : scope === "experiment" ? "at whop.plunderandriffle.com/bridge" : "on /bridge-code";
    throw new BridgeError(400, "BAD_CODE", `That bridge code expired. Generate a fresh one ${where}.`);
  }
  // Eligibility is re-checked at exchange, PER SCOPE: a member
  // downgraded after minting holds a week code that no longer opens
  // the offer; a clips code re-checks the linked-account test instead
  // (plan never enters it). The code is NOT consumed by this refusal —
  // it works again if eligibility returns inside its 24 hours.
  const owner = await db.user.findUnique({ where: { id: row.userId } });
  if (!owner) throw new BridgeError(400, "BAD_CODE", "That bridge code isn't valid.");
  if (scope === "clips") assertClipsEligible(owner);
  else if (scope === "experiment") await assertExperimentEligible(owner);
  else assertBridgeEligible(owner);
  // Single-use: claim the code AND create the token in one
  // transaction — a crash between the two used to burn the code
  // without issuing a token. A raced double exchange fails the
  // conditional claim and rolls the whole exchange back.
  const token = BRIDGE_TOKEN_PREFIX + randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + BRIDGE_TOKEN_TTL_MS);
  await db.$transaction(async (tx) => {
    const claimed = await tx.bridgeCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new BridgeError(400, "BAD_CODE", "That bridge code isn't valid.");
    await tx.bridgeToken.create({
      data: { userId: row.userId, tokenHash: sha256(token), budgetCredits: row.budgetCredits, expiresAt, scope },
    });
  });
  return { token, expiresAt, budgetCredits: row.budgetCredits, userId: row.userId, scope };
}

/**
 * Look up a live (unused, unexpired) bridge code WITHOUT consuming
 * it — the /connect/[code] agent-link page renders from this.
 * Viewing never burns the code; only exchangeBridgeCode claims it,
 * and exchange re-checks eligibility per scope. Returns null for
 * unknown, used, or expired codes alike (no oracle about which).
 */
export async function findLiveBridgeCode(
  rawCode: string,
): Promise<{ budgetCredits: number; scope: BridgeScope; expiresAt: Date; user: User } | null> {
  const code = (rawCode ?? "").trim().toUpperCase();
  if (!code) return null;
  const row = await db.bridgeCode.findUnique({ where: { codeHash: sha256(code) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  const scope = scopeFromStored(row.scope);
  if (!scope) return null;
  return {
    budgetCredits: row.budgetCredits,
    scope,
    expiresAt: row.expiresAt,
    user: row.user,
  };
}

export interface BridgeSession {
  tokenId: string;
  user: User;
  budgetCredits: number;
  spentCredits: number;
  expiresAt: Date;
  scope: BridgeScope;
}

export async function verifyBridgeToken(raw: string | null): Promise<BridgeSession | null> {
  if (!raw || !raw.startsWith(BRIDGE_TOKEN_PREFIX)) return null;
  const row = await db.bridgeToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;
  const scope = scopeFromStored(row.scope);
  if (!scope) return null; // unknown stored scope: not a usable token
  await db.bridgeToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return {
    tokenId: row.id,
    user: row.user,
    budgetCredits: row.budgetCredits,
    spentCredits: row.spentCredits,
    expiresAt: row.expiresAt,
    scope,
  };
}

export type AnyBridgeToken = { kind: "spend"; session: BridgeSession } | { kind: "update"; userId: string };

export async function verifyUpdateToken(raw: string | null): Promise<{ userId: string } | null> {
  if (!raw || !raw.startsWith(UPDATE_TOKEN_PREFIX)) return null;
  const row = await (db as any).bridgeUpdateToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!row || row.revokedAt) return null;
  await (db as any).bridgeUpdateToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { userId: row.userId };
}

export async function verifyAnyBridgeToken(raw: string | null): Promise<AnyBridgeToken | null> {
  if (tokenKind(raw) === "update") {
    const verified = await verifyUpdateToken(raw);
    return verified ? { kind: "update", userId: verified.userId } : null;
  }
  const session = await verifyBridgeToken(raw);
  return session ? { kind: "spend", session } : null;
}

export function bridgeTokenCanSpend(token: AnyBridgeToken | null): token is Extract<AnyBridgeToken, { kind: "spend" }> {
  return token?.kind === "spend";
}

export async function getOrCreateUpdateToken(userId: string): Promise<{ token: string; createdAt: Date }> {
  const secret = keyHandoutSecret();
  return keyClaimTransaction((tx) => handOutUpdateToken(keyHandoutStore(tx), userId, secret, new Date()));
}

export async function revokeUpdateTokens(userId: string): Promise<number> {
  return keyClaimTransaction((tx) => revokeKeyClaimCredentials(keyHandoutStore(tx), userId, new Date()));
}

export async function getUpdateTokenStatus(userId: string): Promise<{ active: boolean; createdAt: Date | null; lastUsedAt: Date | null }> {
  const row = await (db as any).bridgeUpdateToken.findFirst({ where: { userId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true, lastUsedAt: true } });
  return publicUpdateTokenStatus(row);
}

export async function revokeBridgeToken(tokenId: string, userId: string): Promise<boolean> {
  const out = await db.bridgeToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return out.count === 1;
}

// ─── The proxied tool call ──────────────────────────────────────────

export interface ProxiedCall {
  reply: McpReply;
  charged: number;
}

/**
 * Run one MCP tools/call for a bridge session: allowlist → budget
 * reserve → the member's own key → settle at the actual charge.
 * Refusals come back as MCP tool errors (isError content), the same
 * shape the bot itself uses, so any MCP client shows them to the human.
 */
export async function proxyToolCall(session: BridgeSession, name: string, args: Record<string, unknown>): Promise<ProxiedCall> {
  const toolError = (message: string): ProxiedCall => ({
    reply: { result: { isError: true, content: [{ type: "text", text: message }] } },
    charged: 0,
  });

  // The token's OWN scope decides the allowlist — this is the check
  // that keeps the clips lane from becoming a side door into the
  // week offer (and the week offer out of the Clip Factory's tool).
  const costs = generatingCostsForScope(session.scope);
  if (!bridgeToolAllowedForScope(session.scope, name)) {
    return toolError(
      session.scope === "clips"
        ? `This clips connection cannot call ${name}. A Clip Factory connection runs create_sitdown plus research and account tools on the member's own credits; the week offer's content tools need their own /bridge-code connection, and publishing and MP4 rendering stay with the member's approval inside Whoparmy. Allowed: ${[...BRIDGE_FREE_TOOLS, ...Object.keys(costs)].join(", ")}.`
        : `The Muse bridge cannot call ${name}. It runs research and content generation on the member's own credits; publishing and MP4 rendering stay with the member's approval inside Whoparmy. Allowed: ${[...BRIDGE_FREE_TOOLS, ...Object.keys(costs)].join(", ")}.`,
    );
  }

  // Eligibility re-check on every call, per scope: the week offer
  // re-checks its plan gate (a downgrade kills a live token); the
  // clips lane re-checks only the linked-account test, never plan.
  if (session.scope === "clips") {
    if (!hasLinkedCreditAccount(session.user)) {
      return toolError(
        "This clips connection's account is no longer linked to a Plunder & Riffle credit account. Nothing was charged. The member can re-link by signing in with Whop.",
      );
    }
  }

  if (name === "get_free_day" || name === "claim_free_day") {
    const isClaim = name === "claim_free_day";
    const { date } = args;
    if (Object.keys(args).some((key) => !isClaim || key !== "date")) {
      return toolError(isClaim ? "claim_free_day accepts only the optional date argument." : "get_free_day takes no arguments.");
    }
    if (date !== undefined && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      return toolError("Expected a Free-Day date in YYYY-MM-DD format.");
    }
    try {
      const payload = isClaim ? { claim: await claimFreeDay(session.user.id, date) } : { freeDay: await getFreeDay() };
      return { reply: { result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }, charged: 0 };
    } catch (error) {
      if (error instanceof MarketplaceError) return toolError(error.message);
      console.error(`[free-day] ${name} failed:`, error);
      return toolError(isClaim ? "Could not claim Free Day." : "Could not load Free Day.");
    }
  }

  const member = await getMemberEngineKey(session.user);
  const generating = Object.hasOwn(costs, name);
  const reserve = generating ? estimateToolCostForScope(session.scope, name, args) : 0;

  // Budget RESERVATION, before dispatch (generating calls only). The
  // old flow checked the budget, dispatched, and incremented spent
  // afterwards — two concurrent calls could both pass the check on
  // the same stale spent figure and both settle past the cap. Now
  // the reserve lands atomically first (spent + pending + reserve
  // must fit), and every exit path settles or releases it exactly
  // once. A reservation older than the stale window is presumed
  // abandoned (its caller died mid-flight) and swept back.
  const settleReservation = async (charged: number): Promise<void> => {
    if (!generating) return;
    const apply = async (amount: number) => {
      await db.$transaction(async (tx) => {
        const tok = await tx.bridgeToken.findUnique({ where: { id: session.tokenId } });
        if (!tok) return;
        const pending = Math.max(0, tok.pendingCredits - reserve);
        await tx.bridgeToken.update({
          where: { id: tok.id },
          data: {
            pendingCredits: pending,
            pendingSince: pending > 0 ? tok.pendingSince : null,
            spentCredits: tok.spentCredits + amount,
          },
        });
      });
    };
    try {
      await apply(charged);
    } catch {
      try {
        await apply(charged);
      } catch (err) {
        // Fail closed: if the true settlement cannot be written, the
        // reserve itself becomes the charge rather than vanishing.
        console.error("[bridge] settlement failed twice; charging the reserve", session.tokenId, name, err);
        await apply(reserve).catch((e) => console.error("[bridge] fail-closed settlement also failed", session.tokenId, name, e));
      }
    }
  };

  if (generating) {
    const now = Date.now();
    const reservation = await db.$transaction(async (tx) => {
      const tok = await tx.bridgeToken.findUnique({ where: { id: session.tokenId } });
      if (!tok || tok.revokedAt || tok.expiresAt.getTime() <= now) return { ok: false as const, dead: true, spent: 0 };
      let pending = tok.pendingCredits;
      let pendingSince = tok.pendingSince;
      if (pending > 0 && pendingSince && now - pendingSince.getTime() > RESERVATION_STALE_MS) {
        pending = 0;
        pendingSince = null;
      }
      if (tok.spentCredits + pending + reserve > tok.budgetCredits) {
        return { ok: false as const, dead: false, spent: tok.spentCredits + pending };
      }
      await tx.bridgeToken.update({
        where: { id: tok.id },
        data: { pendingCredits: pending + reserve, pendingSince: pendingSince ?? new Date() },
      });
      return { ok: true as const, dead: false, spent: tok.spentCredits };
    });
    if (!reservation.ok) {
      if (reservation.dead) {
        return toolError("This bridge connection has expired or been revoked. Nothing was charged. The member can open a fresh connection in Whoparmy.");
      }
      return toolError(
        session.scope === "clips"
          ? `This ${name} call would exceed this connection's approved budget (${session.budgetCredits} credits — the member's own balance when the connection was approved, ${reservation.spent} already spent or in flight). Nothing was charged. The member can approve a new clips connection in Whoparmy.`
          : `This ${name} call would exceed the week's approved budget (${session.budgetCredits} credits, ${reservation.spent} already spent or in flight). Nothing was charged. The member can approve a new week budget on /bridge-code.`,
      );
    }
  }

  const preCredits = generating ? await getMemberCredits(member.key) : null;
  let reply: McpReply;
  try {
    reply = await mcpCall(member.key, "tools/call", { name, arguments: args });
  } catch (err) {
    await settleReservation(0);
    throw err;
  }
  if (!generating || reply.result?.isError || reply.error) {
    await settleReservation(0);
    return { reply, charged: 0 };
  }

  // Settle at the ACTUAL charge for THIS call. The reply's own
  // creditCost is call-specific and wins; the member's whole-key
  // balance delta is only the fallback (concurrent activity on the
  // same key would otherwise be billed to this call). A failure
  // refunded bot-side settles at zero.
  const payload = resultPayload(reply);
  const reported = payload && typeof payload.creditsRemaining === "number" ? payload.creditsRemaining : null;
  const postCredits = reported ?? (await getMemberCredits(member.key));
  let charged: number;
  if (payload && typeof payload.creditCost === "number") {
    charged = Math.max(0, Math.trunc(payload.creditCost));
  } else if (preCredits !== null && postCredits !== null && preCredits >= 0 && postCredits >= 0) {
    charged = Math.max(0, preCredits - postCredits);
  } else if (preCredits === -1 || postCredits === -1) {
    charged = 0; // unlimited key: no balance moves, nothing to settle
  } else {
    charged = reserve;
  }

  await settleReservation(charged);
  if (charged > 0) {
    await db.usageRecord.create({
      data: { userId: session.user.id, kind: "BRIDGE", count: 1, meta: `muse-bridge:${name}:${charged}cr` },
    }).catch(() => undefined);
    if (postCredits !== null && postCredits >= 0) {
      await db.bridgeConnection.update({
        where: { userId: session.user.id },
        data: { credits: postCredits },
      }).catch(() => undefined);
    }
  }
  return { reply, charged };
}

const freeDayTools = [
  {
    name: "get_free_day",
    description: "Free Space of the Day: one Space is free each Eastern Time (ET) day. Call this at the start of a session and tell the owner what's free today in one line. Claim only when the owner asks. Returns the ET date, Space, mode, end time and Space URL, or null if no Space is featured. Pass the returned date to claim_free_day.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "claim_free_day",
    description: "Claim only on the owner's word. Pass the date from get_free_day; if the ET day has flipped, the claim is refused (409 semantics). Re-read get_free_day before trying again. KIT: the member gets the house Space kit free and keeps it forever. One claim per member per Space; repeating it returns the same grant. CREDIT: if the member already owns today's house Space, claim a free rotator placement credit instead. It expires at midnight ET seven calendar days after the featured day started. Redeem through POST /api/bridge/rotator/paid with {creditId, date, partner}, using the claim's grantId as creditId and the member's saved link for that partner. VISIT: today's member Space is doing a Handout. The claim books a visit so the member's agent can use that Space until midnight ET tonight; the kit is never given.",
    inputSchema: { type: "object", properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }, additionalProperties: false },
  },
];

/** The member's tool list, filtered to the bridge allowlist. */
export async function proxyToolsList(session: BridgeSession): Promise<unknown> {
  const isEngineTool = (name: string) => bridgeToolAllowedForScope(session.scope, name) && !freeDayTools.some((tool) => tool.name === name);
  const tools = await (async () => {
    const member = await getMemberEngineKey(session.user);
    const reply = await mcpCall(member.key, "tools/list", {});
    return (reply.result as { tools?: Array<{ name?: string }> } | undefined)?.tools;
  })().catch(() => undefined);
  const allowed = [...BRIDGE_FREE_TOOLS, ...Object.keys(generatingCostsForScope(session.scope))].filter(isEngineTool);
  const filtered = Array.isArray(tools) ? filterBridgeTools(tools, isEngineTool) : [];
  return { tools: [...withMissingBridgeTools(filtered, allowed), ...freeDayTools] };
}

// ─── Member-facing account view ─────────────────────────────────────

export interface BridgeAccountView {
  connected: boolean;
  /** All signed-in members may connect; see bridgeEligible. */
  eligible: boolean;
  /** Clip Factory: any member with a linked credit account, any plan. */
  clipsEligible: boolean;
  botPlan: BotPlan;
  credits: number | null;
  granted: number;
  period: string | null;
  /**
   * BYOK recognition (Dave, 2026-11-24): the member's saved unlocks on
   * their engine record, via check_my_unlock on their own key. Null
   * when the member is not linked or the check could not run — the
   * page then keeps its plain allowance presentation.
   */
  byok: BridgeByokView | null;
  rewards: ByokRewards | null;
  freeDay: Awaited<ReturnType<typeof getFreeDayForUser>>;
  brand: { name: string; website: string | null } | null;
  tokens: Array<{ id: string; budgetCredits: number; spentCredits: number; expiresAt: Date; active: boolean; scope: BridgeScope }>;
  weekBudgetCredits: number;
  offers: BridgeOffer[];
  referral: { referrerName: string | null; ownRefCode: string | null };
  error: string | null;
  errorCode: string | null;
}

export async function getBridgeAccountView(user: User): Promise<BridgeAccountView> {
  const [brand, referrer] = await Promise.all([db.brandProfile.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { name: true, website: true },
  }), user.referredById ? db.user.findUnique({ where: { id: user.referredById }, select: { name: true, whopUsername: true } }) : Promise.resolve(null)]);
  const tokens = await db.bridgeToken.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, budgetCredits: true, spentCredits: true, expiresAt: true, revokedAt: true, scope: true },
  });
  const view: BridgeAccountView = {
    connected: false,
    eligible: bridgeEligible(user),
    clipsEligible: hasLinkedCreditAccount(user),
    botPlan: botPlanFor(user),
    credits: null,
    granted: 0,
    period: null,
    byok: null,
    rewards: null,
    freeDay: await getFreeDayForUser(user.id).catch(() => null),
    brand: brand ?? null,
    tokens: tokens.map((t) => ({
      id: t.id,
      budgetCredits: t.budgetCredits,
      spentCredits: t.spentCredits,
      expiresAt: t.expiresAt,
      active: !t.revokedAt && t.expiresAt.getTime() > Date.now(),
      scope: normalizeScope(t.scope),
    })),
    weekBudgetCredits: WEEK_BUDGET_CREDITS,
    offers: BRIDGE_OFFERS,
    referral: { referrerName: referrer?.name?.trim() || referrer?.whopUsername?.trim() || null, ownRefCode: user.refCode ?? null },
    error: null,
    errorCode: null,
  };
  try {
    // Fresh, never the 10-minute cache (Dave, 2026-11-24): the credits
    // on this page are the member's live engine balance at page load.
    // A BYOK member's balance moves with their own keys' 1-credit
    // calls, so a cached snapshot would show them a stale figure —
    // and read as the flat monthly allowance.
    const member = await getMemberEngineKey(user, { fresh: true });
    view.connected = true;
    view.botPlan = member.plan;
    view.credits = member.credits;
    view.granted = member.granted;
    view.period = member.period || null;
    // BYOK recognition rides the same live key; a failed check leaves
    // byok null and the view exactly as it was (getMemberByok never
    // throws).
    view.byok = await getMemberByok(member.key);
    try {
      const shared = bridgeSharedKey();
      view.rewards = await syncByokRewards({
        userId: user.id,
        hasEngineKey: Boolean(member.key),
        saved: view.byok?.saved ?? null,
        grant: async (externalId, amount) => {
          if (!shared) return false;
          const response = await fetch(`${botBaseUrl()}/api/bridge/whop/grant`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-brain-key": shared },
            body: JSON.stringify({ whopUserId: user.whopId?.trim(), amount, externalId }),
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok) return false;
          const result = await response.json() as { ok?: boolean; granted?: number; credits?: number };
          if (result.ok !== true || (result.granted !== amount && result.granted !== 0) || typeof result.credits !== "number") return false;
          view.credits = result.credits;
          return true;
        },
      });
    } catch {
      view.rewards = null;
    }
  } catch (err) {
    if (err instanceof BridgeError) {
      view.error = err.message;
      view.errorCode = err.code;
    } else {
      view.error = "Could not reach the engine. Try again in a moment.";
      view.errorCode = "BOT_UNREACHABLE";
    }
  }
  return view;
}
