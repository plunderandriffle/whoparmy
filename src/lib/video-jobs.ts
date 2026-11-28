/**
 * Video jobs — the engine's video formats as background jobs (Dave,
 * 2026-11-17), modeled on research-jobs.ts: POST creates a row and
 * returns instantly; the run executes detached in the server process,
 * submits to the P&R engine on the bridge key, polls to terminal, and
 * lands the finished preview as a VIDEO asset in the member's library.
 *
 * Costs were reconciled live before this wiring (see engine.ts): on
 * the bridge (BYOK) key every charged call costs exactly 1 credit
 * regardless of list price; scroll + infomercial previews are free;
 * failures refund engine-side. Charged units are recorded as VIDEO
 * usage ONLY when a job completes (failures never spend a member's
 * allowance), and the pre-submit allowance check reserves room for
 * the job's full step count. request_mp4 is NOT touched here —
 * renders stay behind the existing approval rules; this lane makes
 * previews only.
 */

import { db } from "@/lib/db";
import {
  createFollowup,
  getEngineJobStatus,
  submitBeforePack,
  submitBeforeScroll,
  submitFunnelStep,
  submitInfomercial,
  submitSitdown,
  type SitdownKind,
} from "@/lib/engine";
import { assertMonthlyAllowance } from "@/lib/usage-server";
import { recordUsage } from "@/lib/pr-engine";

export const VIDEO_FORMATS = [
  "BEST_OF",
  "RIDICULOUS",
  "NEWS",
  "PRESENT",
  "BEFORE_PACK",
  "FUNNEL",
  "SCROLL",
  "INFOMERCIAL",
  "FOLLOWUP",
] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

/**
 * AUDIO GATE (Dave, 2026-11-18): "Limit generation with audio to
 * BYOK only — those cost more than a $0.01." Engine credits are
 * flat, but a generated voice track carries a real per-call audio
 * cost the house key absorbs. Formats that generate audio:
 * BEFORE_PACK (the /before monologue is TTS-voiced — bot code:
 * "TTS (auto-voiced)"), BEST_OF and FUNNEL (both sold in this app
 * as "voiced" formats). These three never run on the house lane;
 * the member makes them on their own key via the Muse connection
 * (/muse-week), where demo packs already run on member credits.
 * Sitdown previews, scroll, infomercial (rides an existing pack's
 * audio, free) and follow-up generate no new audio and stay.
 */
export const AUDIO_FORMATS: readonly VideoFormat[] = ["BEFORE_PACK", "BEST_OF", "FUNNEL"];

export function isAudioFormat(format: VideoFormat): boolean {
  return (AUDIO_FORMATS as readonly string[]).includes(format);
}

export const BYOK_AUDIO_MESSAGE =
  "This format generates a voice track, and audio costs more than the 1-credit house lane covers — so voiced formats are BYOK-only. Make it from your own Muse instead: open the Muse connection (/bridge-code) and ask for it there; it runs on your own key and credits there.";

export const VIDEO_FORMAT_LABELS: Record<VideoFormat, string> = {
  BEST_OF: "Best-of reel",
  RIDICULOUS: "Ridiculous — Joe reaction show",
  NEWS: "Joe News",
  PRESENT: "Presentation (16:9)",
  BEFORE_PACK: "Before pitch pack",
  FUNNEL: "Funnel video",
  SCROLL: "Scroll video",
  INFOMERCIAL: "Retro infomercial",
  FOLLOWUP: "Follow-up post",
};

/** Charged engine calls per format (BYOK: 1 credit each; funnel = read + build). */
export function videoFormatSteps(format: VideoFormat, params: Record<string, unknown>): number {
  switch (format) {
    case "SCROLL":
    case "INFOMERCIAL":
      return 0;
    case "FUNNEL":
      return params.description ? 3 : 2; // read (+describe) + build
    default:
      return 1;
  }
}

const POLL_MS = 15_000;
const MAX_POLLS = 36; // ~9 minutes

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollUntilDone(kind: Parameters<typeof getEngineJobStatus>[0], jobId: string) {
  for (let i = 0; i < MAX_POLLS; i++) {
    const st = await getEngineJobStatus(kind, jobId);
    if (st.terminal) {
      if (st.phase === "failed" || st.status === "failed") {
        throw new Error(st.error || "The engine job failed (any charge was refunded).");
      }
      return st;
    }
    await sleep(POLL_MS);
  }
  throw new Error("The engine job is taking unusually long — it may still finish; check back in a few minutes.");
}

/** Scroll/infomercial submits 409 while the source pack is still settling — retry briefly. */
async function submitWithSettleRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : "";
      if (!/still being made|409/i.test(msg)) throw e;
      await sleep(20_000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Source pack never became ready.");
}

