# Study soundtrack: playback and automatic sync

This approved update replaces Spotify's original read-only limitation. Google Calendar and all
learning features are unchanged. Tokens remain device-local and excluded from learning exports.

## Controls and permission

- Keep the dashboard card, artwork, attribution, and Open in Spotify link.
- Previous, Play/Pause, and Next operate on the active Spotify device, with accessible labels,
  confirmed playback state, pending feedback, and device/action restriction checks.
- PKCE requests both existing read scopes plus `user-modify-playback-state`; no secret or server.
- Legacy tokens without scope metadata stay readable and require explicit reconnection for controls.
  Granted scopes survive refresh when Spotify omits its scope field.
- One command at a time; reads and commands never overlap. Failed commands are not replayed.
- A successful command schedules confirmation reads after one and three seconds while sync is active.

## Synchronization

- `GET /me/player` supplies track, paused state, active device, and restrictions together.
- Start immediately when a connected dashboard opens; poll five seconds after a playing read
  completes, fifteen seconds after a paused/idle read completes.
- Stop timers when hidden, offline, unmounted, or disconnected. Resume when visible and online.
- Polling, Refresh, and command confirmation share one coordinator. Obsolete responses cannot
  overwrite a newer command, disconnected state, or a resumed lifecycle.
- Preserve last-known track and last successful sync time on failures; label stale information.
- Back off transient reads for 15, 30, then 60 seconds. Honor Retry-After across all operations.
- Stop automatic retries for authorization/forbidden responses and quota limits without a deadline.

## Validation and smoke test

Mocked tests cover the four endpoints, legacy/scoped tokens, restrictions, idle/paused state,
command serialization, stale reads, polling cadence, backoff, visibility/network changes,
unmount cleanup, rate limits, and authorization failures. Run the complete tests, TypeScript
check, and Pages-base static export before publishing through the current Pages workflow.

For the real-account smoke test, reconnect a Premium account and start playback in Spotify.
Change tracks there and confirm NeoWeb updates without Refresh. Use Previous, Pause, Play,
and Next in NeoWeb; verify the active device responds and the card confirms each change.
Test keyboard activation, pending feedback, and narrow/zoomed layout. Hide the tab and return;
playback should continue while polling pauses and resumes. This test requires user authorization
and cannot be established by mocked tests alone.

## Boundaries

No browser audio SDK, mini-player, device transfer, volume, seek, shuffle, repeat, or playlist
editing. Synchronization is near-real-time polling, not an instantaneous push stream.

## References

- [Spotify Player API](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)
- [Playback state](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback)
- [Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
