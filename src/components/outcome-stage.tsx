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
        <div className="relative mx-auto w-[min(340px,80vw)] aspect-[9/16]">
          <div aria-hidden="true" className="absolute -left-[13px] top-[22%] h-[14%] w-1 rounded-[3px] bg-[#2c2c2e]" />
          <div aria-hidden="true" className="absolute -left-[13px] top-[calc(22%_+_14%_+_8px)] h-[14%] w-1 rounded-[3px] bg-[#2c2c2e]" />
          <div aria-hidden="true" className="absolute -right-[13px] top-[28%] h-[18%] w-1 rounded-[3px] bg-[#2c2c2e]" />
          <div className="relative h-full w-full overflow-hidden rounded-[44px] border-[10px] border-[#1c1c1e] bg-black shadow-[0_0_0_1px_#3a3a3c,0_30px_80px_rgba(0,0,0,0.8),inset_0_0_0_1px_#48484a]">
            <div aria-hidden="true" className="absolute left-1/2 top-[10px] z-30 h-[26px] w-[36%] -translate-x-1/2 rounded-[20px] bg-[#1c1c1e]" />
            <div className="flex h-full flex-col overflow-hidden rounded-[34px] bg-card">
              <div className="border-b border-border px-4 pb-3.5 pt-10 text-[13px] font-semibold">
                {beat.agentLabel} · {beat.kindLabel}
              </div>
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <div aria-hidden="true" className="grid min-h-[170px] flex-1 place-items-center rounded-[10px] border border-border bg-linear-to-br from-secondary to-card">
                  <span className="grid size-[52px] place-items-center rounded-full bg-primary text-primary-foreground">
                    <Play className="ml-0.5 size-5 fill-current" />
                  </span>
                </div>
                <p className="mt-3 text-[13px] text-muted-foreground">
                  <strong className="text-foreground">{beat.title}</strong><br />{beat.body}
                </p>
                <div className="mt-auto pt-3.5">
                  <div className="rounded-lg bg-primary px-2 py-2.5 text-center text-sm font-semibold text-primary-foreground">
                    Approve &amp; post
                  </div>
                </div>
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
