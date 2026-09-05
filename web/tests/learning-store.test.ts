import { describe, expect, it } from 'vitest';
import {
  createLearningState,
  finishFocus,
  saveDraft,
  startFocus,
  STORAGE_KEY,
} from '../lib/learning-state';
import {
  FOCUS_OWNER_KEY,
  LearningStore,
  RECOVERY_PREFIX,
  type LearningStorage,
} from '../lib/learning-store';

const now = 1_788_609_600_000;
function memory() {
  const data = new Map<string, string>();
  const writes: string[] = [];
  const storage: LearningStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { data, writes, storage };
}
function exclusive() {
  let pending = Promise.resolve();
  return (task: () => void) => {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  };
}

describe('learning storage recovery', () => {
  it('preserves corrupt raw data before replacing the main value', async () => {
    const disk = memory();
    disk.data.set(STORAGE_KEY, '{"version":1,broken');
    const store = new LearningStore({
      storage: disk.storage,
      tabId: 'a',
      now: () => now,
      withLock: exclusive(),
    });
    expect(store.getSnapshot().error).toContain('original data is preserved');
    await store.sync();
    expect(disk.data.get(STORAGE_KEY)).toBe('{"version":1,broken');
    await store.update((state) => ({ ...state, weeklyTargetMinutes: 120 }));
    const backup = [...disk.data.entries()].find(([key]) =>
      key.startsWith(RECOVERY_PREFIX),
    );
    expect(backup?.[1]).toBe('{"version":1,broken');
    expect(disk.writes.indexOf(backup![0])).toBeLessThan(
      disk.writes.indexOf(STORAGE_KEY),
    );
    expect(JSON.parse(disk.data.get(STORAGE_KEY)!).weeklyTargetMinutes).toBe(
      120,
    );
    expect(store.getSnapshot().error).toContain('recovery backup');
    await store.update((state) => ({ ...state, weeklyTargetMinutes: 240 }));
    expect(disk.data.get(backup![0])).toBe('{"version":1,broken');
  });

  it('never replaces corrupt data when backup creation or verification fails', async () => {
    for (const failSilently of [false, true]) {
      const disk = memory();
      disk.data.set(STORAGE_KEY, 'unrecoverable');
      const storage: LearningStorage = {
        ...disk.storage,
        setItem: (key, value) => {
          if (key.startsWith(RECOVERY_PREFIX)) {
            if (failSilently) return;
            throw new Error('Quota');
          }
          disk.storage.setItem(key, value);
        },
      };
      const store = new LearningStore({
        storage,
        tabId: 'a',
        now: () => now,
        withLock: exclusive(),
      });
      await store.update((state) => ({ ...state, weeklyTargetMinutes: 120 }));
      expect(disk.data.get(STORAGE_KEY)).toBe('unrecoverable');
      expect(store.getSnapshot().state.weeklyTargetMinutes).toBe(120);
      expect(store.getSnapshot().error).toContain('original data');
    }
  });

  it('keeps unsaved work in memory if another tab updates storage after a save failure', async () => {
    const disk = memory();
    disk.data.set(STORAGE_KEY, 'corrupt');
    let blocked = true;
    const storage: LearningStorage = {
      ...disk.storage,
      setItem: (key, value) => {
        if (blocked) throw new Error('Quota');
        disk.storage.setItem(key, value);
      },
    };
    const store = new LearningStore({
      storage,
      tabId: 'a',
      now: () => now,
      withLock: exclusive(),
    });
    await store.update((state) => ({ ...state, weeklyTargetMinutes: 120 }));
    blocked = false;
    disk.data.set(
      STORAGE_KEY,
      JSON.stringify({ ...createLearningState(now), weeklyTargetMinutes: 999 }),
    );
    await store.update((state) => ({ ...state, weeklyTargetMinutes: 240 }));
    expect(JSON.parse(disk.data.get(STORAGE_KEY)!).weeklyTargetMinutes).toBe(
      999,
    );
    expect(store.getSnapshot().state.weeklyTargetMinutes).toBe(240);
    expect(store.getSnapshot().error).toContain(
      'Another tab changed saved data',
    );
  });

  it('does not overwrite a prior recovery backup with the same timestamp', async () => {
    const disk = memory();
    disk.data.set(STORAGE_KEY, 'new corruption');
    disk.data.set(RECOVERY_PREFIX + now + '.a', 'older corruption');
    const store = new LearningStore({
      storage: disk.storage,
      tabId: 'a',
      now: () => now,
      withLock: exclusive(),
    });
    await store.update((state) => ({ ...state, weeklyTargetMinutes: 120 }));
    expect(disk.data.get(RECOVERY_PREFIX + now + '.a')).toBe(
      'older corruption',
    );
    expect(disk.data.get(RECOVERY_PREFIX + now + '.a.1')).toBe(
      'new corruption',
    );
  });

  it('refuses to write when existing saved data cannot be read', async () => {
    const disk = memory();
    disk.data.set(STORAGE_KEY, 'existing data');
    const storage = {
      ...disk.storage,
      getItem: () => {
        throw new Error('Access denied');
      },
    };
    const store = new LearningStore({
      storage,
      tabId: 'a',
      now: () => now,
      withLock: exclusive(),
    });
    await store.update((state) => ({ ...state, weeklyTargetMinutes: 120 }));
    expect(disk.data.get(STORAGE_KEY)).toBe('existing data');
    expect(store.getSnapshot().state.weeklyTargetMinutes).toBe(120);
    expect(store.getSnapshot().error).toContain('could not be saved safely');
  });
});

