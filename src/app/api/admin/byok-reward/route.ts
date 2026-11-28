import { NextRequest, NextResponse } from "next/server";
import { MAX_BYOK_REWARD_TOTAL } from "@/lib/byok-reward";
import { getByokRewardSettings, setByokRewardSettings } from "@/lib/byok-reward-server";
import { getSessionOperator } from "@/lib/site-gate";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  if (!await getSessionOperator()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await getByokRewardSettings(), { headers });
}

export async function POST(req: NextRequest) {
  if (!await getSessionOperator()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a settings object." }, { status: 400 });
  }
  const { enabled, total } = body as { enabled?: unknown; total?: unknown };
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Enabled must be true or false." }, { status: 400 });
  }
  if (total !== undefined && (typeof total !== "number" || !Number.isInteger(total) || total < 0 || total > MAX_BYOK_REWARD_TOTAL)) {
    return NextResponse.json({ error: `Total must be a whole number between 0 and ${MAX_BYOK_REWARD_TOTAL}.` }, { status: 400 });
  }
  return NextResponse.json(await setByokRewardSettings({ enabled, total }), { headers });
}
