import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CalendarClient,
  SpotifyClient,
  type StorageLike,
  type GoogleOAuth,
} from '../lib/integrations';

const now = 1_788_609_600_000;
const root = 'https://example.github.io/NeoWeb/';
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
function memory(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}
function spotify(fetcher = vi.fn<typeof fetch>()) {
  const storage = memory();
  let current = root + '#/practice?exercise=arrays';
  let authorize = '';
  const client = new SpotifyClient({
    clientId: 'public-client',
    redirectUri: root,
    storage,
    fetch: fetcher,
    now: () => now,
    crypto: webcrypto as Crypto,
    getUrl: () => current,
    replaceUrl: (url) => {
      current = url;
    },
    navigate: (url) => {
      authorize = url;
    },
  });
  return {
    client,
    storage,
    fetcher,
    url: () => current,
    authorization: () => authorize,
    callback: (state?: string) => {
      current =
        root +
        '?code=one-use&state=' +
        encodeURIComponent(
          state ?? new URL(authorize).searchParams.get('state')!,
        );
    },
  };
}

describe('Spotify PKCE', () => {
  it('uses PKCE without a secret, restores hash, consumes the callback once, and treats 204 as empty', async () => {
    const app = spotify();
    await app.client.connect();
    const authorization = new URL(app.authorization());
    expect(authorization.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorization.searchParams.get('code_challenge')).toHaveLength(43);
    expect(authorization.searchParams.get('scope')).toBe(
      'user-read-currently-playing user-read-playback-state',
    );
    app.callback();
    app.fetcher
      .mockResolvedValueOnce(
        json({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await Promise.all([
      app.client.finishCallback(),
      app.client.finishCallback(),
    ]);
    expect(app.fetcher).toHaveBeenCalledTimes(2);
    expect(String(app.fetcher.mock.calls[0][1]?.body)).not.toContain('secret');
    expect(app.url()).toBe(root + '#/practice?exercise=arrays');
    expect(app.client.status).toBe('empty');
  });
  it('ignores a response that arrives after disconnect', async () => {
    const store = memory();
    store.setItem(
      'neoweb.oauth.spotify.tokens',
      JSON.stringify({ accessToken: 'access', expiresAt: now + 3600_000 }),
    );
    let reply: (response: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const client = new SpotifyClient({
      clientId: 'id',
      redirectUri: root,
      storage: store,
      fetch: fetcher,
      now: () => now,
    });
    const refresh = client.refresh();
    client.disconnect();
    reply(json({ item: { name: 'Private song' }, is_playing: true }));
    await refresh;
    expect(client.status).toBe('disconnected');
    expect(client.value).toBeNull();
  });
  it('rejects mismatched state without exchanging code', async () => {
    const app = spotify();
    await app.client.connect();
    app.callback('wrong');
    await app.client.finishCallback();
    expect(app.fetcher).not.toHaveBeenCalled();
    expect(app.client.status).toBe('expired');
    expect(app.url()).not.toContain('code=');
  });
  it('rejects an expired pending authorization and a localhost redirect', async () => {
    const app = spotify();
    await app.client.connect();
    const pending = JSON.parse(
      app.storage.getItem('neoweb.oauth.spotify.pending')!,
    );
    app.storage.setItem(
      'neoweb.oauth.spotify.pending',
      JSON.stringify({ ...pending, createdAt: now - 600_001 }),
    );
    app.callback();
    await app.client.finishCallback();
    expect(app.client.status).toBe('expired');
    expect(app.fetcher).not.toHaveBeenCalled();
    const invalid = new SpotifyClient({
      clientId: 'id',
      redirectUri: 'http://localhost:3000/',
      storage: memory(),
      getUrl: () => 'http://localhost:3000/',
      crypto: webcrypto as Crypto,
    });
    await invalid.connect();
    expect(invalid.status).toBe('error');
  });
  it('refreshes once after 401, preserves omitted refresh token, handles restrictions and rate limits', async () => {
    const store = memory();
    store.setItem(
      'neoweb.oauth.spotify.tokens',
      JSON.stringify({
        accessToken: 'old',
        refreshToken: 'keep',
        expiresAt: now + 3600_000,
      }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(json({}, 403));
    const client = new SpotifyClient({
      clientId: 'id',
      redirectUri: root,
      storage: store,
      fetch: fetcher,
      now: () => now,
    });
    await client.refresh();
    expect(client.status).toBe('forbidden');
    expect(
      JSON.parse(store.getItem('neoweb.oauth.spotify.tokens')!).refreshToken,
    ).toBe('keep');
    fetcher.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '120' }));
    await client.refresh();
    expect(client.status).toBe('rate-limited');
    expect(client.retryAt).toBe(now + 120_000);
    await client.refresh();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('clears invalid refresh credentials and disconnects without exporting tokens', async () => {
    const store = memory();
    store.setItem(
      'neoweb.oauth.spotify.tokens',
      JSON.stringify({
        accessToken: 'old',
        refreshToken: 'invalid',
        expiresAt: now,
      }),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: 'invalid_grant' }, 400));
    const client = new SpotifyClient({
      clientId: 'id',
      redirectUri: root,
      storage: store,
      fetch: fetcher,
      now: () => now,
    });
    await client.refresh();
    expect(client.status).toBe('expired');
    expect(store.getItem('neoweb.oauth.spotify.tokens')).toBeNull();
    client.disconnect();
    expect(client.status).toBe('disconnected');
  });
});

function calendar() {
  let config: Parameters<GoogleOAuth['initTokenClient']>[0];
  const requestAccessToken = vi.fn();
  const fetcher = vi.fn<typeof fetch>();
  const client = new CalendarClient({
    clientId: 'public-client',
    fetch: fetcher,
    now: () => now,
    getGoogle: () => ({
      initTokenClient: (options) => {
        config = options;
        return { requestAccessToken };
      },
    }),
  });
  return { client, fetcher, requestAccessToken, config: () => config };
}

describe('Calendar read-only client', () => {
  it('requests one read scope from a user action and preserves all-day dates', async () => {
    const app = calendar();
    await app.client.initialize();
    expect(app.requestAccessToken).not.toHaveBeenCalled();
    const connected = app.client.connect();
    expect(app.requestAccessToken).toHaveBeenCalledTimes(1);
    expect(app.config().scope).toBe(
      'https://www.googleapis.com/auth/calendar.events.readonly',
    );
    expect(app.config().include_granted_scopes).toBe(false);
    app.fetcher.mockResolvedValue(
      json({
        items: [
          {
            id: 'day',
            summary: 'Study',
            start: { date: '2026-09-05' },
            htmlLink: 'https://calendar.google.com/event',
          },
        ],
      }),
    );
    app.config().callback({
      access_token: 'token',
      expires_in: 3600,
      scope: app.config().scope,
    });
    await connected;
    expect(app.client.value[0]).toMatchObject({
      title: 'Study',
      start: '2026-09-05',
      allDay: true,
    });
    const url = new URL(String(app.fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.get('orderBy')).toBe('startTime');
    expect(app.client.status).toBe('ready');
  });
  it('handles popup closure and denied scope without querying Calendar', async () => {
    const app = calendar();
    await app.client.initialize();
    let connected = app.client.connect();
    app.config().error_callback({ type: 'popup_closed' });
    await connected;
    expect(app.client.status).toBe('disconnected');
    connected = app.client.connect();
    app.config().callback({
      access_token: 'token',
      expires_in: 3600,
      scope: 'unrelated',
    });
    await connected;
    expect(app.client.status).toBe('forbidden');
    expect(app.fetcher).not.toHaveBeenCalled();
  });
  it('ignores a late authorization callback after disconnect', async () => {
    const app = calendar();
    await app.client.initialize();
    const connected = app.client.connect();
    app.client.disconnect();
    await connected;
    app.config().callback({
      access_token: 'late',
      expires_in: 3600,
      scope: app.config().scope,
    });
    expect(app.client.status).toBe('disconnected');
    expect(app.fetcher).not.toHaveBeenCalled();
  });
  it('requires another user action after expiry and clears data on disconnect', async () => {
    const app = calendar();
    await app.client.initialize();
    const connected = app.client.connect();
    app.fetcher.mockResolvedValue(json({}, 401));
    app.config().callback({
      access_token: 'token',
      expires_in: 3600,
      scope: app.config().scope,
    });
    await connected;
    expect(app.client.status).toBe('expired');
    await app.client.refresh();
    expect(app.requestAccessToken).toHaveBeenCalledTimes(1);
    app.client.disconnect();
    expect(app.client.value).toEqual([]);
    expect(app.client.status).toBe('disconnected');
  });
});
