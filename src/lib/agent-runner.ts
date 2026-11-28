import "server-only";
import { db } from "@/lib/db";
import { JOB_TIERS, settleMarketListingForJob } from "@/lib/agents";
import { MODEL_TIERS, awardXp } from "@/lib/game";
import { recordUsage } from "@/lib/pr-engine";
import { languageLabel } from "@/lib/languages";
import { getLadder, starimgConfig } from "@/lib/llm-policy";
import { narrativePromptBlock } from "@/lib/narrative-hooks";

/**
 * ─── AGENT RUNNER — executes the job queue for real ─────────────────
 *
 * A hired agent's jobs run here, through Starimg, on the tier the job
 * kind maps to (src/lib/agents.ts JOB_TIERS), with the routing skill's
 * fallback ladder: a tier tries its model, then falls DOWN the ladder
 * (final → sol, luna, deepseek). The live model list is read first and
 * retired ids are skipped.
 *
 * The app reads STARIMG_API_KEY / STARIMG_BASE_URL from its OWN
 * environment (set by the operator at deploy — Railway env). There is
 * deliberately no other key source: the old Z.ai SDK is dead outside
 * its original platform ("Configuration file not found" — verified
 * 2026-11-16), so it is not used as a fallback.
 *
 * Money honesty: the order-time charge is the tier's typical weighted
 * cost. On completion the charge is reconciled to the call's ACTUAL
 * weighted tokens (usage x coefficient). On failure the full charge is
 * refunded to the agent's allocation — failed work is never charged.
 */

const COEF: Record<string, number> = Object.fromEntries(MODEL_TIERS.map((t) => [t.model, t.coefficient]));

const KIND_INSTRUCTIONS: Record<string, string> = {
  SCOUT:
    "You are a Trend Scout agent. From the brief, produce a scouting report: 5 trend angles or hooks the business can use this week, each one line, plus the single strongest pick and why. Concrete and specific — no generic filler.",
  MEME:
    "You are a Meme Smith agent. From the brief, produce the requested number of meme concepts. For each: a concept title, TOP text (max 60 chars), BOTTOM text (max 60 chars), and a one-line image scene description (no text in the image). Punchy, native, shareable. The TOP text is the meme's hook: when the brief allows it, open it as a first-person narrative line in one of the proven frames below.\n\n" +
    narrativePromptBlock(10),
  HOOK:
    "You are a Hook Smith agent. From the brief, produce the requested number of scroll-stopping hooks/headlines, each under 15 words, varied angles, then mark the one you would ship with ★ and say why in one line.\n\n" +
    narrativePromptBlock(16),
  QA:
    "You are a QA Editor agent. Review the material in the brief: flag anything weak, confusing, off-brand or legally risky, then return a tightened final version. Be specific; do not rewrite what already works.",
  CAMPAIGN:
    "You are a campaign agent. From the brief, produce a ready-to-run mini campaign pack: 1 announcement post, 2 meme concepts (TOP/BOTTOM text), 2 short social posts, and 3 CTA lines. Ready for the owner to approve and ship.",
};

/**
 * The Assessor's offer write-up spec (Dave, 2026-11-18): the free
 * /before pack is the lead magnet; the write-up turns it into the $999
 * AI Assessment offer, following Corey Ganim's playbook — sell the
 * OUTCOME, never the software. One free finding only; the rest stays
 * behind the $999, and the recurring option is pitched at delivery.
 * In v2 this spec rides inside the bridge command, so the member's
 * own Muse does the write-up from the pack it just made.
 */
