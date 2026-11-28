"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import { SiteHeader } from "@/components/shell/site-header";
import { SiteFooter } from "@/components/shell/site-footer";
import { BUILD_QUIZ, buildStep1Complete, type BuildQuizAnswers, type BuildStep1Status } from "@/lib/build-agent";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { clearStashedRef, readStashedRef, stashRefFromUrl } from "@/lib/ref-stash";

/**
 * ─── /build — the Build-an-Agent flow (Whop Army 2.0, Slice 4) ─────
 * Dave's order: deep research about the user → a short interactive
 * quiz → build their agent → they get the prompt (+ their bridge
 * code), built on the Super Muse base, and their own Muse builds
 * out their Spaces so they hit the ground running.
 *
 * Signed-out visitors can start the intake; the build APIs require a
 * session and store per-member state (AppSetting buildflow:<userId>). Research runs
 * on the existing background research lane — this page polls.
 */

type Session = { connected: boolean; admin: boolean; user: { name: string | null; whopUsername: string | null } | null };

interface FlowResearch {
  analysisSummary?: string;
  offer?: string;
  audience?: string;
  voice?: string;
  pains?: string[];
  angles?: string[];
  competitors?: string[];
}

interface FlowState {
  website?: string;
  brandName?: string;
  researchStatus?: BuildStep1Status;
  noWebsite?: boolean;
  researchNote?: string;
  research?: FlowResearch | null;
  quizAnswers?: BuildQuizAnswers;
  agentId?: string;
  agentSlug?: string;
  prompt?: string;
  promptCreatedAt?: string;
  bridgeEligible?: boolean;
}

interface CreateResult {
  agent: { id: string; name: string; slug: string | null; category: string | null; capabilities: string[]; description: string | null };
  prompt: string;
  bridgeCode: string | null;
  connectLink: string | null;
  bridgeEligible: boolean;
}

const step = "rounded-[10px] border border-border bg-card p-5 sm:p-6 space-y-3";
const label = "font-mono text-[11px] font-semibold tracking-[0.18em] text-primary uppercase";
const BUILD_INTAKE_STASH = "build:intake";

function readBuildIntake(): { website?: unknown; brandName?: unknown; noWebsite?: unknown } | null {
  try {
    const raw = sessionStorage.getItem(BUILD_INTAKE_STASH);
    if (raw === null) return null;
    sessionStorage.removeItem(BUILD_INTAKE_STASH);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function CopyButton({ text, children }: { text: string; children: React.ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          })
          .catch(() => undefined);
      }}
    >
      {done ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
      {done ? "Copied" : children}
    </Button>
  );
}

/**
 * Step 0 — the path to Muse (Dave, 2026-11-24): a visitor who does
 * not have Muse yet had no way forward on /build — the whole flow is
 * built by their own Muse. This card shows the invite code that
 * applies to THIS visitor (their referrer's saved code, house code as
 * fallback — resolved server-side by /api/build-agent/muse-invite,
 * the bridge's own resolution) as a click-to-copy chip, then walks
 * them out to create the account and back to redeem it. It is a card,
 * not a gate: anyone who already has Muse skips straight past it.
 */
