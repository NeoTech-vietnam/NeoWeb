import type { SpotifyClient } from './integrations';

/** Only the mounted, visible, online dashboard owns the polling lifecycle. */
export function bindSpotifySync(
  client: SpotifyClient,
  page: Pick<
    Document,
    'visibilityState' | 'addEventListener' | 'removeEventListener'
  > = document,
  browser: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  network: Pick<Navigator, 'onLine'> = navigator,
): () => void {
  const update = () =>
    client.setSyncActive(page.visibilityState === 'visible' && network.onLine);
  page.addEventListener('visibilitychange', update);
  browser.addEventListener('online', update);
  browser.addEventListener('offline', update);
  update();
  return () => {
    page.removeEventListener('visibilitychange', update);
    browser.removeEventListener('online', update);
    browser.removeEventListener('offline', update);
    client.setSyncActive(false);
  };
}
