import { NextResponse } from "next/server";
import { getWhopUser, UnauthorizedError } from "@/lib/auth";
import { BridgeError, getMemberEngineKey, getOrCreateBridgeKeyClaim } from "@/lib/muse-bridge";

export const runtime = "nodejs";

export async function POST() {
  try {
    const user = await getWhopUser();
    await getMemberEngineKey(user);
    const { code, expiresAt, token } = await getOrCreateBridgeKeyClaim(user.id);
    return NextResponse.json({ code, expiresAt, token }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof BridgeError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not generate a permanent connection brief" },
      { status: err instanceof UnauthorizedError ? 401 : 500 },
    );
  }
}
