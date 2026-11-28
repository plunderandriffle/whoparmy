"use client";

import { useEffect, useState } from "react";

type SessionLike = { connected?: boolean } | null;
type BridgeAccount = { connected?: boolean; error?: string | null; errorCode?: string | null };

function useConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
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
  { href: "/#outcomes", label: "Outcomes" },
  { href: "/bridge-code", label: "My agent" },
];

/** The header's member links — connected members only. */
export function MemberNavLinks() {
  const connected = useConnected();
  const [setupIncomplete, setSetupIncomplete] = useState(false);

  useEffect(() => {
    if (!connected) return;
    const request = new AbortController();
    void fetch("/api/bridge/account", { cache: "no-store", signal: request.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { account?: BridgeAccount } | null) => {
        const account = data?.account;
        if (request.signal.aborted || account?.connected !== false) return;
        if (account.errorCode === "NO_WHOP_ID" || (!account.errorCode && !account.error)) {
          setSetupIncomplete(true);
        }
      })
      .catch(() => {});
    return () => request.abort();
  }, [connected]);

  if (!connected) return null;
  const links = setupIncomplete ? [...NAV, { href: "/build", label: "Continue setup" }] : NAV;
  return (
    <>
      {links.map((item) => (
        <a
          key={item.href}
          className="text-muted-foreground transition-colors hover:text-foreground"
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
      { href: "/#outcomes", label: "Outcomes" },
      { href: "/#how-it-works", label: "How it works" },
    ],
  },
  {
    title: "Start",
    links: [
      { href: "/build", label: "Start your agent" },
      { href: "/bridge-code", label: "My agent" },
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
