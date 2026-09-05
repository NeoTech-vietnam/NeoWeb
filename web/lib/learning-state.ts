import { z } from 'zod';

const key = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (value) => !['__proto__', 'prototype', 'constructor'].includes(value),
  );
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const minutes = z.number().int().min(1).max(1440);
const duration = z.number().int().nonnegative().max(86_400_000);
const language = z.enum(['c', 'cpp']);
const rating = z.enum(['again', 'hard', 'good', 'easy']);
const reviewSchema = z
  .object({
    step: z.number().int().min(0).max(4),
    dueAt: timestamp,
    lastReviewedAt: timestamp.optional(),
  })
  .strict();
const attemptSchema = z
  .object({
    id: key,
    exerciseId: key,
    snapshot: key,
    at: timestamp,
    rating,
    correct: z.boolean().nullable(),
    confidence: z.number().int().min(1).max(5),
  })
  .strict();
const draftSchema = z
  .object({
    exerciseId: key,
    snapshot: key,
    language,
    source: z.string().max(1_048_576),
    revealedHints: z.number().int().min(0).max(100),
    updatedAt: timestamp,
  })
  .strict();
const focusFields = {
  id: key,
  topicId: key.nullable(),
  startedAt: timestamp,
  focusedMs: duration,
  targetMs: duration.refine((value) => value > 0),
};
const activeSchema = z
  .object({ ...focusFields, heartbeatAt: timestamp, running: z.boolean() })
  .strict()
  .refine((value) => value.focusedMs <= value.targetMs, 'Focus exceeds target');
const sessionSchema = z
  .object({
    ...focusFields,
    endedAt: timestamp,
    reason: z.enum(['completed', 'stopped', 'interrupted']),
  })
  .strict()
  .refine((value) => value.focusedMs <= value.targetMs, 'Focus exceeds target');

export const learningStateSchema = z
  .object({
    version: z.literal(1),
    updatedAt: timestamp,
    weeklyTargetMinutes: z.number().int().min(1).max(10080).nullable(),
    topicTargets: z.record(key, minutes),
    topicStatus: z.record(key, z.enum(['not-started', 'learning', 'complete'])),
    reviews: z.record(key, reviewSchema),
    attempts: z.array(attemptSchema).max(100_000),
    sessions: z.array(sessionSchema).max(100_000),
    activeFocus: activeSchema.nullable(),
    drafts: z.record(key, draftSchema),
    preferences: z
      .object({
        focusMinutes: z.number().int().min(1).max(240),
        reducedMotion: z.boolean(),
        lastTopicId: key.nullable(),
      })
      .strict(),
  })
  .strict();

export type LearningStateV1 = z.infer<typeof learningStateSchema>;
export type Rating = z.infer<typeof rating>;
export type Language = z.infer<typeof language>;
export type Review = z.infer<typeof reviewSchema>;
export type ReviewAttempt = z.infer<typeof attemptSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type ActiveFocus = z.infer<typeof activeSchema>;
export type FocusSession = z.infer<typeof sessionSchema>;
export const REVIEW_DAYS = [1, 3, 7, 14, 30] as const;
export const STORAGE_KEY = 'neoweb.learning.v1';

export function createLearningState(now = Date.now()): LearningStateV1 {
  return {
    version: 1,
    updatedAt: now,
    weeklyTargetMinutes: null,
    topicTargets: {},
    topicStatus: {},
    reviews: {},
    attempts: [],
    sessions: [],
    activeFocus: null,
    drafts: {},
    preferences: { focusMinutes: 25, reducedMotion: false, lastTopicId: null },
  };
}

export function draftKey(
  exerciseId: string,
  snapshot: string,
  lang: Language,
): string {
  return JSON.stringify([exerciseId, snapshot, lang]);
}

export function saveDraft(
  state: LearningStateV1,
  input: Omit<Draft, 'updatedAt'>,
  now = Date.now(),
): LearningStateV1 {
  const draft = draftSchema.parse({ ...input, updatedAt: now });
  return {
    ...state,
    updatedAt: now,
    drafts: {
      ...state.drafts,
      [draftKey(input.exerciseId, input.snapshot, input.language)]: draft,
    },
  };
}

export function nextReview(
  previous: Review | undefined,
  result: Rating,
  now = Date.now(),
): Review {
  rating.parse(result);
  const current = previous ? reviewSchema.parse(previous).step : 0;
  const step =
    result === 'again'
      ? 0
      : result === 'hard'
        ? current
        : Math.min(4, current + (result === 'easy' ? 2 : 1));
  const due = new Date(now);
  // Calendar days retain the learner's local wall time over DST boundaries.
  due.setDate(due.getDate() + REVIEW_DAYS[step]);
  return { step, dueAt: due.getTime(), lastReviewedAt: now };
}

