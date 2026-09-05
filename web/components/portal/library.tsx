'use client';
import { useState, useMemo, lazy, Suspense, useEffect } from 'react';
import {
  FileText,
  Folder,
  ChevronRight,
  ChevronDown,
  Search,
  BookOpen,
  GitCompare,
  ExternalLink,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Markdown } from './markdown';
import { useBlob } from './data';
import type { SnapshotManifest, DocumentRecord } from '@/lib/content-schema';
import type { Route } from '@/lib/routes';
import type { Go } from './dashboard';
const Editor = lazy(() => import('./code-editor'));
interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  document?: DocumentRecord;
}
function makeTree(documents: { path: string }[]) {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  for (const doc of documents) {
    let node = root;
    const parts = doc.path.split('/');
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join('/');
      let next = node.children.get(part);
      if (!next) {
        next = { name: part, path: p, children: new Map() };
        node.children.set(part, next);
      }
      node = next;
    });
  }
  return root;
}
function TreeBranch({
  node,
  snapshot,
  go,
  selected,
  level = 0,
  expandedSearch = false,
}: {
  node: TreeNode;
  snapshot: SnapshotManifest;
  go: Go;
  selected?: string;
  level?: number;
  expandedSearch?: boolean;
}) {
  const folder = node.children.size > 0;
  const [open, setOpen] = useState(
    level < 1 || !!selected?.startsWith(node.path + '/'),
  );
  const expanded = open || expandedSearch;
  const status = snapshot.changes.find((c) => c.path === node.path)?.status;
  return (
    <li
      role="treeitem"
      aria-expanded={folder ? expanded : undefined}
      aria-selected={node.path === selected}
    >
      <button
        className={`tree-row ${node.path === selected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + level * 14 }}
        onClick={() =>
          folder ? setOpen(!open) : go({ view: 'document', path: node.path })
        }
        onKeyDown={(e) => {
          if (folder && e.key === 'ArrowRight') {
            setOpen(true);
            e.preventDefault();
          }
          if (folder && e.key === 'ArrowLeft') {
            setOpen(false);
            e.preventDefault();
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            const rows = [
              ...e.currentTarget
                .closest('[role=tree]')!
                .querySelectorAll<HTMLButtonElement>('.tree-row'),
            ];
            const index = rows.indexOf(e.currentTarget);
            const target =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? rows.length - 1
                  : e.key === 'ArrowDown'
                    ? index + 1
                    : index - 1;
            rows[target]?.focus();
            e.preventDefault();
          }
        }}
      >
        {folder ? (
          expanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )
        ) : (
          <span className="tree-spacer" />
        )}
        {folder ? <Folder size={15} /> : <FileText size={15} />}
        <span>{node.name.replace(/^\d+_/, '').replace(/_/g, ' ')}</span>
        {status && (
          <small className={`change-${status}`} title={status}>
            {status[0].toUpperCase()}
          </small>
        )}
      </button>
      {folder && expanded && (
        <ul role="group">
          {[...node.children.values()]
            .sort(
              (a, b) =>
                Number(b.children.size > 0) - Number(a.children.size > 0) ||
                a.name.localeCompare(b.name),
            )
            .map((child) => (
              <TreeBranch
                key={child.path}
                node={child}
                snapshot={snapshot}
                go={go}
                selected={selected}
                level={level + 1}
                expandedSearch={expandedSearch}
              />
            ))}
        </ul>
      )}
    </li>
  );
}
export default function Library({
  snapshot,
  published,
  route,
  go,
}: {
  snapshot: SnapshotManifest;
  published: string[];
  route: Route;
  go: Go;
}) {
  const [query, setQuery] = useState(
    route.view === 'library' ? (route.path ?? '') : '',
  );
  const [diff, setDiff] = useState(false);
  useEffect(() => {
    setDiff(false);
    setQuery(route.view === 'library' ? (route.path ?? '') : '');
  }, [route.path, route.view, snapshot.sha]);
  const docs = snapshot.documents.filter((d) =>
    `${d.path} ${d.title}`.toLowerCase().includes(query.toLowerCase()),
  );
  const tree = useMemo(
    () =>
      makeTree([
        ...docs,
        ...snapshot.changes.filter(
          (c) =>
            c.status === 'removed' &&
            c.path.toLowerCase().includes(query.toLowerCase()),
        ),
      ]),
    [docs, snapshot.changes, query],
  );
  const doc =
    route.view === 'document'
      ? snapshot.documents.find((d) => d.path === route.path)
      : undefined;
  const removed = snapshot.changes.find(
    (c) => c.path === route.path && c.status === 'removed',
  );
  const change = doc
    ? snapshot.changes.find((c) => c.path === doc.path)
    : undefined;
  const blob = useBlob(doc?.contentHash);
  const before = useBlob(
    removed?.beforeHash ?? (diff ? change?.beforeHash : undefined),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KNOWLEDGE LIBRARY</span>
          <h1>{doc ? 'Make the connections.' : 'Every idea has a home.'}</h1>
          <p>
            {snapshot.documents.length} files · Documentation, source examples,
            and the links between them.
          </p>
        </div>
      </div>
      <div className="library-layout">
        <aside className="file-explorer panel">
          <div className="explorer-header">
            <Folder size={15} /> EXPLORER
          </div>
          <div className="search-field">
            <Search size={15} />
            <Input
              aria-label="Filter files"
              placeholder="Find a file or concept…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul role="tree" aria-label="Learning files" className="file-tree">
            {[...tree.children.values()].map((node) => (
              <TreeBranch
                key={node.path}
                node={node}
                snapshot={snapshot}
                go={go}
                selected={route.path}
                expandedSearch={!!query}
              />
            ))}
          </ul>
          {!docs.length && <p>No matching files.</p>}
        </aside>
        <section className="document-surface panel">
          {doc ? (
            <>
              <div className="document-toolbar">
                <span>
                  <FileText size={15} />
                  {doc.path.split('/').at(-1)}
                </span>
                <div>
                  {change && (
                    <Button
                      variant="ghost"
                      aria-pressed={diff}
                      onClick={() => setDiff(!diff)}
                    >
                      <GitCompare />
                      {diff ? 'Read' : 'Compare'}
                    </Button>
                  )}
                  <a
                    className="text-link"
                    href={`https://github.com/${doc.repository}/blob/${doc.sha}/${
                      doc.path.startsWith('Examples/')
                        ? doc.path
                            .split('/')
                            .slice(
                              snapshot.pins
                                .filter((p) =>
                                  doc.path.startsWith(p.path + '/'),
                                )
                                .sort(
                                  (a, b) => b.path.length - a.path.length,
                                )[0]
                                ?.path.split('/').length ?? 0,
                            )
                            .map(encodeURIComponent)
                            .join('/')
                        : doc.path.split('/').map(encodeURIComponent).join('/')
                    }`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source <ExternalLink size={13} />
                  </a>
                </div>
              </div>
              {diff ? (
                <div className="source-editor">
                  <Suspense fallback={<p>Loading comparison…</p>}>
                    <Editor
                      value={blob.value?.source ?? ''}
                      original={before.value?.source ?? ''}
                      readOnly
                      language={
                        doc.path.endsWith('.md')
                          ? 'markdown'
                          : doc.path.endsWith('.c')
                            ? 'c'
                            : 'cpp'
                      }
                    />
                  </Suspense>
                </div>
              ) : doc.kind === 'source' ? (
                <div className="source-editor">
                  <Suspense fallback={<p>Loading source…</p>}>
                    <Editor
                      value={blob.value?.source ?? ''}
                      readOnly
                      language={doc.path.endsWith('.c') ? 'c' : 'cpp'}
                    />
                  </Suspense>
                </div>
              ) : (
                <Markdown
                  hash={doc.contentHash}
                  snapshot={snapshot.sha}
                  anchor={route.anchor}
                />
              )}
              <div className="document-relations">
                <Tabs defaultValue="links">
                  <TabsList>
                    <TabsTrigger value="links">Related files</TabsTrigger>
                    <TabsTrigger value="backlinks">
                      Backlinks ({doc.backlinks.length})
                    </TabsTrigger>
                    <TabsTrigger value="contents">On this page</TabsTrigger>
                  </TabsList>
                  <TabsContent value="links">
                    {[...new Set([...doc.related, ...doc.outbound])]
                      .filter((p) => p !== doc.path)
                      .map((p) => (
                        <button
                          key={p}
                          className="resource-link"
                          onClick={() => go({ view: 'document', path: p })}
                        >
                          <FileText size={15} />
                          {snapshot.documents.find((d) => d.path === p)
                            ?.title ?? p}
                        </button>
                      ))}
                    {!doc.outbound.length && !doc.related.length && (
                      <p className="empty-copy">
                        No linked files in this document.
                      </p>
                    )}
                  </TabsContent>
                  <TabsContent value="backlinks">
                    {doc.backlinks.map((p) => (
                      <button
                        className="resource-link"
                        key={p}
                        onClick={() => go({ view: 'document', path: p })}
                      >
                        {snapshot.documents.find((d) => d.path === p)?.title ??
                          p}
                      </button>
                    ))}
                  </TabsContent>
                  <TabsContent value="contents">
                    {doc.headings.map((h) => (
                      <button
                        className="resource-link"
                        key={h.id}
                        style={{ paddingLeft: (h.depth - 1) * 12 }}
                        onClick={() =>
                          go({ view: 'document', path: doc.path, anchor: h.id })
                        }
                      >
                        {h.text}
                      </button>
                    ))}
                  </TabsContent>
                </Tabs>
              </div>
            </>
          ) : removed ? (
            <div className="empty-state">
              <h2>This file was removed</h2>
              <p>{removed.path}</p>
              {published.includes(snapshot.parents[0]) && (
                <Button
                  onClick={() =>
                    go({
                      view: 'document',
                      snapshot: snapshot.parents[0],
                      path: removed.path,
                    })
                  }
                >
                  Open previous version
                </Button>
              )}
              {!published.includes(snapshot.parents[0]) && (
                <p>
                  The first parent is outside the published window. Its exact
                  file content is preserved below.
                </p>
              )}
              {before.error && <p role="alert">{before.error}</p>}
              {before.value && (
                <pre className="tombstone-source">
                  <code>{before.value.source}</code>
                </pre>
              )}
            </div>
          ) : route.view === 'document' ? (
            <div className="empty-state">
              <h2>This file is absent from this snapshot</h2>
              <p>Select another version or browse the file tree.</p>
            </div>
          ) : (
            <div className="library-overview">
              <BookOpen size={40} />
              <h2>Your knowledge, connected.</h2>
              <p>
                Select a file to read, follow its links, or explore how it
                changed.
              </p>
              <div className="document-list">
                {docs
                  .filter((d) => d.kind === 'document')
                  .slice(0, 12)
                  .map((d) => (
                    <button
                      key={d.path}
                      onClick={() => go({ view: 'document', path: d.path })}
                    >
                      <FileText size={18} />
                      <span>
                        {d.title}
                        <small>{d.path}</small>
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