const ASSESS_OFFER_INSTRUCTIONS =
  "You are The Assessor agent for Plunder & Riffle's $999 AI Assessments. The business owner has just received a free /before pack made from their own website — a 30–50 second personalized audio monologue plus 5 memes about THEIR business. From the brief, write their assessment offer with exactly these parts:\n" +
  "1) FIT — which ONE of the four $999 assessments fits this business best, and why, in their terms. The four: Time Leak (ranked top-5 time sinks for the owner + up to 2 staff, with the AI fix for each); AI Visibility (whether AI search recommends them or their top 3 competitors — proof included); Lead Response (a 7-day secret shop of their site, chat and forms, with the hard number of unanswered leads and the slowest reply time); AI Tools (a 45-minute interview that ends in 3–7 off-the-shelf AI tools matched to their bottlenecks).\n" +
  "2) ONE FREE FINDING — a single specific, credible pain point for this business that the full assessment would quantify. Frame it as what the assessment will verify and measure, never as an already-measured fact. One finding only — the rest stays behind the $999.\n" +
  "3) THE OFFER — the full assessment at $999 one-time: the ranked report plus fix roadmap, delivered as a report with a live 30-minute walkthrough. The recurring option for their fit (implementation, $300/mo AI-visibility monitoring, or a $1,000+/mo speed-to-lead system) is pitched at delivery, after they have seen the proof — name it as later, do not sell it now.\n" +
  "4) NEXT STEP — book the assessment at ai-assessments.pages.dev, and use the free pack while it is alive: pack links expire in under 7 days.\n" +
  "Rules: sell the outcome, never software or tool names as the product. No earnings promises. No invented numbers, reviews, or facts about their business. Tight, concrete, in the owner's language — no generic filler.";

async function liveModelIds(base: string, key: string): Promise<Set<string> | null> {
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { id?: string }[] };
    const ids = new Set((data.data ?? []).map((m) => m.id).filter((x): x is string => !!x));
    return ids.size > 0 ? ids : null;
  } catch {
    return null; // list unreadable — try the ladder anyway rather than refusing to work
  }
}

interface StarimgResult {
  text: string;
  model: string;
  totalTokens: number | null;
}

