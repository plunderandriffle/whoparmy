import Link from "next/link";
import { OutcomeStage } from "@/components/outcome-stage";
import { RefStash } from "@/components/ref-stash";
import { Button } from "@/components/ui/button";

const beats = [
  {
    agentLabel: "Your agent",
    kindLabel: "one new piece",
    title: "A week of posts, made before Monday.",
    body: "Researched, written and rendered by your agent.",
    caption: "Our own run — the house agent, working on this business",
  },
];

const steps = [
  {
    title: "Connect",
    body: "Sign in and your agent gets its own key and tools. It works for your business only.",
  },
  {
    title: "Save your six accounts",
    body: "Your links, your AI key, and the services your agent uses. You earn credits at each step — 500 pieces in all.",
  },
  {
    title: "Approve the first piece",
    body: "Your agent makes the first piece. You say yes, or it doesn't go out. That's the rule on every item, forever.",
  },
];

function StartButton({ compact = false }: { compact?: boolean }) {
  return (
    <Button asChild size="lg" className={compact ? "h-10 rounded-lg px-4 font-semibold" : "h-12 rounded-lg px-7 text-base font-semibold"}>
      <Link href="/build">Start your agent</Link>
    </Button>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 pb-[72px]">
      <RefStash />
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-5">
        <Link href="/" translate="no" className="font-display text-[19px] font-extrabold tracking-tight">
          Plunder <span className="text-primary">&amp;</span> Riffle
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium">
          <Link href="/#outcomes" className="text-muted-foreground hover:text-foreground">Outcomes</Link>
          <Link href="/#how-it-works" className="text-muted-foreground hover:text-foreground">How it works</Link>
          <StartButton compact />
        </nav>
      </header>

      <main>
        <div className="grid items-center gap-10 pt-11 md:grid-cols-[1.05fr_0.95fr] md:gap-11">
          <div>
            <h1 className="font-display text-[34px] leading-[1.05] font-extrabold tracking-tight md:text-[44px]">
              Your marketing stops every time you get busy.
            </h1>
            <p className="mt-4 max-w-[56ch] text-lg text-muted-foreground">
              Your own agent keeps it going — on your accounts, on your credits, with your yes on every item.
            </p>
            <div className="mt-6"><StartButton /></div>
            <p className="mt-5 inline-block rounded-3xl border border-accent/30 bg-accent/10 px-3 py-1.5 text-[13px] font-semibold text-foreground">
              For small businesses of one to five people — where you&apos;re the marketing department
            </p>
          </div>
          <OutcomeStage beats={beats} />
        </div>

        <section id="how-it-works" className="mt-[72px]">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">How it works</h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-[10px] border border-border bg-card p-[22px]">
                <span aria-hidden="true" className="font-display text-sm font-extrabold text-primary">0{index + 1}</span>
                <h3 className="mt-2 font-display text-[19px] font-extrabold">{step.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-20 rounded-[10px] border border-border bg-card px-5 py-12 text-center">
          <h2 className="font-display text-[30px] leading-tight font-extrabold">Busy is not a marketing plan.</h2>
          <p className="mt-2.5 mb-6 text-muted-foreground">Your agent is. Set it up once, approve what it makes.</p>
          <StartButton />
        </section>
      </main>
    </div>
  );
}
