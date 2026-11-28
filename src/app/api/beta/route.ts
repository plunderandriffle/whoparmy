import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { approveReport, betaCreateLane, betaTesterUpsertArgs, day0Verifiable, deliveryEmailRequired, enrollmentLaneWrite, evaluateUnlock, validEmailShape, validateBountyCents, validateSpend } from "@/lib/beta-core";
import { getSessionOperator } from "@/lib/site-gate";
import { startResearchJob, getResearchJob } from "@/lib/research-jobs";
import { getPlan } from "@/lib/plans";

export const runtime = "nodejs";
// Deep research (lib/research-jobs) runs ~2 minutes detached; the beta
// route only starts/polls it, but keep the same ceiling as /api/analyze.
export const maxDuration = 300;

const json = (x: unknown, status = 200) =>
  NextResponse.json(x, { status, headers: { "Cache-Control": "no-store" } });

async function context() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const tester = await db.betaTester.findUnique({ where: { userId } });
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return { userId, tester, userEmail: user?.email ?? "" };
}

function hostOf(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Persist a finished research job's summary into the member's
 * BrandProfile.researchJson — the same store /build's
 * refreshBuildResearch writes and lib/blueprint.ts systemContext()
 * reads for blueprint drafting and starter-prompt composition.
 * Host-match update, else create under the plan's brand cap.
 */
async function persistResearchToBrand(userId: string, brandName: string, website: string, result: { research?: unknown; profile?: { name?: string; industry?: string; description?: string; products?: string[]; audience?: string } | null }) {
  const summary = (result.research ?? null) as { audience?: string; voice?: string } | null;
  if (!summary) return null;
  const researchJson = JSON.stringify(summary).slice(0, 60_000);
  const host = hostOf(website);
  const all = await db.brandProfile.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const existing = all.find((b) => hostOf(b.website) === host && host !== "") ?? null;
  if (existing) {
    await db.brandProfile.update({ where: { id: existing.id }, data: { researchJson } });
    return existing.id;
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  const plan = getPlan(user?.plan ?? "FREE");
  if (all.length >= plan.maxBrands) return null;
  const p = result.profile ?? null;
  const brand = await db.brandProfile.create({
    data: {
      userId,
      name: (p?.name ?? brandName ?? host).slice(0, 120),
      website: website || null,
      industry: p?.industry ?? null,
      description: p?.description ?? null,
      products: p?.products?.length ? p.products.join(", ") : null,
      audience: p?.audience ?? summary.audience ?? null,
      voice: summary.voice ?? null,
      languages: JSON.stringify(["en"]),
      researchJson,
    },
  });
  return brand.id;
}

/**
 * Offer-only path (Dave, 2026-11-27): a member with no website gives
 * the offer they want to promote instead. The brand profile is built
 * from that stated offer ONLY — researchJson says so plainly, and no
 * website research is run or claimed (mirrors /build's no-website
 * honesty rule).
 */
async function persistOfferToBrand(userId: string, brandName: string, offer: string) {
  const researchJson = JSON.stringify({
    offer,
    source: "member-stated offer",
    note: "No website — this profile is built from the member's stated offer only. No website research was run.",
  }).slice(0, 60_000);
  const all = await db.brandProfile.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const existing = all.find((b) => !b.website && b.name === brandName) ?? null;
  if (existing) {
    await db.brandProfile.update({ where: { id: existing.id }, data: { description: offer, products: offer, researchJson } });
    return existing.id;
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  const plan = getPlan(user?.plan ?? "FREE");
  if (all.length >= plan.maxBrands) return null;
  const brand = await db.brandProfile.create({
    data: {
      userId,
      name: brandName.slice(0, 120),
      website: null,
      description: offer,
      products: offer,
      languages: JSON.stringify(["en"]),
      researchJson,
    },
  });
  return brand.id;
}

export async function GET() {
  const c = await context();
  if (!c) return json({ error: "Unauthorized" }, 401);
  const campaigns = await db.betaCampaign.findMany({
    where: { ownerId: c.userId },
    include: { tasks: true },
    orderBy: { createdAt: "desc" },
  });
  const board = await db.betaTask.findMany({
    where: { status: "open", campaign: { status: "active" } },
    include: { campaign: { select: { brandName: true, product: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const t = c.tester;
  const [skills, claims, memes, posts, ledger, pendingReports] = t
    ? await Promise.all([
        db.betaSkillCheck.findMany({ where: { testerId: t.id } }),
        db.betaClaim.findMany({
          where: { testerId: t.id },
          include: { task: { include: { campaign: { select: { brandName: true } } } }, report: true },
          orderBy: { createdAt: "desc" },
        }),
        db.betaMeme.findMany({ where: { testerId: t.id }, orderBy: { createdAt: "desc" } }),
        db.betaPagePost.findMany({ where: { testerId: t.id }, orderBy: { createdAt: "desc" } }),
        db.betaLedgerLine.findMany({ where: { testerId: t.id }, orderBy: { createdAt: "desc" }, take: 50 }),
        db.betaReport.findMany({
          where: { reviewStatus: "pending", claim: { task: { campaign: { ownerId: c.userId } } } },
          include: { claim: { include: { task: true } } },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [[], [], [], [], [], []];
  return json({ campaigns, board, tester: t, userEmail: c.userEmail, deliveryEmail: t?.deliveryEmail || c.userEmail, skills, claims, memes, posts, ledger, pendingReports });
}

export async function POST(req: NextRequest) {
  const c = await context();
  if (!c) return json({ error: "Unauthorized" }, 401);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(b.action || "");
  try {
    if (action === "enroll") {
      const lane = enrollmentLaneWrite(b.lane, Boolean(c.tester));
      if (!c.tester && !lane.create) return json({ error: "Please enter through the Muse or Agent37 door to choose your beta lane." }, 400);
      const effectiveLane = lane.update ?? lane.create ?? c.tester?.lane;
      const deliveryEmail = typeof b.deliveryEmail === "string" ? b.deliveryEmail.trim() : "";
      if (deliveryEmailRequired(effectiveLane, deliveryEmail)) return json({ error: "The Agent37 lane needs your email address — everything is created for it. Add it and enroll again." }, 400);
      if (effectiveLane === "agent37" && deliveryEmail && !validEmailShape(deliveryEmail)) return json({ error: "That email address doesn't look right — check it and try again. Everything on this lane is created for that address." }, 400);
      // Lane switching is ungated after research/claims — acceptable for beta (Joe review, A2 note).
      // Upsert args come from betaTesterUpsertArgs: the create branch
      // must connect the required user relation and always carry a
      // valid lane — Prisma validates both branches up front, so a
      // null create lane killed lane switches for existing testers
      // ("Argument user is missing", 2026-11-28).
      const t = await db.betaTester.upsert(betaTesterUpsertArgs({
        userId: c.userId,
        createLane: betaCreateLane(lane, c.tester?.lane),
        updateLane: lane.update,
        create: {
          museMail: typeof b.museMail === "string" ? b.museMail : "",
          deliveryEmail: effectiveLane === "agent37" ? deliveryEmail : "",
          niche: typeof b.niche === "string" ? b.niche : "",
          boardHandle: typeof b.boardHandle === "string" ? b.boardHandle : "",
          businessName: typeof b.businessName === "string" ? b.businessName : "",
          businessWebsite: typeof b.businessWebsite === "string" ? b.businessWebsite : undefined,
        },
        update: {
          ...(effectiveLane === "agent37" && deliveryEmail ? { deliveryEmail } : {}),
          museMail: typeof b.museMail === "string" ? b.museMail : undefined,
          niche: typeof b.niche === "string" ? b.niche : undefined,
          boardHandle: typeof b.boardHandle === "string" ? b.boardHandle : undefined,
          businessName: typeof b.businessName === "string" ? b.businessName : undefined,
          businessWebsite: typeof b.businessWebsite === "string" ? b.businessWebsite : undefined,
        },
      }));
      return json({ tester: t }, 201);
    }

    // ── Deep research: the SAME pipeline /build runs ──────────────
    // startResearchJob (lib/research-jobs.ts) → runBrandAnalysis
    // (lib/brand-research.ts) → pr-engine research_brand via the
    // bridge. No beta-only research path exists.
    if (action === "research") {
      if (!c.tester) return json({ error: "Enroll first" }, 400);
      const brandName = (typeof b.businessName === "string" ? b.businessName : c.tester.businessName).trim();
      const website = (typeof b.businessWebsite === "string" ? b.businessWebsite : c.tester.businessWebsite ?? "").trim();
      const offer = (typeof b.offerText === "string" ? b.offerText : c.tester.offerText ?? "").trim();
      if (!brandName) {
        return json({ error: "Business name is required." }, 400);
      }
      if (!website && !offer) {
        return json({ error: "Give us your website or the offer you want to promote — your Muse needs one of the two to build from." }, 400);
      }
      if (!website) {
        // Offer-only: no website research is run or claimed; the
        // profile is built from the stated offer (see helper above).
        const brandId = await persistOfferToBrand(c.userId, brandName, offer);
        const t = await db.betaTester.update({
          where: { id: c.tester.id },
          data: { businessName: brandName, businessWebsite: null, offerText: offer, researchJobId: null, researchStatus: "offer" },
        });
        return json({ tester: t, brandId, offerOnly: true }, 201);
      }
      const job = await startResearchJob({ userId: c.userId, brandName, website });
      const t = await db.betaTester.update({
        where: { id: c.tester.id },
        data: { businessName: brandName, businessWebsite: website, offerText: offer, researchJobId: job.id, researchStatus: job.status },
      });
      return json({ job, tester: t }, 201);
    }
    if (action === "research-refresh") {
      if (!c.tester?.researchJobId) return json({ error: "No research job yet" }, 400);
      const job = await getResearchJob(c.userId, c.tester.researchJobId);
      if (!job) return json({ error: "Research job not found" }, 404);
      let brandId: string | null = null;
      if (job.status === "done" && job.result) {
        brandId = await persistResearchToBrand(
          c.userId,
          c.tester.businessName,
          c.tester.businessWebsite ?? "",
          job.result as { research?: unknown; profile?: { name?: string; industry?: string; description?: string; products?: string[]; audience?: string } | null },
        );
      }
      const t = await db.betaTester.update({
        where: { id: c.tester.id },
        data: { researchStatus: job.status },
      });
      return json({ job, tester: t, brandId });
    }

    if (action === "day0") {
      if (!c.tester) return json({ error: "Enroll first" }, 400);
      const page = Boolean(b.facebookPageRecorded);
      const posts = Number(b.postsPosted || 0);
      const t = await db.betaTester.update({
        where: { id: c.tester.id },
        data: {
          facebookPageRecorded: page,
          facebookPageUrl: typeof b.facebookPageUrl === "string" ? b.facebookPageUrl : null,
          pageName: typeof b.pageName === "string" ? b.pageName : undefined,
          postsPosted: posts,
          bountyUnlocked: evaluateUnlock({ ...c.tester, facebookPageRecorded: page, postsPosted: posts }),
        },
      });
      return json({ tester: t });
    }
    if (action === "verifyDay0") {
      // House verification of an Agent37 tester's Day 0 build — the ONLY
      // writer of bountyUnlocked for that lane (the day0 action preserves
      // the flag there; Joe's fix-first review, item 3). Gated exactly
      // like the /api/admin routes: designated-operator session only
      // (getSessionOperator), everyone else gets a 404 — a tester can
      // never verify themselves.
      const operator = await getSessionOperator();
      if (!operator) return json({ error: "Not found" }, 404);
      const target = await db.betaTester.findUnique({ where: { id: String(b.testerId || "") } });
      if (!target) return json({ error: "Not found" }, 404);
      if (!day0Verifiable(target.lane)) return json({ error: "Day 0 verification is for the Agent37 lane only — the Muse lane unlocks by recording its Facebook Page and posts." }, 400);
      const t = await db.betaTester.update({
        where: { id: target.id },
        data: { bountyUnlocked: true, day0VerifiedBy: operator.id, day0VerifiedAt: new Date() },
      });
      return json({ tester: t });
    }
    if (action === "ack-panel") {
      if (!c.tester) return json({ error: "Enroll first" }, 400);
      if (!c.tester.bountyUnlocked) return json({ error: "Panel unlocks after the bounty unlock (verified Day 0)." }, 400);
      return json({ tester: await db.betaTester.update({ where: { id: c.tester.id }, data: { panelCostAckAt: new Date() } }) });
    }
    if (action === "campaign") {
      const bounty = validateBountyCents(Number(b.defaultBountyCents ?? 20));
      const x = await db.betaCampaign.create({
        data: {
          ownerId: c.userId,
          company: String(b.company || ""),
          product: String(b.product || ""),
          brandName: String(b.brandName || b.company || ""),
          tagline: String(b.tagline || ""),
          brief: String(b.brief || ""),
          accent: String(b.accent || "#b45309"),
          fundedCents: Number(b.fundedCents || 0),
          defaultBountyCents: bounty,
        },
      });
      return json({ campaign: x }, 201);
    }
    if (action === "fund") {
      const x = await db.betaCampaign.findFirst({ where: { id: String(b.campaignId), ownerId: c.userId } });
      if (!x) return json({ error: "Not found" }, 404);
      return json({ campaign: await db.betaCampaign.update({ where: { id: x.id }, data: { fundedCents: { increment: Number(b.amountCents || 0) } } }) });
    }
    if (action === "task") {
      const x = await db.betaCampaign.findFirst({ where: { id: String(b.campaignId), ownerId: c.userId } });
      if (!x) return json({ error: "Not found" }, 404);
      const t = await db.betaTask.create({
        data: { campaignId: x.id, title: String(b.title || ""), instructions: String(b.instructions || ""), bountyCents: validateBountyCents(Number(b.bountyCents)), slots: Number(b.slots || 1) },
      });
      return json({ task: t }, 201);
    }
    if (action === "claim") {
      if (!c.tester) return json({ error: "Enroll first" }, 400);
      const task = await db.betaTask.findUnique({ where: { id: String(b.taskId) } });
      if (!task || task.status !== "open") return json({ error: "Not found" }, 404);
      const claimed = await db.betaClaim.count({ where: { taskId: task.id, status: { not: "rejected" } } });
      if (claimed >= task.slots) return json({ error: "All slots for this task are claimed." }, 400);
      return json({ claim: await db.betaClaim.create({ data: { taskId: task.id, testerId: c.tester.id } }) }, 201);
    }
    if (action === "report") {
      if (!c.tester) return json({ error: "Enroll first" }, 400);
      const claim = await db.betaClaim.findFirst({ where: { id: String(b.claimId), testerId: c.tester.id } });
      if (!claim) return json({ error: "Not found" }, 404);
      const report = await db.betaReport.create({
        data: {
          claimId: claim.id,
          testerId: c.tester.id,
          built: String(b.built || ""),
          purpose: String(b.purpose || ""),
          needsFromOwner: String(b.needsFromOwner || ""),
          tokensSpent: String(b.tokensSpent || ""),
          cannotDo: String(b.cannotDo || ""),
        },
      });
      await db.betaClaim.update({ where: { id: claim.id }, data: { status: "reported" } });
      return json({ report }, 201);
    }
    if (action === "approve-report") {
      const report = await db.betaReport.findUnique({
        where: { id: String(b.reportId) },
        include: { claim: { include: { task: true } }, tester: true },
      });
      if (!report) return json({ error: "Not found" }, 404);
      if (report.reviewStatus === "approved") return json({ error: "Report already approved and paid." }, 400);
      const campaign = await db.betaCampaign.findFirst({ where: { id: report.claim.task.campaignId, ownerId: c.userId } });
      if (!campaign) return json({ error: "Not found" }, 404);
      const paid = approveReport({
        campaign: { fundedCents: campaign.fundedCents },
        tester: report.tester,
        bountyCents: report.claim.task.bountyCents,
        ledger: { amountCents: report.claim.task.bountyCents, kind: "micro_bounty", memo: "Approved beta report" },
      });
      const updated = await db.betaCampaign.update({ where: { id: campaign.id }, data: { fundedCents: paid.campaign.fundedCents } });
      await db.betaReport.update({ where: { id: report.id }, data: { reviewStatus: "approved" } });
      await db.betaClaim.update({ where: { id: report.claimId }, data: { status: "approved" } });
      const line = await db.betaLedgerLine.create({
        data: { campaignId: campaign.id, testerId: report.testerId, amountCents: paid.ledger.amountCents, kind: paid.ledger.kind, memo: paid.ledger.memo },
      });
      return json({ campaign: updated, ledger: line });
    }
    if (action === "spend") {
      if (!c.tester) return json({ error: "Enroll first" }, 400);
      const kind = b.kind as "fuel" | "bounty";
      const amount = Number(b.amount);
      validateSpend(c.tester, kind, amount);
      const t = await db.betaTester.update({
        where: { id: c.tester.id },
        data: kind === "fuel" ? { fuelUsed: { increment: amount } } : { bountyUsed: { increment: amount } },
      });
      return json({ tester: t, spend: await db.betaTokenSpend.create({ data: { testerId: t.id, kind, amount, memo: String(b.memo || "") } }) });
    }
    if (action === "panel-run") {
      if (!c.tester) return json({ error: "Enroll first" }, 400);
      if (!c.tester.bountyUnlocked || !c.tester.panelCostAckAt) return json({ error: "Panel is locked" }, 400);
      return json(
        {
          run: await db.betaPanelRun.create({
            data: {
              testerId: c.tester.id,
              campaignId: typeof b.campaignId === "string" ? b.campaignId : undefined,
              topic: String(b.topic || ""),
              opusVerdict: String(b.opusVerdict || ""),
              fableAngle: String(b.fableAngle || ""),
            },
          }),
        },
        201,
      );
    }
    if (action === "skill") {
      if (!c.tester?.bountyUnlocked || !c.tester.panelCostAckAt) return json({ error: "Core skills are locked" }, 400);
      const key = String(b.skillKey);
      if (!["replicator", "space-demo-and-replicate", "design-engine", "taste-finish-gate"].includes(key)) {
        return json({ error: "Unknown skill" }, 400);
      }
      return json(
        {
          skill: await db.betaSkillCheck.upsert({
            where: { testerId_skillKey: { testerId: c.tester.id, skillKey: key } },
            create: { testerId: c.tester.id, skillKey: key, version: String(b.version || "") },
            update: { version: String(b.version || ""), checkedAt: new Date() },
          }),
        },
        201,
      );
    }
    if (action === "meme" || action === "post") {
      if (!c.tester) return json({ error: "Enroll first" }, 400);
      const record =
        action === "meme"
          ? await db.betaMeme.create({
              data: { testerId: c.tester.id, campaignId: typeof b.campaignId === "string" ? b.campaignId : undefined, imageUrl: String(b.imageUrl || ""), caption: String(b.caption || "") },
            })
          : await db.betaPagePost.create({
              data: { testerId: c.tester.id, caption: String(b.caption || ""), link: typeof b.link === "string" ? b.link : undefined },
            });
      return json({ record }, 201);
    }
    if (action === "review") {
      // Meme / post review queues: approve/reject flips record status
      // only — nothing is ever posted or sent from this build.
      const status = b.decision === "approved" ? "approved" : "rejected";
      if (b.kind === "meme") {
        const m = await db.betaMeme.findUnique({ where: { id: String(b.id) }, include: { campaign: true } });
        if (!m || (m.campaign && m.campaign.ownerId !== c.userId)) return json({ error: "Not found" }, 404);
        return json({ record: await db.betaMeme.update({ where: { id: m.id }, data: { status } }) });
      }
      if (b.kind === "post") {
        const p = await db.betaPagePost.findUnique({ where: { id: String(b.id) } });
        if (!p || p.testerId !== c.tester?.id) return json({ error: "Not found" }, 404);
        return json({ record: await db.betaPagePost.update({ where: { id: p.id }, data: { status } }) });
      }
      return json({ error: "Unknown review kind" }, 400);
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Beta request failed" }, 400);
  }
}