async function callStarimg(tierKey: string, system: string, user: string): Promise<StarimgResult> {
  const cfg = starimgConfig();
  if (!cfg) {
    throw new Error(
      "STARIMG_API_KEY is not set in the app environment — the operator sets it at deploy (Railway env) and the runner picks it up. Job refunded.",
    );
  }
  const ladder = await getLadder(tierKey);
  const live = await liveModelIds(cfg.base, cfg.key);
  const candidates = ladder.filter((m) => !live || live.has(m));
  if (candidates.length === 0) {
    throw new Error(`None of the ${tierKey} tier models are live on Starimg right now (${ladder.join(", ")}). Job refunded.`);
  }
  let lastError: unknown;
  for (const model of candidates) {
    try {
      const res = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        lastError = new Error(`Starimg ${model} returned HTTP ${res.status}`);
        continue; // a failure on one model does not skip the rest of the tier
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        lastError = new Error(`Starimg ${model} returned an empty reply`);
        continue;
      }
      return { text, model, totalTokens: data.usage?.total_tokens ?? null };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Starimg call failed on every model in the tier");
}

/** Shared Starimg pass for other server lanes (the Agent Architect). */
export async function callAgentLLM(tierKey: string, system: string, user: string): Promise<StarimgResult> {
  return callStarimg(tierKey, system, user);
}

/** Execute one QUEUED job. Safe to call twice — the claim is atomic. */
export async function runAgentJob(jobId: string): Promise<void> {
  const claimed = await db.agentJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) return;

  const job = await db.agentJob.findUnique({ where: { id: jobId }, include: { hire: true } });
  if (!job) return;
  const hire = job.hire;

  // VIDEO jobs (Dave, 2026-11-17) run on the P&R engine's video lane,
  // not the LLM: the brief is either JSON ({format, ...params}) or a
  // plain topic (→ a Ridiculous episode). The video job runs detached
  // and lands its preview in the member's library; the hire's token
  // charge is refunded because video is accounted in VIDEO usage
  // against the plan allowance, not hire tokens.
  if (job.kind === "VIDEO") {
    // Delta refund of the order-time reservation (never an absolute
    // value from the load-time snapshot — other jobs settle meanwhile).
    const refund = db.hiredAgent.update({
      where: { id: hire.id },
      data: { tokensUsed: { decrement: job.tokenCost } },
    });
    try {
      const { startVideoJob, VIDEO_FORMATS } = await import("@/lib/video-jobs");
      let format: string = "RIDICULOUS";
      let params: Record<string, unknown> = { topic: job.brief.slice(0, 400) };
      try {
        const parsed = JSON.parse(job.brief) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && typeof parsed.format === "string") {
          format = parsed.format.toUpperCase();
          params = { ...parsed };
          delete params.format;
        }
      } catch {
        // plain-text brief → Ridiculous topic, as defaulted above
      }
      if (!(VIDEO_FORMATS as readonly string[]).includes(format)) {
        throw new Error(`Unknown video format "${format}" in the job brief.`);
      }
      if (!params.language) params.language = languageLabel(job.language);
      const vjob = await startVideoJob(job.userId, format as never, params);
      await db.$transaction([
        db.agentJob.update({
          where: { id: job.id },
          data: {
            status: "DONE",
            tokenCost: 0,
            result: JSON.stringify({
              videoJobId: vjob.id,
              format,
              note: "Video preview generating in the background — it lands in the library when the engine finishes.",
            }),
          },
        }),
        refund,
      ]);
    } catch (err) {
      await db.$transaction([
        db.agentJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            result: JSON.stringify({
              error: err instanceof Error ? err.message.slice(0, 500) : "Video job failed",
              provider: "pr-engine",
            }),
          },
        }),
        refund,
      ]).catch(() => {});
    }
    return;
  }

  // ASSESS jobs — v2 is a BRIDGE HANDOFF (Dave, 2026-11-18: "just do a
  // bridge — users will be using their own pages and keys"). Whoparmy
  // generates nothing: the job returns a paste-ready bridge command,
  // and the member's OWN Muse exchanges the member's bridge code,
  // runs create_before_pitch through /api/bridge/mcp on the member's
  // OWN P&R credits, reads the pack, and writes the $999 assessment
  // offer — delivered by their Muse, on their own pages. No house
  // key spend, no plan meter, no in-app LLM pass (v1's write-up drift
  // dies with the lane). The brief is the member's business (a URL, a
  // link, or a sentence — or JSON {input, product, assessmentFit}).
  if (job.kind === "ASSESS") {
    // Delta refund of the order-time reservation (never an absolute
    // value from the load-time snapshot — other jobs settle meanwhile).
    const refund = db.hiredAgent.update({
      where: { id: hire.id },
      data: { tokensUsed: { decrement: job.tokenCost } },
    });
    try {
      let input = job.brief.trim();
      let product: string | undefined;
      let assessmentFit: string | undefined;
      try {
        const parsed = JSON.parse(job.brief) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.input === "string" && parsed.input.trim()) input = parsed.input.trim();
          else if (typeof parsed.businessUrl === "string" && parsed.businessUrl.trim()) input = parsed.businessUrl.trim();
          else if (typeof parsed.url === "string" && parsed.url.trim()) input = parsed.url.trim();
          if (typeof parsed.product === "string" && parsed.product.trim()) product = parsed.product.trim().slice(0, 300);
          if (typeof parsed.assessmentFit === "string" && parsed.assessmentFit.trim()) assessmentFit = parsed.assessmentFit.trim().slice(0, 40);
          else if (typeof parsed.fit === "string" && parsed.fit.trim()) assessmentFit = parsed.fit.trim().slice(0, 40);
        }
      } catch {
        // plain-text brief → the business input itself, as defaulted above
      }
      // Same data for the assessment (Dave, 2026-11-18): if the house
      // deep dive already researched this member's brand, the handoff
      // carries those findings — the member's Muse starts from the
      // SAME evidence the content engine learned from, and only fills
      // gaps instead of re-deriving everything.
      let priorResearch = "";
      try {
        const brand = await db.brandProfile.findFirst({
          where: { userId: job.userId, researchJson: { not: null } },
          orderBy: { updatedAt: "desc" },
        });
        if (brand?.researchJson) {
          const r = JSON.parse(brand.researchJson) as {
            analysisSummary?: string;
            offer?: string;
            audience?: string;
            pains?: string[];
            angles?: string[];
            competitors?: string[];
          };
          const lines = [
            r.analysisSummary ? `Summary: ${r.analysisSummary}` : null,
            r.offer ? `Offer: ${r.offer}` : null,
            r.audience ? `Audience: ${r.audience}` : null,
            r.pains?.length ? `Customer pains: ${r.pains.join("; ")}` : null,
            r.angles?.length ? `Content angles: ${r.angles.join("; ")}` : null,
            r.competitors?.length ? `Competitors: ${r.competitors.join(", ")}` : null,
          ].filter(Boolean);
          if (lines.length) {
            priorResearch =
              `\n\nOur house deep dive already researched my business — start from THESE findings (they are the same data my content runs on):\n${lines.join("\n")}\n` +
              `Run research_brand only to fill gaps or verify; do not contradict these findings without fresh evidence.`;
          }
        }
      } catch {
        // no stored research — the command's own research step covers it
      }
      const command =
        `You are my Assessor agent, connected to my Plunder & Riffle account through my bridge at whop.plunderandriffle.com. My credits are mine — never ask me for an API key; it stays on the engine side and I will never paste it anywhere. Work and answer in ${languageLabel(job.language)}.\n\n` +
        `1. My bridge code is {BRIDGE_CODE} (one-time, expires in 24 hours). Exchange it: POST https://whop.plunderandriffle.com/api/bridge/exchange with {"code": "{BRIDGE_CODE}"}. You get a bridge token (7 days) and the MCP URL. Use the token as the Bearer credential for every MCP call through https://whop.plunderandriffle.com/api/bridge/mcp. Never print the token back to me, and never store it past this run.\n` +
        `2. My business is ${input.slice(0, 1500)}.${product ? ` The product/service to feature is: ${product}.` : ""}${assessmentFit ? ` I already lean toward the ${assessmentFit} assessment — confirm or correct the fit from the evidence, do not just agree.` : ""} Research it first through the bridge MCP (research_brand, then create_campaign_from_research) — both are free. Work only from what the research actually found about my business; invent nothing.${priorResearch}\n` +
        `3. Quote me the Assessor run before you spend anything: one create_before_pitch for my business — a personalized /before pack (a 30–50 second audio monologue plus 5 memes about MY business). It reserves 50 credits of my bridge budget and settles at the actual charge. Tell me the expected cost and my remaining balance (get_account through the bridge), and wait for my "go". No go, no spend.\n` +
        `4. On my "go", run create_before_pitch through the bridge${product ? ` with the product pinned` : ""}, polling get_job_status (kind demo_pack) until it is done. Read the finished pack page and the research before writing anything.\n` +
        `5. Write my assessment offer from the pack and the research. ${ASSESS_OFFER_INSTRUCTIONS}\n` +
        `6. Deliver the pack link and the offer to me here; if I ask, put them on my own pages. Do not publish anything and do not render MP4s — I approve first. End with the receipt: credits spent, credits remaining.`;
      const text =
        `THE ASSESSOR — BRIDGE HANDOFF\n` +
        `Whoparmy doesn't make this one. Your own Muse makes it, through your bridge, on your own Plunder & Riffle credits, and delivers it on your own pages. Nothing spends on the house key and nothing is generated inside Whoparmy.\n\n` +
        `1) Get your bridge code: open https://whop.plunderandriffle.com/bridge-code and generate your command. It runs on your own credits and needs at least 50 credits for one /before pack.\n` +
        `2) Paste the command below to your Muse, swapping {BRIDGE_CODE} for your fresh code (it expires in 24 hours and works once).\n` +
        `3) Your Muse quotes the run first and waits for your "go" before spending. The pack and the $999 offer come back from your Muse — approve them there.\n\n` +
        `── PASTE TO YOUR CLAUDE ──\n${command}\n── END ──`;
      await db.$transaction([
        db.agentJob.update({
          where: { id: job.id },
          data: {
            status: "DONE",
            tokenCost: 0,
            result: JSON.stringify({
              text: text.slice(0, 20_000),
              provider: "bridge",
              bridgeUrl: "https://whop.plunderandriffle.com/bridge-code",
            }),
          },
        }),
        refund,
      ]);
    } catch (err) {
      await db.$transaction([
        db.agentJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            result: JSON.stringify({
              error: err instanceof Error ? err.message.slice(0, 500) : "Assessment job failed",
              provider: "bridge",
            }),
          },
        }),
        refund,
      ]).catch(() => {});
    }
    return;
  }

  const tierKey = JOB_TIERS[job.kind] ?? "mid";

  try {
    // Dave's language rule: any language in, selected language out. The
    // instruction scaffold stays English; the output is pinned to the
    // job's selected language no matter what language the brief used.
    // CUSTOM jobs (SMB Agent Factory) run on the hire's own standing
    // instructions — that is the whole point of a custom agent.
    const baseInstructions =
      job.kind === "CUSTOM" && hire.instructions?.trim()
        ? hire.instructions.trim()
        : (KIND_INSTRUCTIONS[job.kind] ?? KIND_INSTRUCTIONS.MEME);
    const system =
      baseInstructions +
      `\n\nOUTPUT LANGUAGE: Write ALL of your output in ${languageLabel(job.language)} (${job.language}), regardless of the language the brief is written in. The brief may arrive in any language; your output language is always the selected one, never the brief's.`;
    const user = `Agent: ${hire.name} (${hire.templateKey})\nPieces requested: ${job.pieces}\nBrief: ${job.brief}`;
    const result = await callStarimg(tierKey, system, user);

    // Reconcile the order-time estimate to the actual weighted cost.
    let actualCost = job.tokenCost;
    if (result.totalTokens != null && COEF[result.model] != null) {
      actualCost = Math.max(1, Math.ceil(result.totalTokens * COEF[result.model]));
    }
    const delta = actualCost - job.tokenCost;

    // Settle exactly once, keyed on the job leaving RUNNING: only
    // the caller whose conditional update lands moves the fuel, by
    // the DELTA between actual and estimate, against a FRESH hire
    // read (the load-time snapshot goes stale while the job runs).
    // The floor is zero — a refund never drives tokensUsed negative.
    await db.$transaction(async (tx) => {
      const claimed = await tx.agentJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: "DONE",
          tokenCost: actualCost,
          result: JSON.stringify({
            text: result.text.slice(0, 20_000),
            model: result.model,
            tier: tierKey,
            totalTokens: result.totalTokens,
            provider: "starimg",
          }),
        },
      });
      if (claimed.count !== 1) return;
      const fresh = await tx.hiredAgent.findUnique({
        where: { id: hire.id },
        select: { tokensUsed: true, tokenBudget: true, status: true },
      });
      if (!fresh) return;
      const newUsed = Math.max(0, fresh.tokensUsed + delta);
      await tx.hiredAgent.update({
        where: { id: hire.id },
        data: {
          tokensUsed: newUsed,
          status: fresh.status === "PAUSED" ? "PAUSED" : newUsed >= fresh.tokenBudget ? "DEPLETED" : "ACTIVE",
        },
      });
    });

    // A claimed marketplace campaign settles its listing (exactly
    // once, keyed on the listing's status transition).
    if (job.kind === "CAMPAIGN") {
      await settleMarketListingForJob(job.id, "DONE").catch((err) =>
        console.error("[market] listing settle (DONE) failed", job.id, err),
      );
    }
    // Real finished work earns XP, same as a hand-run pack — and meme
    // output counts on the plan's monthly meme meter (the house lane
    // the member sees), one usage item per piece.
    if (job.kind === "MEME" || job.kind === "CAMPAIGN") {
      await awardXp(job.userId, "PACK_GENERATED", `agent:${hire.name}`.slice(0, 80)).catch(() => {});
      await recordUsage(job.userId, "TEXT", job.pieces, "agent-job");
    }
  } catch (err) {
    // Failed work is never charged: refund the full order-time
    // charge — same exactly-once rule as settlement: only the caller
    // that moves the job out of RUNNING refunds, by delta, floored.
    await db.$transaction(async (tx) => {
      const claimed = await tx.agentJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          result: JSON.stringify({
            error: err instanceof Error ? err.message.slice(0, 500) : "Runner failed",
            provider: "starimg",
          }),
        },
      });
      if (claimed.count !== 1) return;
      const fresh = await tx.hiredAgent.findUnique({
        where: { id: hire.id },
        select: { tokensUsed: true, tokenBudget: true, status: true },
      });
      if (!fresh) return;
      const refundedUsed = Math.max(0, fresh.tokensUsed - job.tokenCost);
      await tx.hiredAgent.update({
        where: { id: hire.id },
        data: {
          tokensUsed: refundedUsed,
          status: fresh.status === "PAUSED" ? "PAUSED" : refundedUsed >= fresh.tokenBudget ? "DEPLETED" : "ACTIVE",
        },
      });
    }).catch(() => {});
    if (job.kind === "CAMPAIGN") {
      await settleMarketListingForJob(job.id, "FAILED").catch((err) =>
        console.error("[market] listing settle (FAILED) failed", job.id, err),
      );
    }
  }
}