interface RunResult {
  pageUrl: string | null;
  shareUrl: string | null;
  engineJobId: string | null;
  engineKind: string | null;
  chargedSteps: number;
}

async function executeVideoJob(
  format: VideoFormat,
  params: Record<string, unknown>,
  onEngineJob: (engineJobId: string, engineKind: string) => Promise<void>,
): Promise<RunResult> {
  switch (format) {
    case "BEST_OF":
    case "RIDICULOUS":
    case "NEWS":
    case "PRESENT": {
      const kind = format.toLowerCase() as SitdownKind;
      const { jobId } = await submitSitdown(kind, params);
      await onEngineJob(jobId, "sitdown");
      const st = await pollUntilDone("sitdown", jobId);
      return { pageUrl: st.pageUrl, shareUrl: null, engineJobId: jobId, engineKind: "sitdown", chargedSteps: 1 };
    }
    case "BEFORE_PACK": {
      const { jobId } = await submitBeforePack(params);
      await onEngineJob(jobId, "demo_pack");
      const st = await pollUntilDone("demo_pack", jobId);
      return { pageUrl: st.pageUrl, shareUrl: null, engineJobId: jobId, engineKind: "demo_pack", chargedSteps: 1 };
    }
    case "SCROLL": {
      const { jobId } = await submitWithSettleRetry(() =>
        submitBeforeScroll({
          job_id: String(params.job_id ?? ""),
          ...(typeof params.look === "string" ? { look: params.look } : {}),
        }),
      );
      await onEngineJob(jobId, "scroll");
      const st = await pollUntilDone("scroll", jobId);
      return { pageUrl: st.pageUrl, shareUrl: null, engineJobId: jobId, engineKind: "scroll", chargedSteps: 0 };
    }
    case "INFOMERCIAL": {
      const { jobId } = await submitWithSettleRetry(() =>
        submitInfomercial({ job_id: String(params.job_id ?? "") }),
      );
      await onEngineJob(jobId, "infomercial");
      const st = await pollUntilDone("infomercial", jobId);
      return { pageUrl: st.pageUrl, shareUrl: null, engineJobId: jobId, engineKind: "infomercial", chargedSteps: 0 };
    }
    case "FUNNEL": {
      const formatWanted = typeof params.format === "string" ? params.format : "captions";
      let charged = 0;
      const read = await submitFunnelStep({ url: String(params.url ?? "") });
      charged++;
      await onEngineJob(read.funnelId, "funnel");
      let st = await pollUntilDone("funnel", read.funnelId).catch(async (e: unknown) => {
        // Unreadable offer page: the engine fails the read (refunded) and
        // asks for a description — supply it when the member gave one.
        if (typeof params.description === "string" && params.description.trim()) {
          await submitFunnelStep({ funnel_id: read.funnelId, description: params.description });
          charged++;
          return pollUntilDone("funnel", read.funnelId);
        }
        throw e;
      });
      void st;
      await submitFunnelStep({ funnel_id: read.funnelId, format: formatWanted });
      charged++;
      st = await pollUntilDone("funnel", read.funnelId);
      return {
        pageUrl: st.pageUrl,
        shareUrl: st.shareUrl,
        engineJobId: read.funnelId,
        engineKind: "funnel",
        chargedSteps: charged,
      };
    }
    case "FOLLOWUP": {
      const { pageUrl } = await createFollowup(params);
      return { pageUrl, shareUrl: null, engineJobId: null, engineKind: null, chargedSteps: 1 };
    }
  }
}

/**
 * Resolve a member-supplied source reference for SCROLL/INFOMERCIAL:
 * it must be one of the member's OWN finished packs (a DONE video
 * job or library asset carrying that engine id). Raw engine ids are
 * never forwarded unverified — an id from someone else's library
 * would build on (and expose) their pack.
 */
export async function resolveOwnedSourceJobId(userId: string, raw: unknown): Promise<string> {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) throw new Error("Pick one of your finished packs as the source.");
  const job = await db.videoJob.findFirst({
    where: { userId, engineJobId: id, status: "DONE" },
    select: { id: true },
  });
  if (job) return id;
  const asset = await db.asset.findFirst({
    where: { userId, engineRef: id, status: "DONE" },
    select: { id: true },
  });
  if (asset) return id;
  throw new Error("That source isn't one of your finished packs — scrolls and infomercials build on a pack from your own library.");
}

