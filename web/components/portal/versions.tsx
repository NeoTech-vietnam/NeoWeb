'use client';
import { useState } from 'react';
import {
  GitBranch,
  GitCommitHorizontal,
  ChevronRight,
  Package,
  ArrowUpRight,
} from 'lucide-react';
import type { Catalog, SnapshotManifest } from '@/lib/content-schema';
import type { Go } from './dashboard';
import { commitGraph } from '@/lib/commit-graph';
export default function Versions({
  catalog,
  snapshot,
  go,
}: {
  catalog: Catalog;
  snapshot: SnapshotManifest;
  go: Go;
}) {
  const [filter, setFilter] = useState('all');
  const graph = commitGraph(catalog.snapshots);
  const laneCount = Math.max(...graph.map((r) => r.lanes), 1);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VERSION EXPLORER</span>
          <h1>Travel through your learning history.</h1>
          <p>
            Each snapshot includes the exact nested examples recorded in that
            commit.
          </p>
        </div>
        <span className="subtle-tag">
          {catalog.snapshots.length} published snapshots
        </span>
      </div>
      <div className="versions-layout">
        <section className="panel">
          <div className="section-title">
            <h2>
              <GitBranch size={19} /> Commit graph
            </h2>
          </div>
          <ol className="commit-graph">
            {catalog.snapshots.map((commit, i) => (
              <li
                key={commit.sha}
                className={commit.sha === snapshot.sha ? 'active' : ''}
              >
                <svg
                  className="actual-git-lanes"
                  aria-hidden="true"
                  width={laneCount * 17 + 12}
                  viewBox={`0 0 ${laneCount * 17 + 12} 80`}
                  preserveAspectRatio="none"
                >
                  {graph[i].edges.map((edge, j) => (
                    <path
                      key={j}
                      d={
                        edge.half === 'upper'
                          ? `M ${edge.from * 17 + 12} 0 L ${edge.to * 17 + 12} 40`
                          : `M ${edge.from * 17 + 12} 40 C ${edge.from * 17 + 12} 65 ${edge.to * 17 + 12} 55 ${edge.to * 17 + 12} 80`
                      }
                      strokeDasharray={edge.dashed ? '3 4' : undefined}
                    />
                  ))}
                  <circle cx={graph[i].lane * 17 + 12} cy="40" r="4" />
                </svg>
                <button
                  onClick={() => go({ view: 'versions', snapshot: commit.sha })}
                >
                  <div className="commit-title">{commit.message}</div>
                  <div className="commit-meta">
                    <code>{commit.sha.slice(0, 7)}</code>
                    <span>{new Date(commit.date).toLocaleDateString()}</span>
                    {commit.refs.slice(0, 2).map((ref) => (
                      <span className="ref-badge" key={ref}>
                        {ref.replace('origin/', '')}
                      </span>
                    ))}
                  </div>
                  {commit.parents.length > 1 && (
                    <small>
                      Merge ·{' '}
                      {commit.parents.map((p) => p.slice(0, 7)).join(' + ')}
                    </small>
                  )}
                </button>
              </li>
            ))}
          </ol>
          <p className="empty-copy">
            Lines follow parent commits. Dashed lines continue outside the
            published snapshots.
          </p>
        </section>
        <aside>
          <section className="panel">
            <span className="eyebrow">EXACT WORKSPACE STATE</span>
            <h2>
              <Package size={20} /> Pinned submodules
            </h2>
            <div className="pin-root">
              <GitCommitHorizontal size={18} /> NeoLearning{' '}
              <code>{snapshot.sha.slice(0, 7)}</code>
            </div>
            {snapshot.pins.map((pin) => (
              <details
                key={pin.path}
                className="pin-entry"
                style={{ marginLeft: (pin.path.split('/').length - 1) * 12 }}
              >
                <summary>
                  {pin.path.split('/').at(-1)}
                  <code>{pin.sha.slice(0, 7)}</code>
                </summary>
                <p>{pin.repository}</p>
                <a
                  className="text-link"
                  href={`https://github.com/${pin.repository}/tree/${pin.sha}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open pinned source <ArrowUpRight size={13} />
                </a>
              </details>
            ))}
          </section>
          <section className="panel">
            <div className="section-title">
              <h2>Changes from first parent</h2>
              <span className="subtle-tag">{snapshot.changes.length}</span>
            </div>
            <label className="field-label">
              Change type
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All changes</option>
                {['added', 'removed', 'modified', 'renamed'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <div className="changes-list">
              {snapshot.changes
                .filter((c) => filter === 'all' || c.status === filter)
                .map((c) => (
                  <button
                    key={c.path}
                    onClick={() => go({ view: 'document', path: c.path })}
                  >
                    <span className={`change-badge change-${c.status}`}>
                      {c.status[0].toUpperCase()}
                    </span>
                    <span>
                      {c.path.split('/').at(-1)}
                      <small>
                        {c.status}
                        {c.oldPath ? ` from ${c.oldPath}` : ''}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
            </div>
            {!snapshot.changes.length && (
              <p className="empty-copy">
                No changes to published files in this commit.
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