/**
 * Recover stranded jobs: a job left RUNNING for over 20 minutes
 * belongs to a worker that died mid-flight (deploy, crash). Fail it
 * and refund its fuel exactly once — the refund rides the same
 * conditional RUNNING → FAILED transition as a normal failure, so a
 * worker that turns out to be merely slow cannot double-settle.
 */
export async function recoverStrandedJobs(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 20 * 60_000);
  const stranded = await db.agentJob.findMany({
    where: { userId, status: "RUNNING", updatedAt: { lt: cutoff } },
    select: { id: true, hireId: true, tokenCost: true, kind: true },
    take: 10,
  });
  let recovered = 0;
  for (const job of stranded) {
    const settled = await db.$transaction(async (tx) => {
      const claimed = await tx.agentJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          result: JSON.stringify({ error: "The run stalled and was recovered — its fuel was refunded.", provider: "runner-recovery" }),
        },
      });
      if (claimed.count !== 1) return false;
      const fresh = await tx.hiredAgent.findUnique({
        where: { id: job.hireId },
        select: { tokensUsed: true, tokenBudget: true, status: true },
      });
      if (fresh && job.tokenCost > 0) {
        const refundedUsed = Math.max(0, fresh.tokensUsed - job.tokenCost);
        await tx.hiredAgent.update({
          where: { id: job.hireId },
          data: {
            tokensUsed: refundedUsed,
            status: fresh.status === "PAUSED" ? "PAUSED" : refundedUsed >= fresh.tokenBudget ? "DEPLETED" : "ACTIVE",
          },
        });
      }
      return true;
    }).catch(() => false);
    if (settled) {
      recovered += 1;
      if (job.kind === "CAMPAIGN") {
        await settleMarketListingForJob(job.id, "FAILED").catch((err) =>
          console.error("[market] listing settle (recovery) failed", job.id, err),
        );
      }
    }
  }
  return recovered;
}

/** Drain up to `limit` of one user's queued jobs (runner endpoint). */
export async function runQueuedJobsForUser(userId: string, limit = 5): Promise<number> {
  await recoverStrandedJobs(userId).catch(() => {});
  const queued = await db.agentJob.findMany({
    where: { userId, status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const j of queued) {
    await runAgentJob(j.id);
  }
  return queued.length;
}
