/** Plain-text hand-off instructions for any agent using a member's bridge code. */
export function bridgeAgentBrief(code: string): string {
  return `This is a one-time bridge code that connects you to the member's Plunder & Riffle account, using the member's own credits. You do not need an API key; never ask the member for one.

Bridge code: ${code}
This code works once and expires in 24 hours.

Exchange the code by sending POST https://whop.plunderandriffle.com/api/bridge/exchange with body {"code": "${code}"}. A successful exchange returns a bridge token (valid for 7 days) and an mcp_url.

Connect to the MCP server at https://whop.plunderandriffle.com/api/bridge/mcp using the token as Bearer Authorization. Call tools/list first to see which tools are allowed.

Rules:
- Never print the token back to the member, and never store it past 7 days.
- Quote the exact credit cost and wait for the member's "go" before spending any credits.
- Publishing and MP4 rendering are refused at the bridge.
- If exchange errors, report the error message verbatim and stop. Never retry a spent code; get a fresh code from https://whop.plunderandriffle.com/bridge-code.`;
}
