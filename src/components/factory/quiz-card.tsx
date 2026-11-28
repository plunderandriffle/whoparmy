"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Bot, Check, Compass, Loader2, Users } from "lucide-react";
import {
  AGENT_OPTIONS,
  PROMOTING_OPTIONS,
  viewForPromoting,
  type AgentPathId,
  type PromotingId,
} from "@/lib/quiz-shared";

/**
 * The front-door quiz card (Dave, 2026-11-18) — rendered at the top
 * of the signed-in home until the member answers (or skips, which
 * also sticks). Two questions: what are you promoting (routes the
 * room), and how do you want to run it (Muse / Agent37 / self).
 * Picking an agent path shows that door right here before the app
 * continues — the send-off Dave asked for.
 */

const CONTINUE_LINES: Record<PromotingId, string> = {
  business: "Continue to Create — drop your website there and your free Before pack starts from it.",
  affiliate: "Continue to Create — your links and brands live there, and every piece you make carries them.",
  creator: "Continue to Create — trending topics and your brand profiles live there, and your agents build from both.",
  clients: "Continue to Agents — your bots, jobs and client brands live there.",
  idea: "Continue to Ralph — talk the idea out and he'll research it with you.",
};

export function QuizCard({ onDone }: { onDone: (view: string | null) => void }) {
  const [promoting, setPromoting] = useState<PromotingId | null>(null);
  const [agentPath, setAgentPath] = useState<AgentPathId | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentPathId | null>(null);

  async function submit() {
    if (!promoting || !agentPath || busy) return;
    setBusy(true);
    try {
      await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoting, agentPath }),
      });
    } catch {
      // Saving is best-effort; routing the member matters more.
    }
    setBusy(false);
    if (agentPath === "self") onDone(viewForPromoting(promoting));
    else setResult(agentPath);
  }

  async function skip() {
    try {
      await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipped: true }),
      });
    } catch {
      // A failed skip just means the quiz may reappear next visit.
    }
    onDone(null);
  }

  if (result && promoting) {
    const view = viewForPromoting(promoting);
    return (
      <Card className="border-primary/30">
        <CardContent className="py-6 space-y-4">
          <div className="flex items-center gap-2">
            {result === "muse" ? <Bot className="h-5 w-5 text-primary" /> : <Users className="h-5 w-5 text-primary" />}
            <p className="font-black text-lg">
              {result === "muse" ? "Your path: start with Muse" : "Your path: the full team"}
            </p>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {result === "muse"
              ? "Muse is your first agent and your lead orchestrator — baby steps. Get yours, then connect it here and it runs your research, your content and your crew on your credits, with your approve tap on everything."
              : "Agent37 runs a whole workforce for you — scouts, creators, reviewers — around the clock, on the same engine and memory as everything here. Set the team up, then bring them back here to connect."}
          </p>
          <div className="flex flex-wrap gap-2">
            {result === "muse" ? (
              <>
                <Button asChild>
                  <a href="https://www.plunderandriffle.com/muse-invite" target="_blank" rel="noreferrer">
                    Get Muse <ArrowRight className="h-4 w-4 ml-1.5" />
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href="/bridge-code">Connect your Muse here</a>
                </Button>
              </>
            ) : (
              <Button asChild>
                <a href="https://agent37.com/?via=riffle" target="_blank" rel="noreferrer">
                  Meet Agent37 <ArrowRight className="h-4 w-4 ml-1.5" />
                </a>
              </Button>
            )}
            <Button variant="ghost" onClick={() => onDone(view)}>
              Continue to the app
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{CONTINUE_LINES[promoting]}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="py-6 space-y-5">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-black text-lg">
            <Compass className="h-5 w-5 text-primary" /> First — what are you promoting?
          </p>
          <p className="text-sm text-muted-foreground">
            Not everyone here is a brand, and the app shouldn&apos;t treat you like one. Two quick picks and we&apos;ll set up your home the right way.
          </p>
        </div>

        <div className="space-y-2">
          {PROMOTING_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => setPromoting(o.id)}
              className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                promoting === o.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">{o.label}</span>
                {promoting === o.id ? <Check className="h-4 w-4 text-primary shrink-0" /> : null}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">{o.hint}</span>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <p className="font-black">And how do you want to run it?</p>
          {AGENT_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => setAgentPath(o.id)}
              className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                agentPath === o.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">{o.label}</span>
                {agentPath === o.id ? <Check className="h-4 w-4 text-primary shrink-0" /> : null}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">{o.hint}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={submit} disabled={!promoting || !agentPath || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Show my path
          </Button>
          <button onClick={skip} className="text-sm text-muted-foreground underline underline-offset-2">
            Skip for now
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
