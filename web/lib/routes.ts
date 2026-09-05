export type View =
  | 'dashboard'
  | 'topics'
  | 'topic'
  | 'library'
  | 'document'
  | 'practice'
  | 'versions'
  | 'settings';
export interface Route {
  view: View;
  snapshot?: string;
  path?: string;
  topic?: string;
  exercise?: string;
  anchor?: string;
}
export function href(route: Route): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(route))
    if (key !== 'view' && value) params.set(key, value);
  return `#/${route.view}${params.size ? `?${params}` : ''}`;
}
export function parseRoute(hash: string): Route {
  const [pathname, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const allowed = [
    'dashboard',
    'topics',
    'topic',
    'library',
    'document',
    'practice',
    'versions',
    'settings',
  ];
  const p = new URLSearchParams(query);
  return {
    view: (allowed.includes(pathname) ? pathname : 'dashboard') as View,
    snapshot: p.get('snapshot') ?? undefined,
    path: p.get('path') ?? undefined,
    topic: p.get('topic') ?? undefined,
    exercise: p.get('exercise') ?? undefined,
    anchor: p.get('anchor') ?? undefined,
  };
}
export function publicBase(): string {
  if (typeof document === 'undefined') return '/';
  return new URL('.', location.href).pathname;
}
export function dataUrl(path: string): string {
  return `${publicBase()}content/${path}`;
}
