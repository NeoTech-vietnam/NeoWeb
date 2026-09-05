import {
  createLearningState,
  learningStateSchema,
  migrateLearningState,
  pauseFocus,
  recoverLearningState,
  STORAGE_KEY,
  tickFocus,
  type LearningStateV1,
} from './learning-state';

export const FOCUS_OWNER_KEY = STORAGE_KEY + '.focus-owner';
export const RECOVERY_PREFIX = STORAGE_KEY + '.recovery.';
export interface LearningSnapshot {
  state: LearningStateV1;
  error: string | null;
}
export interface LearningStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface LearningStoreOptions {
  storage: LearningStorage;
  tabId: string;
  now?: () => number;
  withLock?: (task: () => void) => Promise<void>;
}
interface FocusOwner {
  tabId: string;
  sessionId: string;
  heartbeatAt: number;
}
interface StoredState {
  state: LearningStateV1;
  raw: string | null;
  accessible: boolean;
  corrupt: boolean;
  recovered: boolean;
  error: string | null;
}

// All read-modify-write operations use the same origin-wide Web Lock. The lease
// names the sole tab allowed to credit focus; it is never included in exports.
export class LearningStore {
  private current!: LearningSnapshot;
  private listeners = new Set<() => void>();
  private pending = Promise.resolve();
  private dirty = false;
  private dirtyBase: string | null | undefined;
  private recoveryMessage: string | null = null;
  private now: () => number;

  constructor(private options: LearningStoreOptions) {
    this.now = options.now ?? Date.now;
    const saved = this.read();
    this.current = { state: saved.state, error: saved.error };
  }

  getSnapshot = (): LearningSnapshot => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(state: LearningStateV1, error: string | null): void {
    this.current = { state, error };
    this.listeners.forEach((listener) => listener());
  }

