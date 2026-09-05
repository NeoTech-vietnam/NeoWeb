import { z } from 'zod';

export type IntegrationStatus =
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'empty'
  | 'expired'
  | 'forbidden'
  | 'rate-limited'
  | 'error';
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface NowPlaying {
  title: string;
  artists: string;
  albumArt?: string;
  url: string;
  isPlaying: boolean;
}
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
  url?: string;
}
const fallbackValues = new Map<string, string>();
const fallbackStorage: StorageLike = {
  getItem: (key) => fallbackValues.get(key) ?? null,
  setItem: (key, value) => {
    fallbackValues.set(key, value);
  },
  removeItem: (key) => {
    fallbackValues.delete(key);
  },
};
function sessionStorage(): StorageLike {
  try {
    return typeof window === 'undefined'
      ? fallbackStorage
      : window.sessionStorage;
  } catch {
    return fallbackStorage;
  }
}
const SPOTIFY_TOKEN_KEY = 'neoweb.oauth.spotify.tokens';
const SPOTIFY_PENDING_KEY = 'neoweb.oauth.spotify.pending';
const SPOTIFY_SCOPE = 'user-read-currently-playing user-read-playback-state';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const tokensSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    expiresAt: z.number(),
  })
  .strict();
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive().max(86_400),
  scope: z.string().optional(),
});
const pendingSchema = z
  .object({
    verifier: z.string().min(43).max(128),
    state: z.string().min(20),
    createdAt: z.number(),
    redirectUri: z.string(),
    returnHash: z.string(),
  })
  .strict();
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
const safeUrl = (value: unknown): string | undefined => {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const string = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;
const retryAt = (response: Response, now: number) => {
  const header = response.headers.get('Retry-After');
  if (!header) return now + 60_000;
  const seconds = Number(header);
  return Number.isFinite(seconds)
    ? now + Math.max(1, seconds) * 1000
    : Math.max(now + 1000, Date.parse(header) || now + 60_000);
};

export interface SpotifyOptions {
  clientId: string;
  redirectUri: string;
  storage?: StorageLike;
  fetch?: typeof fetch;
  now?: () => number;
  crypto?: Crypto;
  getUrl?: () => string;
  replaceUrl?: (url: string) => void;
  navigate?: (url: string) => void;
}

export class SpotifyClient {
  status: IntegrationStatus;
  error: string | null = null;
  value: NowPlaying | null = null;
  retryAt = 0;
  private tokens: z.infer<typeof tokensSchema> | null = null;
  private storage: StorageLike;
  private generation = 0;
  private fetcher: typeof fetch;
  private now: () => number;
  private callbackTask: Promise<boolean> | undefined;
  private refreshTask: Promise<boolean> | undefined;

  constructor(private options: SpotifyOptions) {
    this.status = options.clientId ? 'disconnected' : 'unconfigured';
    this.storage = options.storage ?? sessionStorage();
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    try {
      const saved = this.storage.getItem(SPOTIFY_TOKEN_KEY);
      if (saved) {
        this.tokens = tokensSchema.parse(JSON.parse(saved));
        if (options.clientId) this.status = 'ready';
      }
    } catch {
      this.error = 'The saved Spotify connection could not be loaded.';
    }
  }

  async connect(): Promise<void> {
    if (!this.options.clientId) return;
    this.generation++;
    this.status = 'connecting';
    this.error = null;
    try {
      const crypto = this.options.crypto ?? globalThis.crypto;
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
      const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = base64url(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(verifier),
          ),
        ),
      );
      const current = new URL(this.options.getUrl?.() ?? window.location.href);
      const redirect = new URL(this.options.redirectUri);
      if (
        redirect.origin !== current.origin ||
        redirect.hash ||
        redirect.search
      )
        throw new Error(
          'Spotify callback must use this site origin without a query or hash.',
        );
      if (
        redirect.protocol !== 'https:' &&
        !(
          redirect.protocol === 'http:' &&
          ['127.0.0.1', '[::1]'].includes(redirect.hostname)
        )
      )
        throw new Error('Spotify requires HTTPS or an explicit loopback IP.');
      this.storage.setItem(
        SPOTIFY_PENDING_KEY,
        JSON.stringify({
          verifier,
          state,
          createdAt: this.now(),
          redirectUri: redirect.href,
          returnHash: current.hash,
        }),
      );
      const url = new URL('https://accounts.spotify.com/authorize');
      url.search = new URLSearchParams({
        client_id: this.options.clientId,
        response_type: 'code',
        scope: SPOTIFY_SCOPE,
        redirect_uri: redirect.href,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
      }).toString();
      (this.options.navigate ?? ((href) => window.location.assign(href)))(
        url.href,
      );
    } catch (error) {
      this.fail(error);
    }
  }

  finishCallback(): Promise<boolean> {
    return (this.callbackTask ??= this.processCallback());
  }

  private async processCallback(): Promise<boolean> {
    const generation = this.generation;
    const current = new URL(this.options.getUrl?.() ?? window.location.href);
    if (!current.searchParams.has('code') && !current.searchParams.has('error'))
      return false;
    try {
      const raw = this.storage.getItem(SPOTIFY_PENDING_KEY);
      let stored: unknown = null;
      try {
        stored = raw ? JSON.parse(raw) : null;
      } catch {
        /* Invalid saved authorization is rejected below. */
      }
      const parsed = pendingSchema.safeParse(stored);
      const pending = parsed.success ? parsed.data : null;
      const code = current.searchParams.get('code');
      const returnedState = current.searchParams.get('state');
      const error = current.searchParams.get('error');
      for (const key of ['code', 'state', 'error', 'error_description'])
        current.searchParams.delete(key);
      if (pending?.returnHash.startsWith('#'))
        current.hash = pending.returnHash;
      (
        this.options.replaceUrl ??
        ((url) => window.history.replaceState(null, '', url))
      )(current.href);
      this.storage.removeItem(SPOTIFY_PENDING_KEY);
      const redirect = new URL(this.options.redirectUri);
      if (
        !pending ||
        pending.state !== returnedState ||
        pending.redirectUri !== redirect.href ||
        current.origin !== redirect.origin ||
        current.pathname !== redirect.pathname ||
        this.now() - pending.createdAt < 0 ||
        this.now() - pending.createdAt > 600_000
      ) {
        this.status = 'expired';
        this.error =
          'Spotify sign-in expired or could not be verified. Connect again.';
        return true;
      }
      if (error) {
        this.status = 'disconnected';
        this.error = 'Spotify connection was not authorized.';
        return true;
      }
      if (!code)
        throw new Error('Spotify did not return an authorization code.');
      const response = await this.fetcher(
        'https://accounts.spotify.com/api/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.options.clientId,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirect.href,
            code_verifier: pending.verifier,
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          'Spotify sign-in could not be completed. Connect again.',
        );
      const tokens = tokenResponseSchema.parse(await response.json());
      if (generation !== this.generation) return true;
      this.saveTokens(tokens);
      await this.refresh();
    } catch (error) {
      this.fail(error);
    }
    return true;
  }

  private saveTokens(response: z.infer<typeof tokenResponseSchema>): void {
    this.tokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? this.tokens?.refreshToken,
      expiresAt: this.now() + response.expires_in * 1000,
    };
    this.storage.setItem(SPOTIFY_TOKEN_KEY, JSON.stringify(this.tokens));
  }

  private async refreshToken(): Promise<boolean> {
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = this.performRefreshToken();
    try {
      return await this.refreshTask;
    } finally {
      this.refreshTask = undefined;
    }
  }

  private async performRefreshToken(): Promise<boolean> {
    const generation = this.generation;
    if (!this.tokens?.refreshToken) {
      this.status = 'expired';
      this.error = 'Reconnect Spotify to continue.';
      return false;
    }
    const response = await this.fetcher(
      'https://accounts.spotify.com/api/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.options.clientId,
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
        }),
      },
    );
    const body: unknown = await response.json();
    if (generation !== this.generation) return false;
    if (!response.ok) {
      if (object(body).error === 'invalid_grant') {
        this.disconnect();
        this.status = 'expired';
        this.error = 'Spotify authorization expired. Connect again.';
        return false;
      }
      throw new Error('Spotify could not refresh the connection.');
    }
    this.saveTokens(tokenResponseSchema.parse(body));
    return true;
  }

  async refresh(): Promise<void> {
    const generation = this.generation;
    if (!this.options.clientId) return;
    if (!this.tokens) {
      this.status = 'disconnected';
      return;
    }
    if (this.now() < this.retryAt) {
      this.status = 'rate-limited';
      return;
    }
    try {
      if (
        this.tokens.expiresAt <= this.now() + 30_000 &&
        !(await this.refreshToken())
      )
        return;
      if (generation !== this.generation) return;
      const request = () =>
        this.fetcher(
          'https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode',
          {
            headers: { Authorization: 'Bearer ' + this.tokens!.accessToken },
          },
        );
      let response = await request();
      if (generation !== this.generation) return;
      if (response.status === 401) {
        if (!(await this.refreshToken()) || generation !== this.generation)
          return;
        response = await request();
        if (generation !== this.generation) return;
      }
      this.error = null;
      if (response.status === 401) {
        this.status = 'expired';
        this.error = 'Reconnect Spotify to continue.';
        return;
      }
      if (response.status === 403) {
        this.status = 'forbidden';
        this.error =
          'Spotify restricted this account or app. Check app allowlist and owner subscription.';
        return;
      }
      if (response.status === 429) {
        this.status = 'rate-limited';
        this.retryAt = retryAt(response, this.now());
        this.error = 'Spotify request limit reached. Try again later.';
        return;
      }
      if (response.status === 204) {
        this.value = null;
        this.status = 'empty';
        return;
      }
      if (!response.ok) throw new Error('Spotify is temporarily unavailable.');
      const body = object(await response.json());
      if (generation !== this.generation) return;
      const item = object(body.item);
      if (!item.name) {
        this.value = null;
        this.status = 'empty';
        return;
      }
      const album = object(item.album);
      const images = Array.isArray(album.images)
        ? album.images
        : Array.isArray(item.images)
          ? item.images
          : [];
      const artists = Array.isArray(item.artists)
        ? item.artists
            .map((artist) => string(object(artist).name))
            .filter(Boolean)
            .join(', ')
        : string(object(item.show).publisher);
      const link = safeUrl(object(item.external_urls).spotify);
      this.value = {
        title: string(item.name),
        artists,
        albumArt: safeUrl(object(images[0]).url),
        url: link?.startsWith('https://open.spotify.com/')
          ? link
          : 'https://open.spotify.com/',
        isPlaying: body.is_playing === true,
      };
      this.status = 'ready';
    } catch (error) {
      this.fail(error);
    }
  }

  disconnect(): void {
    this.generation++;
    this.tokens = null;
    this.value = null;
    this.retryAt = 0;
    this.error = null;
    this.storage.removeItem(SPOTIFY_TOKEN_KEY);
    this.storage.removeItem(SPOTIFY_PENDING_KEY);
    this.status = this.options.clientId ? 'disconnected' : 'unconfigured';
  }

  private fail(error: unknown): void {
    this.status = 'error';
    this.error =
      error instanceof Error ? error.message : 'Spotify could not connect.';
  }
}