describe('cross-tab serialization and focus ownership', () => {
  it('rebases each queued updater on the latest saved state', async () => {
    const disk = memory();
    const withLock = exclusive();
    const a = new LearningStore({
      storage: disk.storage,
      tabId: 'a',
      now: () => now,
      withLock,
    });
    const b = new LearningStore({
      storage: disk.storage,
      tabId: 'b',
      now: () => now,
      withLock,
    });
    await Promise.all([
      a.update((state) => ({ ...state, weeklyTargetMinutes: 120 })),
      b.update((state) =>
        saveDraft(
          state,
          {
            exerciseId: 'arrays',
            snapshot: 'abc',
            language: 'cpp',
            source: 'my attempt',
            revealedHints: 0,
          },
          now,
        ),
      ),
    ]);
    await a.sync();
    expect(a.getSnapshot().state.weeklyTargetMinutes).toBe(120);
    expect(Object.values(a.getSnapshot().state.drafts)[0].source).toBe(
      'my attempt',
    );
  });

  it('allows only one tab to credit a shared timer and records completion once', async () => {
    const disk = memory();
    const withLock = exclusive();
    let time = now;
    const a = new LearningStore({
      storage: disk.storage,
      tabId: 'a',
      now: () => time,
      withLock,
    });
    const b = new LearningStore({
      storage: disk.storage,
      tabId: 'b',
      now: () => time,
      withLock,
    });
    await Promise.all([
      a.update((state) => startFocus(state, 'c', 1, time)),
      b.update((state) => startFocus(state, 'c', 1, time)),
    ]);
    expect(JSON.parse(disk.data.get(FOCUS_OWNER_KEY)!).tabId).toBe('a');
    time += 15_000;
    await Promise.all([a.tick(), b.tick()]);
    expect(JSON.parse(disk.data.get(STORAGE_KEY)!).activeFocus.focusedMs).toBe(
      15_000,
    );
    await Promise.all([
      a.update((state) => finishFocus(state, time)),
      b.update((state) => finishFocus(state, time)),
    ]);
    const saved = JSON.parse(disk.data.get(STORAGE_KEY)!);
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].focusedMs).toBe(15_000);
    expect(disk.data.has(FOCUS_OWNER_KEY)).toBe(false);
  });

  it('shows a live timer in a new tab without stealing its owner, then pauses a stale owner without credit', async () => {
    const disk = memory();
    const withLock = exclusive();
    let time = now;
    const a = new LearningStore({
      storage: disk.storage,
      tabId: 'a',
      now: () => time,
      withLock,
    });
    await a.update((state) => startFocus(state, null, 25, time));
    time += 15_000;
    await a.tick();
    const b = new LearningStore({
      storage: disk.storage,
      tabId: 'b',
      now: () => time,
      withLock,
    });
    expect(b.getSnapshot().state.activeFocus?.running).toBe(true);
    time += 15_000;
    await b.tick();
    expect(JSON.parse(disk.data.get(STORAGE_KEY)!).activeFocus.focusedMs).toBe(
      15_000,
    );
    time += 65_001;
    await b.tick();
    expect(JSON.parse(disk.data.get(STORAGE_KEY)!).activeFocus).toMatchObject({
      running: false,
      focusedMs: 15_000,
    });
    expect(disk.data.has(FOCUS_OWNER_KEY)).toBe(false);
  });

  it('does not erase unrelated tab changes or write endlessly on storage sync', async () => {
    const disk = memory();
    disk.data.set(STORAGE_KEY, JSON.stringify(createLearningState(now)));
    const store = new LearningStore({
      storage: disk.storage,
      tabId: 'a',
      now: () => now,
      withLock: exclusive(),
    });
    await store.sync();
    await store.sync();
    expect(disk.writes).toHaveLength(0);
    const other = { ...createLearningState(now), weeklyTargetMinutes: 99 };
    disk.data.set(STORAGE_KEY, JSON.stringify(other));
    await store.sync();
    expect(store.getSnapshot().state.weeklyTargetMinutes).toBe(99);
    expect(disk.writes).toHaveLength(0);
  });

  it('fails closed for timer starts when shared-tab locking is unavailable', async () => {
    const disk = memory();
    const store = new LearningStore({
      storage: disk.storage,
      tabId: 'a',
      now: () => now,
    });
    await store.update((state) => startFocus(state, null, 25, now));
    expect(store.getSnapshot().state.activeFocus).toBeNull();
    expect(store.getSnapshot().error).toContain('Web Locks');
    await store.update((state) => ({ ...state, weeklyTargetMinutes: 120 }));
    expect(store.getSnapshot().state.weeklyTargetMinutes).toBe(120);
  });

  it('surfaces lock failures rather than silently dropping an update', async () => {
    const disk = memory();
    const store = new LearningStore({
      storage: disk.storage,
      tabId: 'a',
      now: () => now,
      withLock: () => Promise.reject(new Error('Lock failed')),
    });
    await store.update((state) => ({ ...state, weeklyTargetMinutes: 120 }));
    expect(store.getSnapshot().error).toContain('could not lock');
    expect(disk.data.has(STORAGE_KEY)).toBe(false);
  });
});
