import { slug } from './markdown';
import type { TopicRecord } from '../../lib/content-schema';
import mapping from '../../content/topic-map.json';

export function curated(file: string): boolean {
  const parts = file.split('/');
  if (
    parts.some(
      (p) =>
        p.startsWith('.') ||
        [
          'node_modules',
          'build',
          'dist',
          '03_resources',
          'resources',
          'portable',
          'third_party',
          'vendor',
          'freertos-kernel',
          'managed_components',
        ].includes(p.toLowerCase()),
    )
  )
    return false;
  if (file.includes('/01_learning/02_documentation/')) return false;
  return (
    file === 'Embedded-Engineering-Roadmap.md' ||
    /^(?:0[1-7]_[^/]+|Examples)\//.test(file)
  );
}
export function textFile(file: string): boolean {
  return (
    curated(file) &&
    /\.(?:md|c|cpp|cc|cxx|h|hpp|py|rs|js|ts|sh|cmake)$/i.test(file)
  );
}
export function imageFile(file: string): boolean {
  return curated(file) && /\.(?:png|jpe?g|webp|gif|avif)$/i.test(file);
}
export function assignTopic(
  file: string,
  topics: TopicRecord[],
): string | null {
  const keys = new Set(topics.map((t) => t.id));
  for (const key of Object.keys(mapping.groups))
    if (!keys.has(key))
      throw new Error(`Topic mapping ${key} is not in the roadmap.`);
  // Examples mirror numbered curriculum paths inside platform roots.
  const embedded = file.match(/(?:^|\/)((?:0[1-5]_[^/]+)\/.+)$/)?.[1] ?? file;
  const candidates = Object.entries(mapping.groups)
    .flatMap(([id, prefixes]) => prefixes.map((prefix) => ({ id, prefix })))
    .filter(({ prefix }) =>
      [file, embedded].some((p) => p === prefix || p.startsWith(prefix + '/')),
    )
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const group = candidates[0]?.id;
  if (!group) return null;
  const descendants = topics.filter((t) => {
    let p: TopicRecord | undefined = t;
    while (p) {
      if (p.id === group) return true;
      p = topics.find((x) => x.id === p!.parentId);
    }
    return false;
  });
  const segments = embedded.split('/').map((s) => slug(s.replace(/^\d+_/, '')));
  let best = group;
  let score = -1;
  for (const topic of descendants) {
    const alias = (mapping.aliases as Record<string, string[]>)[topic.id] ?? [];
    const names = [
      topic.id,
      ...alias,
      slug(topic.title.replace(/\s*\([^)]*\)/g, '')),
    ];
    const index = segments.findLastIndex((s) => names.includes(s));
    if (index > score) {
      score = index;
      best = topic.id;
    }
  }
  return best;
}