export function recordReview(
  state: LearningStateV1,
  input: Omit<ReviewAttempt, 'id' | 'at'>,
  now = Date.now(),
): LearningStateV1 {
  const attempt = attemptSchema.parse({
    ...input,
    at: now,
    id: 'review-' + now + '-' + state.attempts.length,
  });
  return {
    ...state,
    updatedAt: now,
    attempts: [...state.attempts, attempt],
    reviews: {
      ...state.reviews,
      [input.exerciseId]: nextReview(
        state.reviews[input.exerciseId],
        input.rating,
        now,
      ),
    },
  };
}

export function startFocus(
  state: LearningStateV1,
  topicId: string | null,
  focusMinutes = state.preferences.focusMinutes,
  now = Date.now(),
): LearningStateV1 {
  if (state.activeFocus) return state;
  z.number().int().min(1).max(240).parse(focusMinutes);
  const activeFocus = activeSchema.parse({
    id: 'focus-' + now + '-' + state.sessions.length,
    topicId,
    startedAt: now,
    heartbeatAt: now,
    focusedMs: 0,
    targetMs: focusMinutes * 60_000,
    running: true,
  });
  return { ...state, updatedAt: now, activeFocus };
}

function closeFocus(
  state: LearningStateV1,
  reason: FocusSession['reason'],
  now: number,
): LearningStateV1 {
  const active = state.activeFocus;
  if (!active) return state;
  const session: FocusSession = {
    id: active.id,
    topicId: active.topicId,
    startedAt: active.startedAt,
    endedAt: now,
    focusedMs: active.focusedMs,
    targetMs: active.targetMs,
    reason,
  };
  return {
    ...state,
    updatedAt: now,
    activeFocus: null,
    sessions: [...state.sessions, session],
  };
}

export function tickFocus(
  state: LearningStateV1,
  now = Date.now(),
): LearningStateV1 {
  const active = state.activeFocus;
  if (!active?.running) return state;
  const gap = now - active.heartbeatAt;
  // Do not credit a suspended device, closed tab, or backwards clock adjustment.
  if (gap < 0 || gap > 65_000) {
    return {
      ...state,
      updatedAt: now,
      activeFocus: { ...active, running: false, heartbeatAt: now },
    };
  }
  const focusedMs = Math.min(active.targetMs, active.focusedMs + gap);
  const next = {
    ...state,
    updatedAt: now,
    activeFocus: { ...active, heartbeatAt: now, focusedMs },
  };
  return focusedMs === active.targetMs
    ? closeFocus(next, 'completed', now)
    : next;
}

export function pauseFocus(
  state: LearningStateV1,
  now = Date.now(),
): LearningStateV1 {
  const next = tickFocus(state, now);
  return next.activeFocus
    ? {
        ...next,
        updatedAt: now,
        activeFocus: { ...next.activeFocus, running: false, heartbeatAt: now },
      }
    : next;
}

export function resumeFocus(
  state: LearningStateV1,
  now = Date.now(),
): LearningStateV1 {
  return state.activeFocus
    ? {
        ...state,
        updatedAt: now,
        activeFocus: { ...state.activeFocus, running: true, heartbeatAt: now },
      }
    : state;
}

export function finishFocus(
  state: LearningStateV1,
  now = Date.now(),
): LearningStateV1 {
  return closeFocus(tickFocus(state, now), 'stopped', now);
}

export function recoverLearningState(
  state: LearningStateV1,
  now = Date.now(),
): LearningStateV1 {
  return state.activeFocus
    ? {
        ...state,
        activeFocus: { ...state.activeFocus, running: false, heartbeatAt: now },
      }
    : state;
}

function assertSafeKeys(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('Learning data is nested too deeply.');
  if (!value || typeof value !== 'object') return;
  for (const name of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(name))
      throw new Error('Learning data contains an unsafe key.');
    assertSafeKeys((value as Record<string, unknown>)[name], depth + 1);
  }
}

export function migrateLearningState(value: unknown): LearningStateV1 {
  assertSafeKeys(value);
  // V1 is the first released format. Add explicit migrations when later versions exist.
  return learningStateSchema.parse(value);
}

export function importLearningState(
  text: string,
  now = Date.now(),
): LearningStateV1 {
  if (new TextEncoder().encode(text).byteLength > 10_485_760)
    throw new Error('Import exceeds 10 MB.');
  return recoverLearningState(migrateLearningState(JSON.parse(text)), now);
}

export function exportLearningState(state: LearningStateV1): string {
  // Strict parsing rejects unexpected properties; OAuth stores are never enumerated.
  return JSON.stringify(
    recoverLearningState(learningStateSchema.parse(state), state.updatedAt),
    null,
    2,
  );
}