export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}
export interface GoogleOAuth {
  initTokenClient(options: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: GoogleTokenResponse) => void;
    error_callback: (error: { type: string }) => void;
  }): { requestAccessToken(options?: { prompt?: string }): void };
}
export interface CalendarOptions {
  clientId: string;
  fetch?: typeof fetch;
  now?: () => number;
  getGoogle?: () => GoogleOAuth | undefined;
  loadScript?: () => Promise<void>;
}
let googleScript: Promise<void> | undefined;
function loadGoogleScript(): Promise<void> {
  return (googleScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScript = undefined;
      script.remove();
      reject(new Error('Google sign-in could not load.'));
    };
    document.head.appendChild(script);
  }));
}

export class CalendarClient {
  status: IntegrationStatus;
  error: string | null = null;
  value: CalendarEvent[] = [];
  retryAt = 0;
  private token: { value: string; expiresAt: number } | null = null;
  private client: ReturnType<GoogleOAuth['initTokenClient']> | undefined;
  private resolveConnect: (() => void) | undefined;
  private generation = 0;
  private fetcher: typeof fetch;
  private now: () => number;

  constructor(private options: CalendarOptions) {
    this.status = options.clientId ? 'disconnected' : 'unconfigured';
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  // Call on widget mount so Connect can request a popup synchronously from its click.
  async initialize(): Promise<void> {
    if (!this.options.clientId || this.client) return;
    try {
      const readGoogle =
        this.options.getGoogle ??
        (() =>
          (
            window as unknown as {
              google?: { accounts?: { oauth2?: GoogleOAuth } };
            }
          ).google?.accounts?.oauth2);
      if (!readGoogle()) await (this.options.loadScript ?? loadGoogleScript)();
      const oauth = readGoogle();
      if (!oauth) throw new Error('Google sign-in is unavailable.');
      this.client = oauth.initTokenClient({
        client_id: this.options.clientId,
        scope: GOOGLE_SCOPE,
        include_granted_scopes: false,
        callback: (response) => {
          if (!this.resolveConnect) return;
          void (async () => {
            try {
              if (response.error || !response.access_token) {
                this.status = 'disconnected';
                this.error = 'Calendar connection was not authorized.';
                return;
              }
              if (!response.scope?.split(/\s+/).includes(GOOGLE_SCOPE)) {
                this.status = 'forbidden';
                this.error = 'Calendar read permission was not granted.';
                return;
              }
              const expiresIn = Number(response.expires_in);
              if (!Number.isFinite(expiresIn) || expiresIn <= 0)
                throw new Error('Google returned an invalid token expiry.');
              this.token = {
                value: response.access_token,
                expiresAt: this.now() + expiresIn * 1000,
              };
              await this.refresh();
            } catch (error) {
              this.fail(error);
            } finally {
              this.resolveConnect?.();
              this.resolveConnect = undefined;
            }
          })();
        },
        error_callback: (error) => {
          this.status = 'disconnected';
          this.error =
            error.type === 'popup_closed'
              ? 'Google sign-in was closed.'
              : 'Google sign-in popup could not open.';
          this.resolveConnect?.();
          this.resolveConnect = undefined;
        },
      });
    } catch (error) {
      this.fail(error);
    }
  }

  connect(): Promise<void> {
    if (!this.options.clientId) return Promise.resolve();
    if (!this.client) {
      this.error = 'Google sign-in is still loading. Try again.';
      return Promise.resolve();
    }
    if (this.resolveConnect) return Promise.resolve();
    this.generation++;
    this.status = 'connecting';
    this.error = null;
    return new Promise((resolve) => {
      this.resolveConnect = resolve;
      try {
        this.client!.requestAccessToken({ prompt: '' });
      } catch (error) {
        this.fail(error);
        this.resolveConnect = undefined;
        resolve();
      }
    });
  }

  async refresh(): Promise<void> {
    const generation = this.generation;
    if (!this.options.clientId) return;
    if (!this.token || this.token.expiresAt <= this.now() + 30_000) {
      this.token = null;
      this.status = 'expired';
      this.error = 'Connect Calendar to refresh your agenda.';
      return;
    }
    if (this.now() < this.retryAt) {
      this.status = 'rate-limited';
      return;
    }
    try {
      const url = new URL(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      );
      url.search = new URLSearchParams({
        timeMin: new Date(this.now()).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '10',
        showDeleted: 'false',
      }).toString();
      const response = await this.fetcher(url.href, {
        headers: { Authorization: 'Bearer ' + this.token.value },
      });
      if (generation !== this.generation) return;
      this.error = null;
      if (response.status === 401) {
        this.token = null;
        this.status = 'expired';
        this.error = 'Reconnect Calendar to refresh your agenda.';
        return;
      }
      if (response.status === 403) {
        this.status = 'forbidden';
        this.error = 'Calendar access is restricted or its API is not enabled.';
        return;
      }
      if (response.status === 429) {
        this.status = 'rate-limited';
        this.retryAt = retryAt(response, this.now());
        this.error = 'Calendar request limit reached. Try again later.';
        return;
      }
      if (!response.ok) throw new Error('Calendar is temporarily unavailable.');
      const body = object(await response.json());
      if (generation !== this.generation) return;
      this.value = (Array.isArray(body.items) ? body.items : []).flatMap(
        (raw) => {
          const event = object(raw);
          const start = object(event.start);
          if (event.status === 'cancelled') return [];
          const at = string(start.dateTime || start.date);
          const allDay = !start.dateTime;
          if (
            !at ||
            (allDay
              ? !/^\d{4}-\d{2}-\d{2}$/.test(at)
              : !Number.isFinite(Date.parse(at)))
          )
            return [];
          return [
            {
              id: string(event.id, at),
              title: string(event.summary, 'Untitled event'),
              start: at,
              allDay,
              url: safeUrl(event.htmlLink),
            },
          ];
        },
      );
      this.status = this.value.length ? 'ready' : 'empty';
    } catch (error) {
      this.fail(error);
    }
  }

  disconnect(): void {
    this.generation++;
    this.token = null;
    this.value = [];
    this.error = null;
    this.retryAt = 0;
    this.status = this.options.clientId ? 'disconnected' : 'unconfigured';
    this.resolveConnect?.();
    this.resolveConnect = undefined;
  }

  private fail(error: unknown): void {
    this.status = 'error';
    this.error =
      error instanceof Error ? error.message : 'Calendar could not connect.';
  }
}
