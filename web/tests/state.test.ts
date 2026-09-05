import { describe, expect, it } from 'vitest';
import {
  createLearningState,
  draftKey,
  exportLearningState,
  finishFocus,
  importLearningState,
  nextReview,
  pauseFocus,
  recordReview,
  resumeFocus,
  saveDraft,
  startFocus,
  tickFocus,
} from '../lib/learning-state';

const now = new Date(2026, 8, 5, 10, 0).getTime();

describe('review scheduling', () => {
  it('applies each rating and clamps the last interval', () => {
    const previous = { step: 2, dueAt: now };
    expect(nextReview(previous, 'again', now).step).toBe(0);
    expect(nextReview(previous, 'hard', now).step).toBe(2);
    expect(nextReview(previous, 'good', now).step).toBe(3);
    expect(nextReview(previous, 'easy', now).step).toBe(4);
    expect(nextReview({ step: 4, dueAt: now }, 'easy', now).step).toBe(4);
    const expected = new Date(now);
    expected.setDate(expected.getDate() + 3);
    expect(nextReview(undefined, 'good', now).dueAt).toBe(expected.getTime());
  });
  it('uses local calendar days and retains separate correctness and confidence', () => {
    const before = new Date(2026, 2, 7, 10).getTime();
    const result = new Date(nextReview(undefined, 'hard', before).dueAt);
    expect(result.getDate()).toBe(8);
    expect(result.getHours()).toBe(10);
    const state = recordReview(
      createLearningState(now),
      {
        exerciseId: 'arrays',
        snapshot: 'abc',
        rating: 'easy',
        correct: false,
        confidence: 5,
      },
      now,
    );
    expect(state.attempts[0]).toMatchObject({
      correct: false,
      confidence: 5,
      rating: 'easy',
    });
    expect(state.reviews.arrays.step).toBe(2);
  });
});

describe('learning data', () => {
  it('starts without fabricated progress or targets', () => {
    expect(createLearningState(now)).toMatchObject({
      weeklyTargetMinutes: null,
      topicStatus: {},
      attempts: [],
      sessions: [],
    });
  });
  it('isolates exercise, language, and snapshot drafts without delimiter collisions', () => {
    let state = createLearningState(now);
    for (const [snapshot, language, source] of [
      ['a', 'c', 'first'],
      ['b', 'c', 'second'],
      ['a', 'cpp', 'third'],
    ] as const) {
      state = saveDraft(
        state,
        { exerciseId: 'arrays', snapshot, language, source, revealedHints: 1 },
        now,
      );
    }
    expect(Object.keys(state.drafts)).toHaveLength(3);
    expect(state.drafts[draftKey('arrays', 'a', 'c')].source).toBe('first');
    expect(draftKey('a:b', 'c', 'c')).not.toBe(draftKey('a', 'b:c', 'c'));
  });
  it('round trips valid exports and rejects unknown fields, versions, and oversized imports', () => {
    const state = createLearningState(now);
    expect(importLearningState(exportLearningState(state), now)).toEqual(state);
    expect(() =>
      importLearningState(JSON.stringify({ ...state, version: 2 })),
    ).toThrow();
    expect(() =>
      importLearningState(JSON.stringify({ ...state, access_token: 'secret' })),
    ).toThrow();
    expect(() =>
      importLearningState(
        JSON.stringify({
          ...state,
          preferences: { ...state.preferences, token: 'secret' },
        }),
      ),
    ).toThrow();
    expect(() => importLearningState(' '.repeat(10_485_761))).toThrow('10 MB');
    expect(exportLearningState(state)).not.toContain('token');
  });
  it('rejects prototype keys and invalid numeric fields', () => {
    const state = createLearningState(now);
    expect(() =>
      importLearningState(
        JSON.stringify({
          ...state,
          topicStatus: JSON.parse('{"__proto__":"complete"}'),
        }),
      ),
    ).toThrow();
    expect(() =>
      importLearningState(
        JSON.stringify({ ...state, weeklyTargetMinutes: -1 }),
      ),
    ).toThrow();
  });
});

describe('focus timer', () => {
  it('does not credit a closed browser, a suspension, or a backwards clock', () => {
    const running = tickFocus(
      startFocus(createLearningState(now), 'c', 25, now),
      now + 15_000,
    );
    const recovered = importLearningState(
      JSON.stringify(running),
      now + 86_400_000,
    );
    expect(recovered.activeFocus).toMatchObject({
      focusedMs: 15_000,
      running: false,
    });
    expect(tickFocus(running, now + 600_000).activeFocus).toMatchObject({
      focusedMs: 15_000,
      running: false,
    });
    expect(tickFocus(running, now).activeFocus).toMatchObject({
      focusedMs: 15_000,
      running: false,
    });
  });
  it('pauses and resumes without crediting the gap', () => {
    let state = pauseFocus(
      startFocus(createLearningState(now), null, 25, now),
      now + 20_000,
    );
    state = resumeFocus(state, now + 600_000);
    state = tickFocus(state, now + 610_000);
    expect(state.activeFocus?.focusedMs).toBe(30_000);
    expect(finishFocus(state, now + 610_000).sessions[0]).toMatchObject({
      focusedMs: 30_000,
      reason: 'stopped',
    });
  });
  it('completes exactly once at the target and will not overwrite an active session', () => {
    let state = startFocus(createLearningState(now), null, 1, now);
    expect(startFocus(state, 'other', 20, now + 1)).toBe(state);
    state = tickFocus(state, now + 65_000);
    expect(state.activeFocus).toBeNull();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      focusedMs: 60_000,
      reason: 'completed',
    });
    expect(
      finishFocus(tickFocus(state, now + 66_000), now + 67_000).sessions,
    ).toHaveLength(1);
  });
});