function MuseStartCard() {
  const [invite, setInvite] = useState<{ code: string | null; source: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref") ?? readStashedRef();
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    void fetch(`/api/build-agent/muse-invite${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { code?: string | null; source?: string | null }) =>
        setInvite({ code: d.code ?? null, source: d.source ?? null }),
      )
      .catch(() => setInvite({ code: null, source: null }));
  }, []);

  function copyCode() {
    if (!invite?.code) return;
    void navigator.clipboard
      .writeText(invite.code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  }

  return (
    <section className={step} aria-label="Step 0: start with Muse">
      <p className={label}>0 · Start with Muse</p>
      <h2 className="font-display text-2xl font-black tracking-tight">New to Muse? Start here.</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Everything on this page is built with your own Muse — your agent lives there. If you don&apos;t have a
        Muse account yet, copy the invite code first, then create your account and redeem it.
      </p>
      {invite === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your invite code…
        </p>
      ) : invite.code ? (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">
            Your invite code{invite.source === "referrer" ? " — from the member who sent you" : ""}
          </p>
          <button
            type="button"
            onClick={copyCode}
            aria-label="Copy your Muse invite code"
            className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 font-mono text-xl font-bold tracking-widest transition-colors hover:border-primary/60"
          >
            {invite.code}
            {copied ? <Check className="h-5 w-5 shrink-0 text-primary" /> : <Copy className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <span className="font-sans text-xs font-semibold tracking-normal text-muted-foreground">
              {copied ? "Copied" : "Click to copy"}
            </span>
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground leading-relaxed">
          Ask the member who sent you for their Muse invite code — or get the current code on the{" "}
          <a className="underline" href="https://www.plunderandriffle.com/muse-invite" target="_blank" rel="noreferrer">
            Muse invite page
          </a>
          .
        </p>
      )}
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>Copy the code above.</li>
        <li>Create your Muse account — you can sign up with any email account you already have.</li>
        <li>
          Redeem the code within 48 hours of joining: on mobile, Settings &gt; Redeem token; on the web, Settings
          &gt; General &gt; Usage &gt; Redeem invite code. You each get 1 billion Muse tokens.
        </li>
        <li>Open Muse and continue the build below — your build prompt gets pasted into Muse.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild>
          <a href="https://muse.ai" target="_blank" rel="noreferrer">
            Create your Muse account <ArrowRight className="h-4 w-4 ml-1.5" />
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href="https://muse.ai" target="_blank" rel="noreferrer">
            Open Muse <ArrowRight className="h-4 w-4 ml-1.5" />
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Muse is available in the United States, Canada, Japan, and Singapore.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Already have Muse? Tap Open Muse — or skip this and start at step 1 below.
      </p>
    </section>
  );
}

export default function BuildPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<FlowState | null>(null);
  const [walkthrough, setWalkthrough] = useState(false);
  const [walkthroughTouched, setWalkthroughTouched] = useState(false);
  const [website, setWebsite] = useState("");
  const [brandName, setBrandName] = useState("");
  const [noWebsite, setNoWebsite] = useState(false);
  const [answers, setAnswers] = useState<BuildQuizAnswers>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadState = useCallback(async () => {
    const res = await fetch("/api/build-agent", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { state: FlowState | null; suggestWalkthrough: boolean };
    if (!walkthroughTouched) setWalkthrough(data.suggestWalkthrough);
    if (data.state) {
      setState(data.state);
      if (data.state.website) setWebsite(data.state.website);
      if (data.state.brandName) setBrandName(data.state.brandName);
      if (data.state.noWebsite || data.state.researchStatus === "no-website") setNoWebsite(true);
      if (data.state.quizAnswers) setAnswers(data.state.quizAnswers);
    }
    return data.state;
  }, [walkthroughTouched]);

  const attributedRef = useRef(false);

  useEffect(() => {
    let active = true;
    stashRefFromUrl();
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then(async (s: Session) => {
        if (!active) return;
        const draft = s.connected ? readBuildIntake() : null;
        if (draft) {
          await loadState().catch(() => undefined);
          if (typeof draft.website === "string") setWebsite(draft.website);
          if (typeof draft.brandName === "string") setBrandName(draft.brandName);
          if (typeof draft.noWebsite === "boolean") setNoWebsite(draft.noWebsite);
        }
        setSession(s);
        if (s.connected && !draft) void loadState();
      })
      .catch(() => {
        if (active) setSession({ connected: false, admin: false, user: null });
      });
    return () => { active = false; };
  }, [loadState]);

  useEffect(() => {
    if (!session?.connected || attributedRef.current) return;
    attributedRef.current = true;
    const code = new URLSearchParams(window.location.search).get("ref") ?? readStashedRef();
    if (!code) return;
    void fetch("/api/referrals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
      .catch(() => undefined).finally(() => clearStashedRef());
  }, [session]);

  // Poll while research is running (the lane takes ~2 minutes).
  useEffect(() => {
    if (state?.researchStatus !== "running") {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (!pollRef.current) {
      pollRef.current = setInterval(() => void loadState(), 4000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [state?.researchStatus, loadState]);

  async function call(path: string, init: RequestInit, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Try again.");
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function startResearch() {
    if (!session?.connected) {
      try {
        sessionStorage.setItem(BUILD_INTAKE_STASH, JSON.stringify({ website, brandName, noWebsite }));
      } catch {
        setError("This browser couldn’t keep your answers for sign-in. Allow session storage and try again.");
        return;
      }
      window.location.assign("/api/auth/whop?next=%2Fbuild");
      return;
    }
    const data = await call(
      "/api/build-agent/research",
      { method: "POST", body: JSON.stringify({ website: noWebsite ? "" : website, brandName, noWebsite }) },
      "research",
    );
    if (data?.state) setState(data.state as FlowState);
  }

  async function saveQuiz() {
    const data = await call("/api/build-agent/quiz", { method: "POST", body: JSON.stringify({ answers }) }, "quiz");
    if (data?.state) setState(data.state as FlowState);
  }

  async function buildAgent() {
    const data = await call("/api/build-agent/create", { method: "POST", body: JSON.stringify({ walkthrough }) }, "create");
    if (data) {
      setCreated(data as unknown as CreateResult);
      void loadState();
    }
  }

  const researchDone = buildStep1Complete(state?.researchStatus);
  const quizSaved = Boolean(state?.quizAnswers);
  const prompt = created?.prompt ?? state?.prompt ?? null;
  const agentName = created?.agent.name ?? null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-5 py-14 sm:py-20 space-y-10">
        <SiteHeader />

        {session === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="Loading">
            <Loader2 className="h-4 w-4 animate-spin" />
          </p>
        ) : (
          <>
            <section className="space-y-3">
              <p className={label}>Whop Army · Build an agent</p>
              <h1 className="font-display text-4xl sm:text-5xl font-black leading-[1.02] tracking-tight">We research. You answer 7 questions. Your agent gets built.</h1>
              <p className="text-muted-foreground leading-relaxed">
                {session.connected
                  ? "Deep research on your business, a short quiz, and an agent designed from both — then the prompt and bridge code that let your own Muse build out your Spaces, so you hit the ground running."
                  : "Deep research on your business, a short quiz, and your agent designed from both."}
              </p>
            </section>

            {error ? (
              <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
                {error}
              </p>
            ) : null}

            {session.connected && <>
              <MuseStartCard />

              <UpdateTokenCard />
              <section className={step} aria-label="Your Links">
                <p className={label}>Your Links</p>
                <p className="font-semibold">Your saved offer links, on your profile</p>
                <p className="text-sm text-muted-foreground">See every link your Muse has saved for you through the bridge — the same links your shares and sign-up buttons use.</p>
                <p><a className="text-sm font-semibold underline underline-offset-4" href="/your-links">View your links</a></p>
              </section>
            </>}

            {/* ─── Step 1 · Research ─────────────────────────────── */}
            <section className={step} aria-label="Step 1: research">
              <p className={label}>1 · Deep research</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your website is the starting point — the same deep research every Whop Army agent works from. It
                takes about two minutes. No website yet? Tick the box — your agent starts from your business name
                and your quiz answers instead.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://yourbusiness.com" aria-label="Your website" disabled={noWebsite} />
                <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={noWebsite ? "Business name" : "Business name (optional)"} aria-label="Business name" className="sm:max-w-52" />
                <Button
                  onClick={() => void startResearch()}
                  disabled={busy !== null || (noWebsite ? !brandName.trim() : !website.trim())}
                >
                  {busy === "research" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : !session.connected ? (
                    "Continue with Whop"
                  ) : noWebsite ? (
                    "Continue without a website"
                  ) : (
                    "Research my business"
                  )}
                </Button>
              </div>
              {!session.connected && (
                <p className="text-sm text-muted-foreground">You’ll sign in with Whop to save this step and continue. We’ll keep your answers in this tab while you sign in.</p>
              )}
              <div className="flex items-center gap-2">
                <Checkbox id="build-no-website" checked={noWebsite} onCheckedChange={(v) => setNoWebsite(v === true)} />
                <Label htmlFor="build-no-website" className="font-normal">
                  No website yet
                </Label>
              </div>
              {noWebsite ? (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We&apos;ll build your starting profile from your business name and your quiz answers. Add a
                  website any time and the research deepens it.
                </p>
              ) : null}
              {state?.researchStatus === "running" ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Researching — this page checks back on its own.
                </p>
              ) : null}
              {state?.researchStatus === "failed" ? (
                <p className="text-sm text-destructive">{state.researchNote ?? "Research failed — run it again."}</p>
              ) : null}
              {researchDone ? (
                <Card>
                  <CardContent className="space-y-2 pt-5 text-sm leading-relaxed">
                    <p className="font-semibold">
                      {state?.brandName ?? "Your business"} — {state?.researchStatus === "no-website" ? "no website yet" : "research on file"}
                    </p>
                    {state?.research?.analysisSummary ? <p>{state.research.analysisSummary}</p> : null}
                    {state?.research?.offer ? (
                      <p>
                        <span className="text-muted-foreground">Offer:</span> {state.research.offer}
                      </p>
                    ) : null}
                    {state?.research?.audience ? (
                      <p>
                        <span className="text-muted-foreground">Audience:</span> {state.research.audience}
                      </p>
                    ) : null}
                    {state?.researchNote ? <p className="text-muted-foreground">{state.researchNote}</p> : null}
                  </CardContent>
                </Card>
              ) : null}
            </section>

            {session.connected && <>
            {/* ─── Step 2 · Quiz ─────────────────────────────────── */}
            <section className={step} aria-label="Step 2: quiz">
              <p className={label}>2 · The short quiz — 7 questions</p>
              {BUILD_QUIZ.map((q) => (
                <fieldset key={q.id} className="space-y-2">
                  <legend className="text-sm font-semibold">{q.prompt}</legend>
                  {q.kind === "choice" ? (
                    <div className="flex flex-wrap gap-2">
                      {q.options!.map((o) => {
                        const active = answers[q.id as keyof BuildQuizAnswers] === o.id;
                        return (
                          <button
                            key={o.id}
                            type="button"
                            title={o.hint}
                            onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                              active ? "border-primary bg-primary text-primary-foreground font-semibold" : "border-border hover:border-primary/60"
                            }`}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <Input
                      value={(answers[q.id as keyof BuildQuizAnswers] as string | undefined) ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      placeholder={q.placeholder}
                      maxLength={q.maxLength}
                      aria-label={q.prompt}
                    />
                  )}
                </fieldset>
              ))}
              <Button onClick={() => void saveQuiz()} disabled={busy !== null} variant={quizSaved ? "outline" : "default"}>
                {busy === "quiz" ? <Loader2 className="h-4 w-4 animate-spin" /> : quizSaved ? "Quiz saved — update it" : "Save my answers"}
              </Button>
              {quizSaved ? (
                <p className="text-sm text-muted-foreground">
                  {state?.researchStatus === "no-website"
                    ? "Saved. Your agent is designed from these answers plus your business name — no website research was run."
                    : "Saved. Your agent is designed from these answers plus the research."}
                </p>
              ) : null}
            </section>

            {/* ─── Step 3 · Build + delivery ─────────────────────── */}
            <section className={step} aria-label="Step 3: build your agent">
              <p className={label}>3 · Build your agent</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                One tap designs your agent from the {state?.researchStatus === "no-website" ? "name + quiz" : "research + quiz"}, creates it on your account (its public profile
                stays off until you publish it), writes your personalized build prompt, and mints your bridge code.
              </p>
              <label className="flex items-start gap-3 rounded-xl border border-border p-4 cursor-pointer">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={walkthrough} onChange={(event) => { setWalkthroughTouched(true); setWalkthrough(event.target.checked); }} />
                <span className="space-y-1">
                  <span className="block font-medium">New here? Have Muse walk me through setup first</span>
                  <span className="block text-sm text-muted-foreground">Muse signs you up for the offers using your referrer's links, saves YOUR links, then builds your agent with them.</span>
                </span>
              </label>
              <Button onClick={() => void buildAgent()} disabled={busy !== null || !researchDone || !quizSaved}>
                {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : state?.agentId ? "Rebuild prompt + fresh code" : "Build my agent"}
              </Button>
              {!researchDone || !quizSaved ? (
                <p className="text-sm text-muted-foreground">
                  {!researchDone ? "Finish step 1 (research, or continue without a website) " : ""}
                  {!researchDone && !quizSaved ? "and " : ""}
                  {!quizSaved ? "step 2 (save the quiz) " : ""}
                  first.
                </p>
              ) : null}

              {prompt ? (
                <div className="space-y-4 pt-2">
                  <Card>
                    <CardContent className="space-y-2 pt-5 text-sm leading-relaxed">
                      <p className="font-semibold">{agentName ?? "Your agent"} is created</p>
                      <p className="text-muted-foreground">
                        Its profile is prefilled from your research and answers, and stays private until you publish
                        it
                        {state?.agentSlug ? (
                          <>
                            {" "}
                            — it will live at <span className="font-mono">/agent/{state.agentSlug}</span>
                          </>
                        ) : null}
                        .
                      </p>
                      {created ? (
                        created.bridgeEligible && created.bridgeCode ? (
                          <p>
                            Bridge code: <span className="font-mono font-bold">{created.bridgeCode}</span>
                            <br />
                            <span className="text-muted-foreground">
                              Connect link: <span className="font-mono">{created.connectLink}</span> — 7 days, on your
                              own credits, content-only.
                            </span>
                          </p>
                        ) : (
                          <p className="text-muted-foreground">
                            No connect code was minted. Save an engine link, then rebuild your prompt to connect on your own credits.
                          </p>
                        )
                      ) : (
                        <p className="text-muted-foreground">
                          Your prompt from before is below. Bridge codes retire when a new one is minted — tap
                          “Rebuild prompt + fresh code” above for a fresh one.
                        </p>
                      )}
                      
                    </CardContent>
                  </Card>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold">Your build prompt</p>
                      <CopyButton text={prompt}>Copy the prompt</CopyButton>
                    </div>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
                      {prompt}
                    </pre>
                  </div>

                  <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                    <li>Open Super Muse in your Muse (it comes with your membership — the prompt is built on it).</li>
                    <li>Paste the prompt — or open the connect link — and give it your “go” on the quoted budget.</li>
                    <li>Watch your Spaces get built out, pre-populated from your research, with your first work waiting for your approval.</li>
                  </ol>
                </div>
              ) : null}
            </section>
            </>}
          </>
        )}

        <SiteFooter />
      </div>
    </main>
  );
}

