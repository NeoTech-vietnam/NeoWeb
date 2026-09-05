'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  createLearningState,
  STORAGE_KEY,
  type LearningStateV1,
} from './learning-state';
import {
  FOCUS_OWNER_KEY,
  LearningStore,
  type LearningSnapshot,
  type LearningStorage,
} from './learning-store';

const serverSnapshot: LearningSnapshot = {
  state: createLearningState(0),
  error: null,
};
let store: LearningStore | undefined;
let mounts = 0;
let dispose: (() => void) | undefined;

function browserStore(): LearningStore {
  if (!store) {
    let storage: LearningStorage;
    try {
      storage = window.localStorage;
    } catch {
      const unavailable = () => {
        throw new Error('Browser storage is unavailable.');
      };
      storage = {
        getItem: unavailable,
        setItem: unavailable,
        removeItem: unavailable,
      };
    }
    store = new LearningStore({
      storage,
      tabId:
        window.crypto?.randomUUID?.() ??
        'tab-' + Date.now() + '-' + Math.random(),
      withLock: window.navigator.locks
        ? (task) => window.navigator.locks.request(STORAGE_KEY + '.write', task)
        : undefined,
    });
  }
  return store;
}

const getSnapshot = () =>
  typeof window === 'undefined' ? serverSnapshot : browserStore().getSnapshot();
const subscribe = (listener: () => void) => browserStore().subscribe(listener);

// Preserve the UI's updater contract. Errors from serialized writes appear in
// the same subscribed snapshot rather than becoming unhandled rejections.
function update(fn: (old: LearningStateV1) => LearningStateV1): void {
  void browserStore().update(fn);
}

export function useLearningState(): LearningSnapshot & {
  update: typeof update;
} {
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => serverSnapshot,
  );
  useEffect(() => {
    if (++mounts === 1) {
      const current = browserStore();
      void current.sync();
      const timer = window.setInterval(() => {
        void current.tick();
      }, 15_000);
      const pagehide = () => {
        void current.pauseOwned();
      };
      const storage = (event: StorageEvent) => {
        if (
          event.key === STORAGE_KEY ||
          event.key === FOCUS_OWNER_KEY ||
          event.key === null
        )
          void current.sync();
      };
      window.addEventListener('pagehide', pagehide);
      window.addEventListener('storage', storage);
      dispose = () => {
        window.clearInterval(timer);
        window.removeEventListener('pagehide', pagehide);
        window.removeEventListener('storage', storage);
      };
    }
    return () => {
      if (--mounts === 0) {
        dispose?.();
        dispose = undefined;
      }
    };
  }, []);
  return { ...value, update };
}
