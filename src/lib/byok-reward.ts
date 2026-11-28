import { BYOK_SAVED_LABELS, SAVED_KEYS, type BridgeByokView } from "./bridge-byok";

export const DEFAULT_BYOK_REWARD_TOTAL = 500;
export const MAX_BYOK_REWARD_TOTAL = 100_000;
export const BYOK_REWARD_SOURCE = "byok-step";

export type ByokRewardSettings = { enabled: boolean; total: number };
export type ByokRewards = ByokRewardSettings & {
  earned: number;
  steps: { key: (typeof SAVED_KEYS)[number]; label: string; amount: number; granted: boolean }[];
};

type GrantRow = { externalId: string; amount: number; zeroNetLinksSlice?: number };
type RewardStore = {
  listGrants(userId: string): Promise<GrantRow[]>;
  recordGrant(userId: string, row: GrantRow): Promise<GrantRow>;
};

export function clampByokRewardTotal(total: number): number {
  return Math.min(MAX_BYOK_REWARD_TOTAL, Math.max(0, Math.trunc(total)));
}

export function splitByokReward(total: number): number[] {
  const normalized = Number.isFinite(total) ? clampByokRewardTotal(total) : 0;
  const base = Math.floor(normalized / SAVED_KEYS.length);
  return SAVED_KEYS.map((_, index) => index === SAVED_KEYS.length - 1 ? normalized - base * index : base);
}

export async function syncByokRewardsWithStore({
  store, settings, userId, hasEngineKey, saved, linkSaveFreeGens, grant,
}: {
  store: RewardStore;
  settings: ByokRewardSettings;
  userId: string;
  hasEngineKey: boolean;
  saved: BridgeByokView["saved"] | null;
  linkSaveFreeGens: number;
  grant(externalId: string, amount: number): Promise<boolean>;
}): Promise<ByokRewards> {
  const slices = splitByokReward(settings.total);
  const rows = hasEngineKey && settings.total > 0 ? await store.listGrants(userId) : [];
  const existing = new Map(rows.map((row) => [row.externalId, row]));
  const steps: ByokRewards["steps"] = [];
  for (const [index, key] of SAVED_KEYS.entries()) {
    const externalId = `${BYOK_REWARD_SOURCE}:${userId}:${key}`;
    const slice = slices[index];
    const offset = key === "links" ? linkSaveFreeGens : 0;
    let row = existing.get(externalId);
    if (!row && settings.enabled && settings.total > 0 && hasEngineKey && saved?.[key]) {
      const amount = Math.max(0, slice - offset);
      if (amount === 0 || await grant(externalId, amount).catch(() => false)) {
        row = await store.recordGrant(userId, {
          externalId, amount, ...(key === "links" && amount === 0 ? { zeroNetLinksSlice: slice } : {}),
        });
      }
    }
    steps.push({ key, label: BYOK_SAVED_LABELS[key], amount: row ? (row.zeroNetLinksSlice ?? row.amount + offset) : slice, granted: !!row });
  }
  return {
    ...settings,
    earned: steps.reduce((earned, reward) => earned + (reward.granted ? reward.amount : 0), 0),
    steps,
  };
}
