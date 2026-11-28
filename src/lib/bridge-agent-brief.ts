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

export function permanentAgentBrief(code: string, token: string): string {
  return `This is a PERMANENT connection to the member's Plunder & Riffle account, using their own credits. There is no weekly re-pairing. The member can revoke the update token and stop future claims at https://whop.plunderandriffle.com/bridge-code. A key you already claimed stays live until the engine rotates it.

1. Claim the durable key once. Send POST https://whop.plunderandriffle.com/api/bridge/key-claim/exchange with header Authorization: Bearer ${token} and body {"code": "${code}"}. This returns the member's durable P&R key, plan, and credits. The claim code works once and expires in 24 hours.

2. Save both the durable key and the update token in your own secure storage. Never print either back to the member, and never put them in chat, memory, or files.

3. Connect directly to MCP at https://bot.plunderandriffle.com/api/mcp using the durable key as Bearer Authorization. Call tools/list first.

Quote the exact credit cost and wait for the member's "go" before spending. The key spends the member's own credits; their balance is the limit. The engine refuses publishing with this key, so deliver work for the member's approval.

If the claim exchange errors, report the message verbatim and stop. Ask the member for a fresh permanent brief from https://whop.plunderandriffle.com/bridge-code. A fresh claim code uses the same update token unless it has been revoked.`;
}
