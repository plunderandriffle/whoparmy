"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

type Beat = {
  agentLabel: string;
  kindLabel: string;
  title: string;
  body: string;
  caption: string;
};

export function OutcomeStage({ beats }: { beats: readonly Beat[] }) {
  const [index, setIndex] = useState(0);
  const carousel = beats.length >= 3;
  const beat = beats[carousel ? index % beats.length : 0];

  if (!beat) return null;

  return (
    <section id="outcomes" aria-label="Outcomes">
      <figure aria-live={carousel ? "polite" : undefined}>
        <div className="mx-auto w-full max-w-[300px] rounded-[34px] border border-border bg-[#0b0e11] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          <div className="overflow-hidden rounded-3xl bg-card">
            <div className="border-b border-border px-4 py-3.5 text-[13px] font-semibold">
              {beat.agentLabel} · {beat.kindLabel}
            </div>
            <div className="p-4">
              <div aria-hidden="true" className="grid h-[170px] place-items-center rounded-[10px] border border-border bg-linear-to-br from-secondary to-card">
                <span className="grid size-[52px] place-items-center rounded-full bg-primary text-primary-foreground">
                  <Play className="ml-0.5 size-5 fill-current" />
                </span>
              </div>
              <p className="mt-3 text-[13px] text-muted-foreground">
                <strong className="text-foreground">{beat.title}</strong><br />{beat.body}
              </p>
              <div className="mt-3.5 rounded-lg bg-primary px-2 py-2.5 text-center text-sm font-semibold text-primary-foreground">
                Approve &amp; post
              </div>
            </div>
          </div>
        </div>
        <figcaption className="mt-4 flex items-baseline justify-center gap-2 text-[13px] text-muted-foreground">
          <span aria-hidden="true" className="size-2 shrink-0 self-center rounded-full bg-accent" />
          {beat.caption}
        </figcaption>
      </figure>
      {carousel && (
        <div className="mt-4 flex justify-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Previous outcome" onClick={() => setIndex((current) => (current % beats.length + beats.length - 1) % beats.length)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Next outcome" onClick={() => setIndex((current) => (current + 1) % beats.length)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
}
