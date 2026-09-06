'use client';
import { useEffect, useState, useRef } from 'react';
import {
  Timer,
  Play,
  Pause,
  Music2,
  CalendarDays,
  ExternalLink,
  Download,
  Upload,
  RefreshCw,
  Link2,
  Unplug,
  Check,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  startFocus,
  pauseFocus,
  resumeFocus,
  finishFocus,
  exportLearningState,
  importLearningState,
  type LearningStateV1,
} from '@/lib/learning-state';
import { SpotifyClient, CalendarClient } from '@/lib/integrations';
import { bindSpotifySync } from '@/lib/spotify-sync';
import { publicBase, href } from '@/lib/routes';
import type { TopicRecord } from '@/lib/content-schema';
import type { UpdateState } from './dashboard';
const CLIENT_KEY = 'neoweb.integration.clientIds';
function clientIds() {
  try {
    return JSON.parse(localStorage.getItem(CLIENT_KEY) ?? '{}') as {
      spotify?: string;
      google?: string;
    };
  } catch {
    return {};
  }
}
let spotify: SpotifyClient | null = null;
let calendar: CalendarClient | null = null;
function clients() {
  const ids = clientIds();
  spotify ??= new SpotifyClient({
    clientId: ids.spotify ?? '',
    redirectUri: location.origin + publicBase(),
  });
  calendar ??= new CalendarClient({ clientId: ids.google ?? '' });
  return { spotify, calendar };
}
export const initializeIntegrations = () => clients().spotify.finishCallback();
export function FocusCard({
  state,
  update,
  topics,
}: {
  state: LearningStateV1;
  update: UpdateState;
  topics: TopicRecord[];
}) {
  const active = state.activeFocus;
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = active
    ? Math.min(
        active.targetMs,
        active.focusedMs +
          (active.running
            ? Math.max(0, Math.min(15000, tick - active.heartbeatAt))
            : 0),
      )
    : 0;
  const total = active?.targetMs ?? state.preferences.focusMinutes * 60000;
  const remaining = Math.max(0, Math.ceil((total - elapsed) / 1000));
  const percent = (elapsed / total) * 100;
  return (
    <section className="panel focus-card">
      <div className="section-title">
        <h2>
          <Timer size={18} /> Focus session
        </h2>
        <span className="subtle-tag">
          {active?.running ? 'In orbit' : active ? 'Paused' : 'Ready'}
        </span>
      </div>
      <div
        className="focus-dial"
        style={{ '--focus-progress': `${percent}%` } as React.CSSProperties}
      >
        <div>
          <span className="focus-time">
            {Math.floor(remaining / 60)
              .toString()
              .padStart(2, '0')}
            <span>:</span>
            {(remaining % 60).toString().padStart(2, '0')}
          </span>
          <small>
            {active?.running
              ? 'JUST YOU & THE NEXT IDEA'
              : 'SPACE TO CONCENTRATE'}
          </small>
        </div>
      </div>
      <p className="focus-topic">
        {topics.find(
          (t) => t.id === (active?.topicId ?? state.preferences.lastTopicId),
        )?.title ?? 'Choose a topic. Find your flow.'}
      </p>
      <div className="focus-controls">
        <Button
          onClick={() =>
            update((s) =>
              active
                ? active.running
                  ? pauseFocus(s)
                  : resumeFocus(s)
                : startFocus(s, s.preferences.lastTopicId),
            )
          }
        >
          {active?.running ? <Pause /> : <Play />}
          {active?.running ? 'Pause focus' : active ? 'Resume' : 'Start focus'}
        </Button>
        {active && (
          <Button
            variant="outline"
            size="icon"
            aria-label="Finish focus session"
            onClick={() => update((s) => finishFocus(s))}
          >
            <Check />
          </Button>
        )}
      </div>
      <p className="fine-print">
        {state.preferences.focusMinutes} minute sessions · Adjust in settings
      </p>
    </section>
  );
}
export function IntegrationCards() {
  const [, render] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const pair = clients();
    let alive = true;
    const refresh = () => {
      if (alive) render((n) => n + 1);
    };
    const unsubscribe = pair.spotify.subscribe(refresh);
    let stopSync = () => {};
    void pair.spotify.finishCallback().then(() => {
      if (alive) stopSync = bindSpotifySync(pair.spotify);
      refresh();
    });
    void pair.calendar.initialize().then(refresh);
    setReady(true);
    return () => {
      alive = false;
      stopSync();
      unsubscribe();
    };
  }, []);
  if (!ready)
    return (
      <>
        <section className="panel">
          <h2>Study soundtrack</h2>
          <p className="empty-copy">Connect Spotify in settings.</p>
        </section>
        <section className="panel">
          <h2>Your calendar</h2>
          <p className="empty-copy">Connect Calendar in settings.</p>
        </section>
      </>
    );
  const pair = clients();
  const refresh = () => render((n) => n + 1);
  const sp = pair.spotify;
  const cal = pair.calendar;
  const toggleCommand = sp.value?.isPlaying ? 'pause' : 'play';
  const offline = !navigator.onLine;
  const action = (operation: () => Promise<void>) => {
    const result = operation();
    refresh();
    void result.finally(refresh);
  };
  return (
    <>
      <section className="panel music-card">
        <div className="section-title">
          <h2>
            <Music2 size={19} /> Study soundtrack
          </h2>
          <span className="spotify-word">Spotify</span>
        </div>
        {sp.value ? (
          <div className="now-playing">
            {sp.value.albumArt && (
              <img src={sp.value.albumArt} alt="" width={52} height={52} />
            )}
            <div>
              <strong>{sp.value.title}</strong>
              <p>{sp.value.artists}</p>
              <small>{sp.value.isPlaying ? 'Now playing' : 'Paused'}</small>
            </div>
            <a
              href={sp.value.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in Spotify"
            >
              <ExternalLink size={16} />
            </a>
          </div>
        ) : (
          <>
            <p>Give your next discovery a soundtrack.</p>
            {sp.status === 'empty' && (
              <p className="fine-print">Nothing is playing right now.</p>
            )}
          </>
        )}
        {sp.connected && (
          <>
            <div
              className="spotify-controls"
              role="group"
              aria-label="Spotify playback controls"
              aria-busy={sp.pendingCommand !== null}
            >
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous track"
                title={sp.controlReason('previous') ?? 'Previous track'}
                disabled={offline || !!sp.controlReason('previous')}
                onClick={() => void sp.previous()}
              >
                <SkipBack />
              </Button>
              <Button
                size="icon"
                aria-label={
                  sp.value?.isPlaying ? 'Pause Spotify' : 'Play Spotify'
                }
                title={
                  sp.controlReason(toggleCommand) ??
                  (sp.value?.isPlaying ? 'Pause Spotify' : 'Play Spotify')
                }
                disabled={offline || !!sp.controlReason(toggleCommand)}
                onClick={() => void sp[toggleCommand]()}
              >
                {sp.value?.isPlaying ? <Pause /> : <Play />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next track"
                title={sp.controlReason('next') ?? 'Next track'}
                disabled={offline || !!sp.controlReason('next')}
                onClick={() => void sp.next()}
              >
                <SkipForward />
              </Button>
            </div>
            <p className="fine-print spotify-device">
              {sp.device?.name
                ? `Device: ${sp.device.name}`
                : 'Open Spotify and start playing on a device first.'}
              {sp.device?.restricted &&
                ' · Remote controls unavailable on this device.'}
            </p>
            <p
              className="fine-print spotify-sync"
              role="status"
              aria-live="polite"
            >
              {sp.pendingCommand
                ? 'Sending command to Spotify…'
                : offline
                  ? 'Offline · Showing last known playback'
                  : sp.stale
                    ? 'Out of date · Showing last known playback'
                    : sp.lastSyncedAt
                      ? `Synced ${new Date(sp.lastSyncedAt).toLocaleTimeString()}`
                      : 'Waiting for playback information'}
            </p>
            {!sp.canControl && (
              <Button
                variant="outline"
                disabled={offline || sp.status === 'connecting'}
                onClick={() => action(() => sp.connect())}
              >
                Reconnect to enable controls
              </Button>
            )}
          </>
        )}
        {sp.error && (
          <p className="widget-error" role="status">
            {sp.error}
          </p>
        )}
        <div className="widget-actions">
          {sp.status === 'unconfigured' ? (
            <a className="text-link" href={href({ view: 'settings' })}>
              Set up Spotify <Link2 size={13} />
            </a>
          ) : ['disconnected', 'expired', 'forbidden'].includes(sp.status) ? (
            <Button
              variant="outline"
              disabled={offline}
              onClick={() => action(() => sp.connect())}
            >
              {sp.connected ? 'Reconnect Spotify' : 'Connect Spotify'}
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={
                offline ||
                sp.syncing ||
                !!sp.pendingCommand ||
                sp.status === 'connecting' ||
                sp.retryAt > Date.now()
              }
              onClick={() => action(() => sp.refresh())}
            >
              <RefreshCw /> Refresh
            </Button>
          )}
          {sp.connected && !Number.isFinite(sp.retryAt) && (
            <Button
              variant="outline"
              disabled={offline}
              onClick={() => action(() => sp.connect())}
            >
              Reconnect Spotify
            </Button>
          )}
          {sp.connected && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Disconnect Spotify"
              onClick={() => {
                sp.disconnect();
                refresh();
              }}
            >
              <Unplug />
            </Button>
          )}
        </div>
      </section>
      <section className="panel calendar-card">
        <div className="section-title">
          <h2>
            <CalendarDays size={18} /> On your horizon
          </h2>
          <span className="subtle-tag">Agenda</span>
        </div>
        {cal.value.length ? (
          <div className="agenda-list">
            {cal.value.slice(0, 5).map((event) => (
              <a
                key={event.id}
                aria-label={event.title}
                href={event.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="agenda-line" />
                <div>
                  <strong>{event.title}</strong>
                  <small>
                    {event.allDay
                      ? `${event.start} · All day`
                      : new Date(event.start).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                  </small>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p>
            {cal.status === 'empty'
              ? 'A clear horizon. No upcoming events.'
              : 'Bring your learning time into view with your Google Calendar.'}
          </p>
        )}
        {cal.error && (
          <p className="widget-error" role="status">
            {cal.error}
          </p>
        )}
        <div className="widget-actions">
          {cal.status === 'unconfigured' ? (
            <a className="text-link" href={href({ view: 'settings' })}>
              Set up Calendar <Link2 size={13} />
            </a>
          ) : ['ready', 'empty', 'rate-limited'].includes(cal.status) ? (
            <Button
              variant="ghost"
              disabled={cal.retryAt > Date.now()}
              onClick={() => action(() => cal.refresh())}
            >
              <RefreshCw />
              Refresh
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={cal.status === 'connecting'}
              onClick={() => action(() => cal.connect())}
            >
              Connect Calendar
            </Button>
          )}
          {cal.value.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Disconnect Google Calendar"
              onClick={() => {
                cal.disconnect();
                refresh();
              }}
            >
              <Unplug />
            </Button>
          )}
        </div>
      </section>
    </>
  );
}
export function SettingsView({
  state,
  update,
}: {
  state: LearningStateV1;
  update: UpdateState;
}) {
  const [ids, setIds] = useState<{ spotify?: string; google?: string }>({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<LearningStateV1 | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setIds(clientIds()), []);
  const backup = () => {
    const blob = new Blob([exportLearningState(state)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neolearning-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PERSONAL WORKSPACE</span>
          <h1>Set your own orbit.</h1>
          <p>
            Your preferences, progress, and practice drafts stay on this device.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <h2>Learning & focus</h2>
          <label className="field-label">
            Weekly target (minutes)
            <Input
              type="number"
              min="1"
              max="10080"
              placeholder="Choose a personal target"
              value={state.weeklyTargetMinutes ?? ''}
              onChange={(e) =>
                update((s) => ({
                  ...s,
                  weeklyTargetMinutes: e.target.value
                    ? Math.max(1, Math.min(10080, Number(e.target.value)))
                    : null,
                }))
              }
            />
          </label>
          <label className="field-label">
            Focus session (minutes)
            <Input
              type="number"
              min="1"
              max="240"
              value={state.preferences.focusMinutes}
              onChange={(e) =>
                update((s) => ({
                  ...s,
                  preferences: {
                    ...s.preferences,
                    focusMinutes: Math.max(
                      1,
                      Math.min(240, Number(e.target.value)),
                    ),
                  },
                }))
              }
            />
          </label>
          <label className="switch-label">
            <span>
              Reduce motion<small>Keep the interface calm and still.</small>
            </span>
            <Switch
              checked={state.preferences.reducedMotion}
              onCheckedChange={(value) =>
                update((s) => ({
                  ...s,
                  preferences: { ...s.preferences, reducedMotion: value },
                }))
              }
            />
          </label>
        </section>
        <section className="panel">
          <h2>Progress & backups</h2>
          <p>
            Export your topics, review history, focus sessions, and code drafts.
            Connections and OAuth tokens are excluded.
          </p>
          <div className="button-row">
            <Button onClick={backup}>
              <Download /> Export backup
            </Button>
            <Button variant="outline" onClick={() => file.current?.click()}>
              <Upload /> Import backup
            </Button>
          </div>
          <input
            ref={file}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const value = e.target.files?.[0];
              if (!value) return;
              try {
                if (value.size > 10 * 1024 * 1024)
                  throw new Error('Backup must be smaller than 10 MB.');
                setPending(importLearningState(await value.text()));
              } catch (error) {
                setMessage(`Could not import: ${String(error)}`);
              }
              e.target.value = '';
            }}
          />
          <p className="fine-print">
            No automatic device sync. Keep a backup before changing browsers.
          </p>
        </section>
        <section className="panel">
          <h2>Spotify connection</h2>
          <p>
            Enter your public Spotify application client ID. Your app uses PKCE
            with read access and remote playback controls for Spotify Premium.
          </p>
          <label className="field-label">
            Client ID
            <Input
              value={ids.spotify ?? ''}
              onChange={(e) =>
                setIds((x) => ({ ...x, spotify: e.target.value.trim() }))
              }
              autoComplete="off"
            />
          </label>
          <label className="field-label">
            Register this redirect URI
            <code className="setting-code">
              {typeof location === 'undefined'
                ? ''
                : location.origin + publicBase()}
            </code>
          </label>
          <p className="fine-print">
            Your Spotify developer app must allow your account. No client secret
            is needed.
          </p>
        </section>
        <section className="panel">
          <h2>Google Calendar connection</h2>
          <p>
            Enable Calendar API, create a web OAuth client, and add this site’s
            origin to its allowed JavaScript origins.
          </p>
          <label className="field-label">
            Client ID
            <Input
              value={ids.google ?? ''}
              onChange={(e) =>
                setIds((x) => ({ ...x, google: e.target.value.trim() }))
              }
              autoComplete="off"
            />
          </label>
          <label className="field-label">
            Authorized JavaScript origin
            <code className="setting-code">
              {typeof location === 'undefined' ? '' : location.origin}
            </code>
          </label>
          <p className="fine-print">
            Read-only agenda. A reconnect may be needed when access expires.
          </p>
        </section>
      </div>
      <div className="button-row">
        <Button
          onClick={() => {
            try {
              localStorage.setItem(CLIENT_KEY, JSON.stringify(ids));
              spotify?.disconnect();
              calendar?.disconnect();
              spotify = null;
              calendar = null;
              setMessage(
                'Connection settings saved. Connect from Mission control.',
              );
            } catch {
              setMessage('Your browser could not save these settings.');
            }
          }}
        >
          Save connection settings
        </Button>
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Replace this device’s learning data?</DialogTitle>
          <DialogDescription>
            The imported backup contains{' '}
            {pending?.drafts ? Object.keys(pending.drafts).length : 0} drafts
            and {pending?.sessions.length ?? 0} focus sessions. Export the
            current data first if you want to keep it.
          </DialogDescription>
          <Button variant="outline" onClick={backup}>
            Export current backup
          </Button>
          <Button
            onClick={() => {
              if (pending) {
                update(() => pending);
                setPending(null);
                setMessage('Backup imported.');
              }
            }}
          >
            Replace with imported backup
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
