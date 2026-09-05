'use client';
import { useEffect, useState } from 'react';
import {
  CatalogSchema,
  SnapshotSchema,
  BlobSchema,
  type Catalog,
  type SnapshotManifest,
  type ContentBlob,
} from '@/lib/content-schema';
import { dataUrl } from '@/lib/routes';
const cache = new Map<string, unknown>();
async function json(url: string) {
  if (cache.has(url)) return cache.get(url);
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `Content could not be loaded (${response.status}). Run the content build or select a published version.`,
    );
  const value = await response.json();
  cache.set(url, value);
  return value;
}
export function useCatalog() {
  const [value, setValue] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    json(dataUrl('catalog.json'))
      .then((v) => setValue(CatalogSchema.parse(v)))
      .catch((e) => setError(String(e)));
  }, []);
  return { value, error };
}
export function useSnapshot(sha?: string) {
  const [value, setValue] = useState<SnapshotManifest | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setValue(null);
    setError('');
    if (sha && !/^[a-f0-9]{40}$/.test(sha))
      setError(
        'This snapshot identifier is invalid. Choose a published version.',
      );
    if (sha && /^[a-f0-9]{40}$/.test(sha))
      json(dataUrl(`snapshots/${sha}.json`))
        .then((v) => {
          if (alive) setValue(SnapshotSchema.parse(v));
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    return () => {
      alive = false;
    };
  }, [sha]);
  return { value, error };
}
export function useBlob(hash?: string) {
  const [value, setValue] = useState<ContentBlob | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setValue(null);
    setError('');
    if (hash)
      json(dataUrl(`blobs/${hash}.json`))
        .then((v) => {
          if (alive) setValue(BlobSchema.parse(v));
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    return () => {
      alive = false;
    };
  }, [hash]);
  return { value, error };
}
