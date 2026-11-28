"use client";

import { useEffect, useState } from "react";

/**
 * Member chrome — H2 nav demotion (SITE-REDO-SPEC 2026-11-26 §4,
 * Dave's tap 2026-11-26).
 *
 * Member surfaces (Spaces / Build / Rotator / Town / Agents) come OFF
 * the public chrome: the shared header and footer render their member
 * links ONLY for a connected member. A logged-out visitor — including
 * one who lands directly on a member URL — sees the public chrome:
 * logo, the honesty line, and the Connect action (WhopConnect).
 *
 * State comes only from GET /api/auth/session, the same probe
 * WhopConnect and the homepage already use. While the probe is in
 * flight, and on any failure, nothing member-facing renders — the
 * public face is the safe default.
 */

type SessionLike = { connected?: boolean } | null;

function useConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: SessionLike) => {
        if (live) setConnected(Boolean(s?.connected));
      })
      .catch(() => {
        if (live) setConnected(false);
      });
    return () => {
      live = false;
    };
  }, []);
  return connected;
}

const NAV = [
  { href: "/spaces", label: "Spaces" },
  { href: "/build", label: "Build" },
  { href: "/bridge-code", label: "Bridge code" },
  { href: "/town", label: "Town" },
  { href: "/agents", label: "Agents" },
];

/** The header's member links — connected members only. */
export function MemberNavLinks() {
  const connected = useConnected();
  if (!connected) return null;
  return (
    <>
      {NAV.map((item) => (
        <a
          key={item.href}
          className="hidden text-muted-foreground transition-colors hover:text-foreground md:inline"
          href={item.href}
        >
          {item.label}
        </a>
      ))}
    </>
  );
}

const FOOTER_COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Explore",
    links: [
      { href: "/spaces", label: "Spaces" },
      { href: "/build", label: "Build an agent" },
    ],
  },
  {
    title: "Start",
    links: [
      { href: "/town", label: "Agent Town" },
      { href: "/agents", label: "Agents" },
      { href: "/how", label: "How it works" },
      { href: "/api/auth/whop", label: "Connect" },
    ],
  },
];

/** The footer's member link columns — connected members only. */
export function MemberFooterColumns() {
  const connected = useConnected();
  if (!connected) return null;
  return (
    <>
      {FOOTER_COLUMNS.map((col) => (
        <nav key={col.title} aria-label={col.title}>
          <p className="font-semibold text-foreground">{col.title}</p>
          <ul className="mt-3 space-y-2">
            {col.links.map((link) => (
              <li key={link.href + link.label}>
                <a className="transition-colors hover:text-foreground" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ))}
    </>
  );
}
