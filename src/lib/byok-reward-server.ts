import "server-only";
import { Prisma } from "@prisma/client";
import { LINK_SAVE_FREE_GENS } from "@/lib/bridge";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/site-gate";
import {
  BYOK_REWARD_SOURCE, DEFAULT_BYOK_REWARD_TOTAL, clampByokRewardTotal,
  syncByokRewardsWithStore, type ByokRewardSettings,
} from "@/lib/byok-reward";

const ENABLED_KEY = "byok-reward:enabled";
const TOTAL_KEY = "byok-reward:total";
const zeroNetLinksSliceKey = (externalId: string) => `byok-reward:slice:${externalId}`;

export async function getByokRewardSettings(): Promise<ByokRewardSettings> {
  const [enabled, storedTotal] = await Promise.all([getSetting(ENABLED_KEY), getSetting(TOTAL_KEY)]);
  const total = storedTotal?.trim() ? Number(storedTotal) : NaN;
  return { enabled: enabled !== "off", total: Number.isFinite(total) ? clampByokRewardTotal(total) : DEFAULT_BYOK_REWARD_TOTAL };
}

export async function setByokRewardSettings(settings: Partial<ByokRewardSettings>): Promise<ByokRewardSettings> {
  await db.$transaction(async (tx) => {
    if (settings.enabled !== undefined) await setSetting(ENABLED_KEY, settings.enabled ? "on" : "off", tx);
    if (settings.total !== undefined) await setSetting(TOTAL_KEY, String(settings.total), tx);
  });
  return getByokRewardSettings();
}

type RewardSync = Parameters<typeof syncByokRewardsWithStore>[0];

const store: RewardSync["store"] = {
  async listGrants(userId) {
    const rows = await db.creditGrant.findMany({
      where: { userId, source: BYOK_REWARD_SOURCE }, select: { externalId: true, amount: true },
    });
    return Promise.all(rows.map(async (row) => {
      if (row.amount !== 0 || !row.externalId.endsWith(":links")) return row;
      const storedSlice = await getSetting(zeroNetLinksSliceKey(row.externalId));
      const slice = storedSlice === null ? NaN : Number(storedSlice);
      return { ...row, zeroNetLinksSlice: Number.isFinite(slice) ? clampByokRewardTotal(slice) : undefined };
    }));
  },
  async recordGrant(userId, row) {
    try {
      await db.$transaction(async (tx) => {
        await tx.creditGrant.create({ data: { userId, source: BYOK_REWARD_SOURCE, externalId: row.externalId, amount: row.amount } });
        if (row.zeroNetLinksSlice !== undefined) {
          await tx.appSetting.create({ data: { key: zeroNetLinksSliceKey(row.externalId), value: String(row.zeroNetLinksSlice) } });
        }
      });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = (await store.listGrants(userId)).find(({ externalId }) => externalId === row.externalId);
        if (existing) return existing;
      }
      throw error;
    }
  },
};

export async function syncByokRewards(input: Pick<RewardSync, "userId" | "hasEngineKey" | "saved" | "grant">) {
  return syncByokRewardsWithStore({ ...input, store, settings: await getByokRewardSettings(), linkSaveFreeGens: LINK_SAVE_FREE_GENS });
}
