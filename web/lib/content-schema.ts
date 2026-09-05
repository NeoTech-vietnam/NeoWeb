import { z } from 'zod';

export const HeadingSchema = z.object({
  id: z.string(),
  text: z.string(),
  depth: z.number().int(),
});
export const ResourceSchema = z.object({ title: z.string(), url: z.string() });
export const TopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string().nullable(),
  depth: z.number().int(),
  description: z.string(),
  roadmapAnchor: z.string(),
  resources: z.array(ResourceSchema),
  documents: z.array(z.string()),
  exercises: z.array(z.string()),
  prerequisites: z.array(z.string()),
});
export const DocumentSchema = z.object({
  path: z.string(),
  repository: z.string(),
  sha: z.string(),
  blob: z.string(),
  contentHash: z.string(),
  title: z.string(),
  summary: z.string(),
  kind: z.enum(['document', 'source']),
  topicId: z.string().nullable(),
  headings: z.array(HeadingSchema),
  outbound: z.array(z.string()),
  backlinks: z.array(z.string()),
  assets: z.array(z.string()),
  related: z.array(z.string()),
  prerequisites: z.array(z.string()),
  estimatedMinutes: z.number().positive().optional(),
});
export const ExerciseSchema = z.object({
  id: z.string(),
  title: z.string(),
  topicId: z.string().nullable(),
  notePath: z.string().nullable(),
  documentationPath: z.string().nullable(),
  solutions: z.object({ c: z.string().optional(), cpp: z.string().optional() }),
  promptHash: z.string(),
  hintHashes: z.array(z.string()),
  snapshot: z.string(),
});
export const ChangeSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'removed', 'modified', 'renamed']),
  oldPath: z.string().optional(),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
});
export const PinSchema = z.object({
  path: z.string(),
  repository: z.string(),
  sha: z.string(),
  parentPath: z.string(),
});
export const SnapshotMetaSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  parents: z.array(z.string()),
  refs: z.array(z.string()),
  date: z.string(),
  message: z.string(),
  author: z.string(),
});
export const SnapshotSchema = SnapshotMetaSchema.extend({
  version: z.literal(1),
  pins: z.array(PinSchema),
  topics: z.array(TopicSchema),
  documents: z.array(DocumentSchema),
  exercises: z.array(ExerciseSchema),
  changes: z.array(ChangeSchema),
});
export const CatalogSchema = z.object({
  version: z.literal(1),
  defaultSnapshot: z.string(),
  generatedAt: z.string(),
  source: z.string(),
  snapshots: z.array(SnapshotMetaSchema),
});
export const BlobSchema = z.object({ html: z.string(), source: z.string() });
export const FrontmatterSchema = z
  .object({
    title: z.string().min(1).optional(),
    summary: z.string().optional(),
    topic: z.string().optional(),
    kind: z.enum(['document', 'note', 'exercise', 'example']).optional(),
    prerequisites: z.array(z.string()).optional(),
    related: z.array(z.string()).optional(),
    estimatedMinutes: z.number().positive().optional(),
  })
  .strict();
export type TopicRecord = z.infer<typeof TopicSchema>;
export type DocumentRecord = z.infer<typeof DocumentSchema>;
export type ExerciseRecord = z.infer<typeof ExerciseSchema>;
export type SnapshotManifest = z.infer<typeof SnapshotSchema>;
export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type ContentBlob = z.infer<typeof BlobSchema>;
