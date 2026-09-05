export interface GraphCommit {
  sha: string;
  parents: string[];
}
export interface GraphRow {
  sha: string;
  lane: number;
  lanes: number;
  edges: {
    from: number;
    to: number;
    half: 'upper' | 'lower';
    dashed?: boolean;
  }[];
}
/** Lanes follow actual parent SHAs, not list adjacency. Dashed stubs leave the published window. */
export function commitGraph(commits: GraphCommit[]): GraphRow[] {
  const published = new Set(commits.map((c) => c.sha));
  let pending: string[] = [];
  return commits.map((commit) => {
    const before = [...pending];
    let lane = before.indexOf(commit.sha);
    if (lane < 0) {
      lane = before.length;
      before.push(commit.sha);
    }
    const after = before.filter((s) => s !== commit.sha);
    const parents = commit.parents.filter((s) => published.has(s));
    for (const parent of parents)
      if (!after.includes(parent))
        after.splice(Math.min(lane, after.length), 0, parent);
    const edges: GraphRow['edges'] = [];
    before.forEach((sha, i) => {
      if (pending.includes(sha)) edges.push({ from: i, to: i, half: 'upper' });
      if (sha !== commit.sha)
        edges.push({ from: i, to: after.indexOf(sha), half: 'lower' });
    });
    for (const parent of commit.parents)
      edges.push({
        from: lane,
        to: published.has(parent) ? after.indexOf(parent) : lane,
        half: 'lower',
        dashed: !published.has(parent),
      });
    pending = after;
    return {
      sha: commit.sha,
      lane,
      lanes: Math.max(before.length, after.length),
      edges,
    };
  });
}
