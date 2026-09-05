import path from 'node:path';
import { z } from 'zod';
import type { DocumentRecord } from '../../lib/content-schema';
import mapping from '../../content/topic-map.json';

const overrideSchema = z.record(
  z.string(),
  z
    .object({
      title: z.string().optional(),
      notePath: z.string().nullable().optional(),
      documentationPath: z.string().nullable().optional(),
      solutions: z
        .object({ c: z.string().optional(), cpp: z.string().optional() })
        .strict(),
    })
    .strict(),
);
export function groupExercises(
  documents: DocumentRecord[],
  overrides: unknown = mapping.exercises,
) {
  const explicit = overrideSchema.parse(overrides);
  const docs = new Map(documents.map((d) => [d.path, d]));
  const groups = new Map<string, DocumentRecord[]>();
  const consumed = new Set<string>();
  const output: {
    id: string;
    title?: string;
    note?: DocumentRecord;
    codes: DocumentRecord[];
    documentationPath?: string | null;
  }[] = [];
  for (const [id, override] of Object.entries(explicit)) {
    const paths = Object.entries(override.solutions);
    // A historical snapshot may predate this entire exercise.
    if (!paths.some(([, p]) => docs.has(p))) continue;
    const codes = paths.map(([language, p]) => {
      if (!docs.has(p) || !p.endsWith('.' + language))
        throw new Error(`Exercise ${id}: invalid ${language} solution ${p}`);
      consumed.add(p);
      return docs.get(p)!;
    });
    for (const p of [override.notePath, override.documentationPath])
      if (p && !docs.has(p))
        throw new Error(`Exercise ${id}: missing mapped document ${p}`);
    output.push({
      id,
      title: override.title,
      codes,
      note: override.notePath ? docs.get(override.notePath) : undefined,
      documentationPath: override.documentationPath,
    });
  }
  for (const doc of documents)
    if (
      /\.(c|cpp)$/.test(doc.path) &&
      /(?:02_practice|02_example|Examples)\//.test(doc.path) &&
      !consumed.has(doc.path)
    ) {
      const directory = path.posix.dirname(doc.path);
      groups.set(directory, [...(groups.get(directory) ?? []), doc]);
    }
  for (const [directory, codes] of groups) {
    const notes = documents.filter(
      (d) =>
        path.posix.dirname(d.path) === directory && /_note\.md$/i.test(d.path),
    );
    const note =
      notes.length === 1 ? notes[0] : docs.get(directory + '/README.md');
    if (notes.length > 1)
      throw new Error(
        `Ambiguous exercise notes in ${directory}; add an exercises override to content/topic-map.json.`,
      );
    const ambiguous = ['c', 'cpp'].some(
      (lang) => codes.filter((d) => d.path.endsWith('.' + lang)).length > 1,
    );
    if (!ambiguous) {
      output.push({ id: directory, codes, note });
      continue;
    }
    // Unrelated examples in one directory get separate workspaces; none are silently discarded.
    const stems = new Map<string, DocumentRecord[]>();
    for (const code of codes) {
      const stem = code.path.replace(/\.(?:c|cpp)$/, '');
      stems.set(stem, [...(stems.get(stem) ?? []), code]);
    }
    for (const [stem, files] of stems)
      output.push({
        id: ambiguous ? stem : directory,
        title: ambiguous ? path.posix.basename(stem) : undefined,
        codes: files,
        note,
      });
  }
  return output;
}
