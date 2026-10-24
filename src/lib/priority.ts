import type { ModelInfo, ModelStatus } from '../types';

/**
 * Order in which unverified routes should be probed: a cheap, likely-to-work
 * chat model first, so one manual test usually yields a usable route.
 * `ready` sorts last because it needs no further verification.
 */
const statusOrder: Record<ModelStatus, number> = {
  discovered: 0, degraded: 1, failed: 2, rate_limited: 3, unknown: 4,
  unsupported: 5, auth_failed: 6, ready: 7,
};
const NON_CHAT = /(embed|rerank|whisper|tts|dall|moderation|audio|image|sora|veo|stable-diffusion|clip)/i;
const STRONG = /(gpt-5|gpt-4\.5|gpt-4o(?!-mini)|o[34](-|$)|opus|sonnet|gemini-2\.[05]-pro|gemini-1\.5-pro|70b|72b|405b|deepseek-(chat|r1)|mistral-large|grok-[34])/i;
const FAST = /(flash|mini|lite|small|nano|haiku|turbo|8b|7b|3b|1\.5b)/i;

export type PriorityTier = 'non-chat' | 'strong' | 'fast' | 'standard';

export function priorityTier(model: ModelInfo): PriorityTier {
  if (NON_CHAT.test(model.model_id)) return 'non-chat';
  if (STRONG.test(model.model_id)) return 'strong';
  if (FAST.test(model.model_id)) return 'fast';
  return 'standard';
}

const tierScore: Record<PriorityTier, number> = { 'non-chat': 100, strong: 0, standard: 1, fast: 2 };

export function priorityRanking(models: ModelInfo[]): ModelInfo[] {
  const score = (m: ModelInfo) => tierScore[priorityTier(m)] + statusOrder[m.status] * 10;
  return [...models].sort((a, b) =>
    score(a) - score(b) ||
    (a.latency_ms ?? Number.MAX_SAFE_INTEGER) - (b.latency_ms ?? Number.MAX_SAFE_INTEGER) ||
    a.model_id.localeCompare(b.model_id));
}

/** uid → 1-based position in the recommended probing order. */
export function priorityRanks(models: ModelInfo[]): Map<string, number> {
  return new Map(priorityRanking(models).map((m, i) => [m.uid, i + 1]));
}
