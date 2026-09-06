import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpotifyClient, type StorageLike } from '../lib/integrations';
import { bindSpotifySync } from '../lib/spotify-sync';

const writeScope = 'user-modify-playback-state';
const key = 'neoweb.oauth.spotify.tokens';
const response = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
const playback = (playing = true, extra = {}) => ({
  item: { name: 'Orbit', artists: [{ name: 'Space' }] },
  is_playing: playing,
  device: { name: 'Desktop', is_active: true, is_restricted: false },
  actions: { disallows: {} },
  ...extra,
});
function setup(scopes: string[] | undefined = [writeScope]) {
  const data = new Map<string, string>([
    [
      key,
      JSON.stringify({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600_000,
        scopes,
      }),
    ],
  ]);
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => response(playback()));
  const client = new SpotifyClient({
    clientId: 'id',
    redirectUri: 'https://example.org/',
    storage,
    fetch: fetcher,
  });
  return { client, fetcher, storage };
}
afterEach(() => vi.useRealTimers());
describe('Spotify playback', () => {
  it('measures the polling interval from completion of a slow read', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    let reply!: (value: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    reply(response(playback()));
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    client.setSyncActive(false);
  });
  it('honors a rate limit returned during token refresh', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({}, 429, { 'Retry-After': '90' }));
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status).toBe('rate-limited');
    await client.refresh();
    await vi.advanceTimersByTimeAsync(89999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.setSyncActive(false);
  });
  it('does not issue a playback command if token refresh removes its permission', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    await client.refresh();
    await vi.advanceTimersByTimeAsync(3600_000);
    fetcher.mockResolvedValueOnce(
      response({
        access_token: 'read-only',
        expires_in: 3600,
        scope: 'user-read-playback-state',
      }),
    );
    await client.next();
    expect(client.canControl).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.error).toContain('Reconnect');
  });
  it('does not let command confirmation timers bypass transient read backoff', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(0);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.next();
    fetcher.mockRejectedValue(new Error('Temporary read failure'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(14999);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
    client.setSyncActive(false);
  });
  it.each([
    ['play', 'PUT'],
    ['pause', 'PUT'],
    ['next', 'POST'],
    ['previous', 'POST'],
  ] as const)(
    'sends %s once to the active device without changing confirmed playback',
    async (command, method) => {
      const { client, fetcher } = setup();
      await client.refresh();
      fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await client[command]();
      expect(fetcher.mock.calls[1][0]).toBe(
        `https://api.spotify.com/v1/me/player/${command}`,
      );
      expect(fetcher.mock.calls[1][1]?.method).toBe(method);
      expect(client.value?.isPlaying).toBe(true);
      expect(client.pendingCommand).toBeNull();
    },
  );
  it('keeps legacy connections readable and requires an explicit permission upgrade', async () => {
    const { client, fetcher } = setup([]);
    await client.refresh();
    expect(client.value?.title).toBe('Orbit');
    expect(client.canControl).toBe(false);
    await client.next();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.error).toContain('Reconnect');
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://api.spotify.com/v1/me/player?additional_types=track,episode',
    );
  });
  it('polls after reads finish, uses paused intervals, and cleans up on deactivation', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(response(playback(false)));
    await vi.advanceTimersByTimeAsync(1);
    expect(client.value?.isPlaying).toBe(false);
    await vi.advanceTimersByTimeAsync(14999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.setSyncActive(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(4);
    client.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('refreshes one and three seconds after a successful command', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(0);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.next();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    client.setSyncActive(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('deduplicates reads, serializes commands, and rejects pre-command stale responses', async () => {
    const { client, fetcher } = setup();
    await client.refresh();
    let reply!: (value: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const read = client.refresh();
    const duplicate = client.refresh();
    expect(read).toBe(duplicate);
    const command = client.next();
    await client.next();
    expect(client.pendingCommand).toBe('next');
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValueOnce(
      new Error('Network lost; command outcome unknown'),
    );
    reply(response(playback(false, { item: { name: 'Stale response' } })));
    await Promise.all([read, command]);
    expect(client.value?.title).toBe('Orbit');
    expect(client.value?.isPlaying).toBe(true);
    expect(client.stale).toBe(true);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/next')),
    ).toHaveLength(1);
  });
  it.each([
    { device: null },
    { device: { is_active: false } },
    { device: { is_active: true, is_restricted: true } },
    { actions: { disallows: { skipping_next: true } } },
    { actions: { skipping_next: true } },
  ])('respects absent devices and action restrictions: %j', async (extra) => {
    const { client, fetcher } = setup();
    fetcher.mockResolvedValueOnce(response(playback(true, extra)));
    await client.refresh();
    expect(client.controlReason('next')).toBeTruthy();
    await client.next();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reads an idle session without inventing a track and polls every 15 seconds', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    fetcher.mockImplementation(async () => new Response(null, { status: 204 }));
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status).toBe('empty');
    expect(client.value).toBeNull();
    expect(client.controlReason('play')).toContain('Open Spotify');
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    client.setSyncActive(false);
  });
  it('retains the last track and backs off 15, 30, then 60 seconds after read failures', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(0);
    const synced = client.lastSyncedAt;
    fetcher.mockRejectedValue(new Error('Offline temporarily'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.stale).toBe(true);
    expect(client.lastSyncedAt).toBe(synced);
    expect(client.value?.title).toBe('Orbit');
    for (const [delay, count] of [
      [15000, 3],
      [30000, 4],
      [60000, 5],
      [60000, 6],
    ]) {
      await vi.advanceTimersByTimeAsync(delay! - 1);
      expect(fetcher).toHaveBeenCalledTimes(count! - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(count!);
    }
    fetcher.mockImplementation(async () => response(playback()));
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.stale).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(8);
    client.setSyncActive(false);
  });
  it('shares Retry-After cooldown across automatic reads, refresh, commands, and reactivation', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(0);
    fetcher.mockResolvedValueOnce(response({}, 429, { 'Retry-After': '120' }));
    await client.next();
    await client.refresh();
    await client.previous();
    client.setSyncActive(false);
    client.setSyncActive(true);
    await vi.advanceTimersByTimeAsync(119999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.setSyncActive(false);
  });
  it.each([401, 403, 429])(
    'stops automatic retries for unrecoverable %i responses',
    async (status) => {
      vi.useFakeTimers();
      const { client, fetcher } = setup();
      fetcher.mockImplementation(async (url) =>
        String(url).includes('/api/token')
          ? response({ access_token: 'renewed', expires_in: 3600 })
          : response({}, status),
      );
      client.setSyncActive(true);
      await vi.advanceTimersByTimeAsync(0);
      const count = fetcher.mock.calls.length;
      await vi.advanceTimersByTimeAsync(600000);
      client.setSyncActive(false);
      client.setSyncActive(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(count);
      client.setSyncActive(false);
    },
  );
  it('preserves scopes on token refresh and supports legacy tokens without scopes', async () => {
    const { client, fetcher, storage } = setup();
    fetcher
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(
        response({ access_token: 'new', expires_in: 3600 }),
      );
    await client.refresh();
    expect(client.canControl).toBe(true);
    expect(JSON.parse(storage.getItem(key)!).scopes).toEqual([writeScope]);
    const legacy = JSON.parse(storage.getItem(key)!);
    delete legacy.scopes;
    storage.setItem(key, JSON.stringify(legacy));
    const old = new SpotifyClient({
      clientId: 'id',
      redirectUri: 'https://example.org/',
      storage,
      fetch: fetcher,
    });
    await old.refresh();
    expect(old.value?.title).toBe('Orbit');
    expect(old.canControl).toBe(false);
  });
  it('stops on hidden/offline, resumes on visible/online, and removes listeners at unmount', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup();
    const page = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
    });
    const browser = new EventTarget();
    const network = { onLine: true };
    const cleanup = bindSpotifySync(client, page, browser, network);
    await vi.advanceTimersByTimeAsync(0);
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    network.onLine = false;
    browser.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    network.onLine = true;
    browser.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
    cleanup();
    browser.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