  private owner(): FocusOwner | null {
    try {
      const raw = this.options.storage.getItem(FOCUS_OWNER_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<FocusOwner>;
      return typeof value.tabId === 'string' &&
        typeof value.sessionId === 'string' &&
        typeof value.heartbeatAt === 'number' &&
        Number.isFinite(value.heartbeatAt)
        ? {
            tabId: value.tabId,
            sessionId: value.sessionId,
            heartbeatAt: value.heartbeatAt,
          }
        : null;
    } catch {
      return null;
    }
  }

  private read(): StoredState {
    let raw: string | null;
    const fallback = this.current?.state ?? createLearningState(this.now());
    try {
      raw = this.options.storage.getItem(STORAGE_KEY);
    } catch {
      return {
        state: fallback,
        raw: null,
        accessible: false,
        corrupt: false,
        recovered: false,
        error:
          'Browser storage cannot be read. Existing saved data has not been replaced.',
      };
    }
    try {
      let state =
        raw === null
          ? createLearningState(this.now())
          : migrateLearningState(JSON.parse(raw));
      let recovered = false;
      if (state.activeFocus?.running) {
        const owner = this.owner();
        const age = owner ? this.now() - owner.heartbeatAt : Infinity;
        if (
          !owner ||
          owner.sessionId !== state.activeFocus.id ||
          age < 0 ||
          age > 65_000
        ) {
          state = recoverLearningState(state, this.now());
          recovered = true;
        }
      }
      return {
        state,
        raw,
        accessible: true,
        corrupt: false,
        recovered,
        error: null,
      };
    } catch {
      return {
        state: fallback,
        raw,
        accessible: true,
        corrupt: true,
        recovered: false,
        error:
          'Saved learning data could not be loaded. The original data is preserved; new changes will create a recovery backup first.',
      };
    }
  }

  private backup(raw: string): void {
    const prefix = RECOVERY_PREFIX + this.now() + '.' + this.options.tabId;
    let key = prefix;
    for (let suffix = 1; ; suffix++) {
      const previous = this.options.storage.getItem(key);
      if (previous === raw) break;
      if (previous === null) {
        this.options.storage.setItem(key, raw);
        break;
      }
      key = prefix + '.' + suffix;
    }
    if (this.options.storage.getItem(key) !== raw)
      throw new Error('The recovery backup could not be verified.');
    this.recoveryMessage =
      'Unreadable saved data was preserved in a local recovery backup before saving these changes.';
  }

  update = (fn: (old: LearningStateV1) => LearningStateV1): Promise<void> => {
    const perform = () => {
      const disk = this.read();
      const previous = this.dirty ? this.current.state : disk.state;
      let candidate: LearningStateV1;
      try {
        candidate = fn(previous);
      } catch (error) {
        this.publish(
          previous,
          error instanceof Error
            ? error.message
            : 'The change could not be applied.',
        );
        return;
      }
      if (candidate === previous && !disk.recovered && !this.dirty) {
        this.publish(previous, this.recoveryMessage ?? disk.error);
        return;
      }
      let next: LearningStateV1;
      try {
        next = learningStateSchema.parse({
          ...candidate,
          updatedAt: this.now(),
        });
      } catch (error) {
        this.publish(
          previous,
          error instanceof Error ? error.message : 'Invalid learning data.',
        );
        return;
      }
      if (this.dirty && disk.accessible && disk.raw !== this.dirtyBase) {
        this.publish(
          recoverLearningState(next, this.now()),
          'Another tab changed saved data while this tab has unsaved work. Export this tab’s changes before reloading; saved data has not been replaced.',
        );
        return;
      }
      const startsFocus =
        next.activeFocus?.running &&
        (!previous.activeFocus?.running ||
          previous.activeFocus.id !== next.activeFocus.id);
      if (startsFocus && !this.options.withLock) {
        this.publish(
          previous,
          'This browser cannot coordinate focus sessions across tabs. Use a current browser with Web Locks support.',
        );
        return;
      }
      try {
        if (!disk.accessible)
          throw new Error('Saved data cannot be read safely.');
        if (disk.corrupt && disk.raw !== null) this.backup(disk.raw);
        const owner = this.owner();
        if (
          next.activeFocus?.running &&
          (startsFocus || owner?.tabId === this.options.tabId)
        ) {
          this.options.storage.setItem(
            FOCUS_OWNER_KEY,
            JSON.stringify({
              tabId: this.options.tabId,
              sessionId: next.activeFocus.id,
              heartbeatAt: next.activeFocus.heartbeatAt,
            } satisfies FocusOwner),
          );
        }
        this.options.storage.setItem(STORAGE_KEY, JSON.stringify(next));
        if (!next.activeFocus?.running)
          this.options.storage.removeItem(FOCUS_OWNER_KEY);
        this.dirty = false;
        this.dirtyBase = undefined;
        this.publish(next, this.recoveryMessage);
      } catch {
        this.dirty = true;
        try {
          this.dirtyBase = this.options.storage.getItem(STORAGE_KEY);
        } catch {
          this.dirtyBase = disk.raw;
        }
        // Never keep crediting a timer whose ownership or progress cannot be saved.
        next = recoverLearningState(next, this.now());
        try {
          if (this.owner()?.tabId === this.options.tabId)
            this.options.storage.removeItem(FOCUS_OWNER_KEY);
        } catch {
          /* Preserve in-memory work. */
        }
        this.publish(
          next,
          disk.corrupt
            ? 'Saved data could not be replaced safely. The original data or its verified recovery backup is preserved. New changes remain in this tab; export them before closing.'
            : 'Changes remain in this tab but could not be saved safely. Export your learning data before closing.',
        );
      }
    };
    const run = () =>
      this.options.withLock
        ? this.options.withLock(perform)
        : Promise.resolve().then(perform);
    this.pending = this.pending.then(run).catch(() => {
      this.publish(
        this.current.state,
        'The browser could not lock saved learning data. Please retry the change.',
      );
    });
    return this.pending;
  };

  sync = (): Promise<void> => this.update((state) => state);

  tick = (): Promise<void> =>
    this.update((state) =>
      this.owner()?.tabId === this.options.tabId
        ? tickFocus(state, this.now())
        : state,
    );

  pauseOwned = (): Promise<void> =>
    this.update((state) =>
      this.owner()?.tabId === this.options.tabId
        ? pauseFocus(state, this.now())
        : state,
    );
}