async function runVideoJob(jobId: string): Promise<void> {
  const job = await db.videoJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;
  // Fencing snapshot: terminal writes below claim on (id + still
  // RUNNING + updatedAt still the value this worker last saw). The
  // engine-job callback refreshes the snapshot after its own write.
  // A stale-sweep or a second worker changing the row in the
  // meantime makes the terminal claim fail instead of overwriting
  // a newer state.
  let fence = job.updatedAt;
  const format = job.format as VideoFormat;
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(job.paramsJson) as Record<string, unknown>;
  } catch {
    params = {};
  }
  try {
    // Reserve the allowance for the job's charged steps up front.
    const steps = videoFormatSteps(format, params);
    if (steps > 0) {
      const user = await db.user.findUnique({ where: { id: job.userId }, select: { plan: true } });
      const allowance = await assertMonthlyAllowance(job.userId, user?.plan ?? "FREE", steps);
      if (!allowance.ok) throw new Error(allowance.error ?? "Monthly allowance reached.");
    }
    const result = await executeVideoJob(format, params, async (engineJobId, engineKind) => {
      const updated = await db.videoJob.update({ where: { id: jobId }, data: { engineJobId, engineKind } });
      fence = updated.updatedAt;
    });
    if (!result.pageUrl && !result.shareUrl) throw new Error("The engine finished without a preview page.");
    // Terminal write + library asset in ONE transaction, fenced:
    // no DONE-without-asset window, and no resurrection of a job a
    // sweep already closed.
    const landed = await db.$transaction(async (tx) => {
      const claim = await tx.videoJob.updateMany({
        where: { id: jobId, status: "RUNNING", updatedAt: fence },
        data: {
          status: "DONE",
          pageUrl: result.pageUrl,
          shareUrl: result.shareUrl,
          engineJobId: result.engineJobId ?? job.engineJobId,
          engineKind: result.engineKind ?? job.engineKind,
        },
      });
      if (claim.count !== 1) return false;
      await tx.asset.create({
        data: {
          userId: job.userId,
          type: "VIDEO",
          format: format.toLowerCase(),
          formatLabel: VIDEO_FORMAT_LABELS[format],
          title:
            (typeof params.topic === "string" && params.topic) ||
            (typeof params.url === "string" && params.url) ||
            VIDEO_FORMAT_LABELS[format],
          body: "",
          pageUrl: result.pageUrl ?? result.shareUrl,
          engineRef: result.engineJobId,
          status: "DONE",
        },
      });
      return true;
    });
    if (!landed) return;
    // Charged units count only on success (failures never spend).
    if (result.chargedSteps > 0) {
      await recordUsage(job.userId, "VIDEO", result.chargedSteps, `video:${format.toLowerCase()}`);
    }
  } catch (e) {
    // Fenced failure write: only a job still in this worker's state
    // flips to FAILED; a job already closed by a sweep stays closed.
    await db.videoJob
      .updateMany({
        where: { id: jobId, status: "RUNNING", updatedAt: fence },
        data: { status: "FAILED", error: e instanceof Error ? e.message.slice(0, 300) : "Video job failed" },
      })
      .catch(() => undefined);
  }
}

/** Create a video job and kick its detached run. Returns the row instantly. */
export async function startVideoJob(userId: string, format: VideoFormat, params: Record<string, unknown>) {
  // The audio gate holds at the choke point — the member API, the
  // agent runner, and any future caller all pass through here.
  if (isAudioFormat(format)) throw new Error(BYOK_AUDIO_MESSAGE);
  // Source ownership holds at the same choke point: SCROLL and
  // INFOMERCIAL build on a source pack, and the source id must
  // resolve to the SUBMITTING member's own finished pack.
  if (format === "SCROLL" || format === "INFOMERCIAL") {
    params = { ...params, job_id: await resolveOwnedSourceJobId(userId, params.job_id) };
  }
  const staleBefore = new Date(Date.now() - 12 * 60_000);
  await db.videoJob
    .updateMany({
      where: { userId, status: "RUNNING", updatedAt: { lt: staleBefore } },
      data: { status: "FAILED", error: "The run timed out — please start it again." },
    })
    .catch(() => undefined);
  const job = await db.videoJob.create({
    data: { userId, format, paramsJson: JSON.stringify(params).slice(0, 4000) },
  });
  void runVideoJob(job.id).catch(() => undefined);
  return job;
}

export function serializeVideoJob(job: {
  id: string;
  format: string;
  status: string;
  pageUrl: string | null;
  shareUrl: string | null;
  error: string | null;
  engineJobId: string | null;
  createdAt: Date;
}) {
  return {
    id: job.id,
    format: job.format,
    label: VIDEO_FORMAT_LABELS[job.format as VideoFormat] ?? job.format,
    status: job.status,
    pageUrl: job.pageUrl,
    shareUrl: job.shareUrl,
    error: job.error,
    engineJobId: job.engineJobId,
    createdAt: job.createdAt.toISOString(),
  };
}