function UpdateTokenCard() {
  const [status, setStatus] = useState<{ active: boolean; createdAt: string | null; lastUsedAt: string | null } | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => fetch("/api/bridge/update-token", { cache: "no-store" }).then((r) => r.json()).then(setStatus);
  useEffect(() => { void refresh().catch(() => setStatus(null)); }, []);
  async function act(method: "POST" | "DELETE") {
    setBusy(true); setError(null); setRaw(null);
    try { const r = await fetch("/api/bridge/update-token", { method }); const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Request failed"); if (method === "POST") setRaw(d.token); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <section className={step}>
    <p className={label}>Permanent update connection</p>
    <p className="text-sm">Your agent uses this to keep your links and agent updated. It can&apos;t spend credits.</p>
    <p className="text-sm text-muted-foreground">{status?.active ? `Active since ${new Date(status.createdAt!).toLocaleString()} · Last used ${status.lastUsedAt ? new Date(status.lastUsedAt).toLocaleString() : "never"}` : status ? "No active update token" : "Loading status…"}</p>
    <div className="flex gap-2"><Button disabled={busy} onClick={() => void act("POST")}>{status?.active ? "Get token" : "Create"}</Button>{status?.active ? <Button variant="outline" disabled={busy} onClick={() => void act("DELETE")}>Revoke</Button> : null}</div>
    {raw ? <div className="break-all rounded bg-muted p-3 text-sm"><code>{raw}</code> <CopyButton text={raw}>Copy token</CopyButton><p className="mt-2 text-xs">To rotate your token, revoke it first.</p></div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>;
}
