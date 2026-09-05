import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  CatalogSchema,
  SnapshotSchema,
  BlobSchema,
  type DocumentRecord,
  type ExerciseRecord,
  type SnapshotManifest,
} from '../lib/content-schema';
import {
  repositoryDir,
  selectSnapshots,
  inventory,
  readBlobs,
  gitText,
  gitRenames,
  type GitFile,
} from './content/git';
import { textFile, imageFile, assignTopic } from './content/curation';
import { groupExercises } from './content/exercises';
import {
  frontmatter,
  headings,
  parseRoadmap,
  renderMarkdown,
  exerciseSections,
  resolveLocal,
  resolveFileTarget,
} from './content/markdown';

const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const blobCache = new Map<string, Buffer>();
export async function buildContent(
  source: string,
  output: string,
  limit = 20,
  only?: string,
) {
  const dir = repositoryDir(source);
  const shas = selectSnapshots(dir, limit, only);
  await fs.mkdir(path.join(output, 'blobs'), { recursive: true });
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  await fs.mkdir(path.join(output, 'snapshots'), { recursive: true });
  const written = new Set<string>();
  const rendered = new Map<
    string,
    Awaited<ReturnType<typeof renderMarkdown>>
  >();
  const report: {
    snapshot: string;
    errors: { path: string; message: string }[];
    orphans: string[];
  }[] = [];
  async function writeBlob(html: string, source: string) {
    const content = JSON.stringify(BlobSchema.parse({ html, source }));
    const id = hash(content);
    if (!written.has(id)) {
      await fs.writeFile(path.join(output, 'blobs', `${id}.json`), content);
      written.add(id);
    }
    return id;
  }
  async function rawBlob(file: GitFile) {
    readBlobs([file], blobCache);
    return writeBlob('', blobCache.get(file.blob)!.toString('utf8'));
  }
  const metas = [];
  for (const sha of shas) {
    const [full, parents, date, author, ...message] = gitText(dir, [
      'show',
      '-s',
      '--format=%H%n%P%n%aI%n%an%n%s',
      sha,
    ]).split('\n');
    const refs = gitText(dir, [
      'for-each-ref',
      '--format=%(refname:short)',
      '--points-at',
      sha,
      'refs/heads',
      'refs/remotes/origin',
      'refs/tags',
    ])
      .split('\n')
      .filter((x) => x && !x.endsWith('/HEAD'));
    const meta = {
      sha: full,
      parents: parents ? parents.split(' ') : [],
      date,
      author,
      message: message.join('\n'),
      refs,
    };
    metas.push(meta);
    console.log(`Compiling ${sha.slice(0, 7)} ${meta.message}`);
    const tree = inventory(dir, sha, 'NeoTech-vietnam/NeoLearning');
    const selected = tree.files.filter(
      (f) => textFile(f.path) || imageFile(f.path),
    );
    readBlobs(selected, blobCache);
    const roadmap = selected.find(
      (f) => f.path === 'Embedded-Engineering-Roadmap.md',
    );
    if (!roadmap) throw new Error(`Roadmap missing at ${sha}`);
    const topics = parseRoadmap(blobCache.get(roadmap.blob)!.toString('utf8'));
    const files = new Set(
      selected.filter((f) => textFile(f.path)).map((f) => f.path),
    );
    const assetUrls = new Map<string, string>();
    for (const file of selected.filter((f) => imageFile(f.path))) {
      const bytes = blobCache.get(file.blob)!;
      if (bytes.length > 15 * 1024 * 1024) continue;
      const name = `${hash(bytes)}${path.extname(file.path).toLowerCase()}`;
      if (!written.has(name)) {
        await fs.writeFile(path.join(output, 'assets', name), bytes);
        written.add(name);
      }
      assetUrls.set(file.path, `content/assets/${name}`);
    }
    const assetKey = hash(JSON.stringify([...assetUrls]));
    const fileKey = hash([...files].join('\n'));
    const diagnostics: { path: string; message: string }[] = [];
    const documents: DocumentRecord[] = [];
    for (const file of selected.filter((f) => textFile(f.path))) {
      const source = blobCache.get(file.blob)!.toString('utf8');
      const markdown = /\.md$/i.test(file.path);
      let fm;
      try {
        fm = markdown ? frontmatter(source) : { metadata: {}, source };
      } catch (error) {
        throw new Error(`${file.path}: ${String(error)}`);
      }
      const hs = markdown ? headings(source) : [];
      const key = `${file.blob}:${file.path}:${assetKey}:${fileKey}`;
      let result = rendered.get(key);
      if (!result) {
        result = markdown
          ? await renderMarkdown(source, file.path, files, assetUrls)
          : { html: '', outbound: [], assets: [], errors: [] };
        rendered.set(key, result);
      }
      diagnostics.push(
        ...result.errors.map((message) => ({ path: file.path, message })),
      );
      const topicId = fm.metadata.topic ?? assignTopic(file.path, topics);
      if (topicId && !topics.some((t) => t.id === topicId))
        throw new Error(`${file.path}: unknown topic ${topicId}`);
      documents.push({
        path: file.path,
        repository: file.repository,
        sha: file.sha,
        blob: file.blob,
        contentHash: await writeBlob(result.html, source),
        title:
          fm.metadata.title ??
          hs
            .find((h) => h.text.startsWith('Topic:'))
            ?.text.replace(/^Topic:\s*/, '') ??
          hs[0]?.text ??
          path.posix.basename(file.path),
        summary: fm.metadata.summary ?? '',
        kind: markdown ? 'document' : 'source',
        topicId,
        headings: hs,
        outbound: result.outbound,
        backlinks: [],
        assets: result.assets,
        related: (fm.metadata.related ?? []).map((link) => {
          const local = resolveLocal(file.path, link);
          if (!local)
            throw new Error(
              `${file.path}: related must be an internal file path`,
            );
          const target = resolveFileTarget(local.path, files);
          if (!files.has(target))
            throw new Error(`${file.path}: missing related document ${target}`);
          return target;
        }),
        prerequisites: fm.metadata.prerequisites ?? [],
        ...(fm.metadata.estimatedMinutes
          ? { estimatedMinutes: fm.metadata.estimatedMinutes }
          : {}),
      });
    }
    const docs = new Map(documents.map((d) => [d.path, d]));
    for (const doc of documents)
      for (const link of doc.outbound)
        if (link !== doc.path) docs.get(link)?.backlinks.push(doc.path);
    const exercises: ExerciseRecord[] = [];
    for (const group of groupExercises(documents)) {
      const { id: parent, codes, note } = group;
      const solutions: { c?: string; cpp?: string } = {};
      for (const code of codes) {
        const lang = code.path.endsWith('.cpp') ? 'cpp' : 'c';
        solutions[lang] ??= code.path;
      }
      const raw = note
        ? blobCache.get(note.blob)!.toString('utf8')
        : `# ${path.posix.basename(parent).replace(/_/g, ' ')}\n\nStudy the source, write your own approach, and reveal the repository example when ready.`;
      const sections = exerciseSections(raw);
      const renderPart = async (part: string) => {
        const r = await renderMarkdown(
          part,
          note?.path ?? codes[0].path,
          files,
          assetUrls,
        );
        return writeBlob(r.html, part);
      };
      const topicId = note?.topicId ?? codes[0].topicId;
      const related = documents.find(
        (d) =>
          d.topicId === topicId &&
          d.kind === 'document' &&
          d.path !== note?.path &&
          d.path.includes('/01_learning/'),
      );
      exercises.push({
        id: parent,
        title:
          group.title ??
          note?.title ??
          path.posix.basename(parent).replace(/_/g, ' '),
        topicId,
        notePath: note?.path ?? null,
        documentationPath: group.documentationPath ?? related?.path ?? null,
        solutions,
        promptHash: await renderPart(sections.prompt),
        hintHashes: await Promise.all(sections.hints.map(renderPart)),
        snapshot: sha,
      });
    }
    for (const topic of topics) {
      const descendants = new Set([topic.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of topics)
          if (
            t.parentId &&
            descendants.has(t.parentId) &&
            !descendants.has(t.id)
          ) {
            descendants.add(t.id);
            changed = true;
          }
      }
      topic.documents = documents
        .filter((d) => d.topicId && descendants.has(d.topicId))
        .map((d) => d.path);
      topic.exercises = exercises
        .filter((e) => e.topicId && descendants.has(e.topicId))
        .map((e) => e.id);
      topic.prerequisites = [
        ...new Set(
          documents
            .filter((d) => d.topicId === topic.id)
            .flatMap((d) => d.prerequisites),
        ),
      ];
    }
    const changes: SnapshotManifest['changes'] = [];
    const previous = meta.parents[0]
      ? inventory(
          dir,
          meta.parents[0],
          'NeoTech-vietnam/NeoLearning',
        ).files.filter((f) => textFile(f.path))
      : [];
    const previousMap = new Map(previous.map((f) => [f.path, f]));
    const currentMap = new Map(
      selected.filter((f) => textFile(f.path)).map((f) => [f.path, f]),
    );
    const removed = previous.filter((f) => !currentMap.has(f.path));
    const added = selected.filter(
      (f) => textFile(f.path) && !previousMap.has(f.path),
    );
    const renamed = new Set<string>();
    const renamePaths = gitRenames(previous, [...currentMap.values()]);
    readBlobs(
      previous.filter(
        (f) =>
          !currentMap.has(f.path) || currentMap.get(f.path)?.blob !== f.blob,
      ),
      blobCache,
    );
    for (const file of added) {
      const old = removed.find(
        (r) =>
          (renamePaths.get(file.path) === r.path || r.blob === file.blob) &&
          !renamed.has(r.path),
      );
      if (old) {
        renamed.add(old.path);
        changes.push({
          path: file.path,
          status: 'renamed',
          oldPath: old.path,
          beforeHash: await rawBlob(old),
          afterHash: await rawBlob(file),
        });
      } else
        changes.push({
          path: file.path,
          status: 'added',
          afterHash: await rawBlob(file),
        });
    }
    for (const file of removed)
      if (!renamed.has(file.path))
        changes.push({
          path: file.path,
          status: 'removed',
          beforeHash: await rawBlob(file),
        });
    for (const file of selected.filter((f) => textFile(f.path))) {
      const old = previousMap.get(file.path);
      if (old && old.blob !== file.blob)
        changes.push({
          path: file.path,
          status: 'modified',
          beforeHash: await rawBlob(old),
          afterHash: await rawBlob(file),
        });
    }
    const snapshot = SnapshotSchema.parse({
      ...meta,
      version: 1,
      pins: tree.pins,
      topics,
      documents,
      exercises,
      changes,
    });
    await fs.writeFile(
      path.join(output, 'snapshots', `${sha}.json`),
      JSON.stringify(snapshot),
    );
    report.push({
      snapshot: sha,
      errors: diagnostics,
      orphans: documents.filter((d) => !d.topicId).map((d) => d.path),
    });
  }
  const catalog = CatalogSchema.parse({
    version: 1,
    defaultSnapshot: shas[0],
    generatedAt: new Date().toISOString(),
    source: 'NeoTech-vietnam/NeoLearning',
    snapshots: metas,
  });
  await fs.writeFile(
    path.join(output, 'catalog.json'),
    JSON.stringify(catalog),
  );
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  await fs.mkdir(path.resolve('schemas'), { recursive: true });
  for (const [name, schema] of Object.entries({
    catalog: CatalogSchema,
    snapshot: SnapshotSchema,
    blob: BlobSchema,
  }))
    await fs.writeFile(
      path.resolve('schemas', `${name}.schema.json`),
      JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n',
    );
  console.log(
    `Built ${shas.length} snapshots; ${written.size} shared content objects. Legacy diagnostics: ${report.reduce((n, r) => n + r.errors.length, 0)}. See content/report.json.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      output: { type: 'string', default: 'public/content' },
      limit: { type: 'string', default: '20' },
      ref: { type: 'string' },
    },
  });
  if (!values.source) throw new Error('Use --source <NeoLearning checkout>.');
  await buildContent(
    path.resolve(values.source),
    path.resolve(values.output!),
    Number(values.limit),
    values.ref,
  );
}
