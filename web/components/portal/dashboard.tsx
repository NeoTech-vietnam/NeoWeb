'use client';
import { useState, useEffect } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Code2,
  Orbit,
  BookOpen,
  Clock3,
  Compass,
  Target,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FocusCard, IntegrationCards } from './personal';
import type { SnapshotManifest, TopicRecord } from '@/lib/content-schema';
import type { LearningStateV1 } from '@/lib/learning-state';
import type { Route } from '@/lib/routes';
export type UpdateState = (
  fn: (old: LearningStateV1) => LearningStateV1,
) => void;
export type Go = (route: Route) => void;
type Props = {
  snapshot: SnapshotManifest;
  state: LearningStateV1;
  update: UpdateState;
  go: Go;
};
export function Dashboard({ snapshot, state, update, go }: Props) {
  const groups = snapshot.topics.filter((t) => !t.parentId);
  const completed = snapshot.topics.filter(
    (t) => state.topicStatus[t.id] === 'complete',
  ).length;
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekMinutes = Math.round(
    state.sessions
      .filter((s) => s.startedAt >= weekStart.getTime())
      .reduce((n, s) => n + s.focusedMs, 0) / 60000,
  );
  const due = snapshot.exercises.filter(
    (e) => state.reviews[e.id] && state.reviews[e.id].dueAt <= Date.now(),
  );
  const current =
    snapshot.topics.find((t) => t.id === state.preferences.lastTopicId) ??
    snapshot.topics.find((t) => t.id === 'algorithms-and-data-structures') ??
    groups[0];
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(weekStart);
    start.setDate(start.getDate() + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      label: start.toLocaleDateString(undefined, { weekday: 'short' }),
      minutes: Math.round(
        state.sessions
          .filter((s) => s.startedAt >= +start && s.startedAt < +end)
          .reduce((n, s) => n + s.focusedMs, 0) / 60000,
      ),
    };
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            MISSION CONTROL <span className="tiny-star">✦</span> {date}
          </div>
          <h1>Your next discovery starts here.</h1>
          <p>
            A little curiosity. A little practice. A universe of possibilities.
          </p>
        </div>
        <Button variant="outline" onClick={() => go({ view: 'topics' })}>
          Explore roadmap <ArrowUpRight />
        </Button>
      </div>
      <div className="stats-row">
        <Stat
          icon={<Clock3 />}
          label="FOCUSED THIS WEEK"
          value={`${weekMinutes}`}
          unit="min"
          detail={
            state.weeklyTargetMinutes
              ? `of ${state.weeklyTargetMinutes} min planned`
              : 'Set your own weekly target'
          }
        />
        <Stat
          icon={<Compass />}
          label="ROADMAP PROGRESS"
          value={`${Math.round((completed / snapshot.topics.length) * 100)}`}
          unit="%"
          detail={`${completed} of ${snapshot.topics.length} topics completed`}
        />
        <Stat
          icon={<Code2 />}
          label="PRACTICE SESSIONS"
          value={`${state.attempts.length}`}
          detail={`${snapshot.exercises.length} exercises to explore`}
        />
        <Stat
          icon={<Target />}
          label="READY TO REVIEW"
          value={`${due.length}`}
          detail={
            due.length
              ? 'Keep these ideas in orbit'
              : 'Your next review will appear here'
          }
        />
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <section className="continue-card panel">
            <div className="continue-copy">
              <div className="eyebrow">
                <span className="status-dot" /> CONTINUE YOUR JOURNEY
              </div>
              <h2>{current.title}</h2>
              <p>
                {current.description ||
                  'Open your notes, make connections, and turn an idea into understanding.'}
              </p>
              <div className="inline-meta">
                <span>
                  <BookOpen size={14} />
                  {current.documents.length} files
                </span>
                <span>
                  <Code2 size={14} />
                  {current.exercises.length} exercises
                </span>
              </div>
              <Button onClick={() => go({ view: 'topic', topic: current.id })}>
                Resume learning <ArrowRight />
              </Button>
            </div>
            <div className="orbital-diagram" aria-hidden="true">
              <div className="orbit-ring ring-one" />
              <div className="orbit-ring ring-two" />
              <div className="orbit-ring ring-three" />
              <div className="orbit-core">
                <Code2 size={35} />
              </div>
              <span className="orbit-node node-one" />
              <span className="orbit-node node-two" />
              <span className="orbit-node node-three" />
            </div>
          </section>
          <section className="panel activity-panel">
            <div className="section-title">
              <div>
                <span className="eyebrow">STEADY PROGRESS</span>
                <h2>Time well spent</h2>
              </div>
              <span className="subtle-tag">This week</span>
            </div>
            <div
              className="activity-chart"
              role="img"
              aria-label={days
                .map((d) => `${d.label}: ${d.minutes} focused minutes`)
                .join(', ')}
            >
              {days.map((d) => (
                <div className="chart-column" key={d.label}>
                  <span className="bar-value">{d.minutes || '—'}</span>
                  <div className="bar-track">
                    <div
                      className="bar"
                      style={{
                        height: `${Math.max(d.minutes ? 4 : 0, (d.minutes / Math.max(60, ...days.map((x) => x.minutes))) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>{d.label}</span>
                </div>
              ))}
            </div>
            <div className="chart-legend">
              <span className="color-dot color-0" /> Focused minutes{' '}
              <span>Every session counts.</span>
            </div>
          </section>
          <section>
            <div className="section-title">
              <div>
                <span className="eyebrow">FIND YOUR NEXT ORBIT</span>
                <h2>Explore the roadmap</h2>
              </div>
              <button
                className="text-link"
                onClick={() => go({ view: 'topics' })}
              >
                View all {groups.length} <ArrowRight size={15} />
              </button>
            </div>
            <div className="topic-grid compact">
              {groups
                .filter((t) =>
                  [
                    'programming-languages',
                    'programming-fundamentals',
                    'microcontrollers',
                    'operating-systems',
                    'electronics',
                    'interfaces-protocols-and-communication-technologies',
                  ].includes(t.id),
                )
                .map((t, i) => (
                  <TopicCard
                    key={t.id}
                    topic={t}
                    index={i}
                    state={state}
                    go={go}
                  />
                ))}
            </div>
          </section>
        </div>
        <aside className="dashboard-secondary">
          <FocusCard state={state} update={update} topics={snapshot.topics} />
          <section className="panel review-card">
            <div className="section-title">
              <h2>Recall & reconnect</h2>
              <Target size={18} />
            </div>
            <p>
              {due.length
                ? `${due.length} ideas are ready for another pass.`
                : 'Practice an exercise and rate your recall to schedule a review.'}
            </p>
            <Button
              variant="outline"
              onClick={() => go({ view: 'practice', exercise: due[0]?.id })}
            >
              {due.length ? 'Start review' : 'Open practice lab'} <ArrowRight />
            </Button>
            {state.attempts
              .slice(-2)
              .reverse()
              .map((a) => (
                <div className="recent-attempt" key={a.id}>
                  <Check size={14} />
                  <span>
                    {snapshot.exercises.find((e) => e.id === a.exerciseId)
                      ?.title ?? 'Practice session'}
                    <small>
                      Confidence {a.confidence}/5 · {a.rating}
                    </small>
                  </span>
                </div>
              ))}
          </section>
          <IntegrationCards />
        </aside>
      </div>
    </>
  );
}
function Stat({
  icon,
  label,
  value,
  unit,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  detail: string;
}) {
  return (
    <section className="stat-card">
      <div className="stat-label">
        {label}
        {icon}
      </div>
      <div className="stat-value">
        {value}
        <span>{unit}</span>
      </div>
      <p>{detail}</p>
    </section>
  );
}
function TopicCard({
  topic,
  index,
  state,
  go,
}: {
  topic: TopicRecord;
  index: number;
  state: LearningStateV1;
  go: Go;
}) {
  return (
    <button
      className={`topic-card theme-${index % 6}`}
      onClick={() => go({ view: 'topic', topic: topic.id })}
    >
      <span className="topic-icon">
        {index % 3 === 0 ? (
          <Code2 />
        ) : index % 3 === 1 ? (
          <Orbit />
        ) : (
          <Compass />
        )}
      </span>
      <ArrowUpRight className="topic-arrow" size={16} />
      <h3>{topic.title}</h3>
      <div className="topic-card-meta">
        <span>{topic.documents.length} files</span>
        <span>{topic.exercises.length} exercises</span>
      </div>
      <div className="topic-card-status">
        <span className="color-dot" />
        {state.topicStatus[topic.id] === 'complete'
          ? 'Completed'
          : state.topicStatus[topic.id] === 'learning'
            ? 'In progress'
            : 'Ready to explore'}
      </div>
    </button>
  );
}
export function Topics({ snapshot, state, go }: Omit<Props, 'update'>) {
  const [filter, setFilter] = useState('');
  const topics = snapshot.topics.filter(
    (t) =>
      (filter || !t.parentId) &&
      t.title.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE EMBEDDED ENGINEERING ROADMAP</span>
          <h1>A universe worth exploring.</h1>
          <p>
            Follow your curiosity, from first principles to advanced systems.
          </p>
        </div>
      </div>
      <Input
        className="topic-filter"
        aria-label="Filter roadmap topics"
        placeholder="Find a topic…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="topic-grid">
        {topics.map((t, i) => (
          <TopicCard key={t.id} topic={t} index={i} state={state} go={go} />
        ))}
      </div>
    </>
  );
}
export function Topic({
  snapshot,
  id,
  state,
  update,
  go,
}: Props & { id?: string }) {
  const topic = snapshot.topics.find((t) => t.id === id);
  useEffect(() => {
    if (id)
      update((s) => ({
        ...s,
        preferences: { ...s.preferences, lastTopicId: id },
      }));
  }, [id, update]);
  if (!topic) return <p>That topic is absent from this version.</p>;
  const children = snapshot.topics.filter((t) => t.parentId === id);
  return (
    <>
      <div className="page-heading">
        <div>
          <button className="text-link" onClick={() => go({ view: 'topics' })}>
            ← Roadmap
          </button>
          <h1>{topic.title}</h1>
          <p>
            {topic.description ||
              'Your notes and practice, organized around this part of the roadmap.'}
          </p>
        </div>
        <Button
          variant={
            state.topicStatus[topic.id] === 'complete' ? 'secondary' : 'default'
          }
          onClick={() =>
            update((s) => ({
              ...s,
              topicStatus: {
                ...s.topicStatus,
                [topic.id]:
                  s.topicStatus[topic.id] === 'complete'
                    ? 'learning'
                    : 'complete',
              },
            }))
          }
        >
          <Check />
          {state.topicStatus[topic.id] === 'complete'
            ? 'Completed'
            : 'Mark complete'}
        </Button>
      </div>
      {!!children.length && (
        <div className="topic-grid compact">
          {children.map((t, i) => (
            <TopicCard key={t.id} topic={t} index={i} state={state} go={go} />
          ))}
        </div>
      )}
      <div className="topic-content-grid">
        <section className="panel">
          <div className="section-title">
            <h2>Documentation & examples</h2>
            <span className="subtle-tag">{topic.documents.length} files</span>
          </div>
          <div className="document-list">
            {topic.documents
              .map((p) => snapshot.documents.find((d) => d.path === p)!)
              .filter(Boolean)
              .map((d) => (
                <button
                  key={d.path}
                  onClick={() => go({ view: 'document', path: d.path })}
                >
                  <BookOpen size={17} />
                  <span>
                    {d.title}
                    <small>{d.path.split('/').slice(-2).join('/')}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
          </div>
          {!topic.documents.length && (
            <p className="empty-copy">
              No authored notes here yet. Start with the roadmap resources.
            </p>
          )}
        </section>
        <aside>
          <section className="panel">
            <h2>Practice</h2>
            {topic.exercises.map((id) => {
              const e = snapshot.exercises.find((x) => x.id === id)!;
              return (
                <button
                  className="resource-link"
                  key={id}
                  onClick={() => go({ view: 'practice', exercise: id })}
                >
                  <Code2 size={16} />
                  {e.title}
                  <ArrowUpRight size={14} />
                </button>
              );
            })}
            {!topic.exercises.length && (
              <p className="empty-copy">
                Exercises will appear as you add them to NeoLearning.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Roadmap resources</h2>
            {topic.resources.map((r, i) => (
              <a
                className="resource-link"
                key={i}
                href={r.url}
                target="_blank"
                rel="noreferrer"
              >
                {r.title}
                <ArrowUpRight size={14} />
              </a>
            ))}
            {!topic.resources.length && (
              <p className="empty-copy">
                Explore the subtopics for learning resources.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Your time target</h2>
            <label className="field-label">
              Minutes for this topic
              <Input
                type="number"
                min="1"
                max="1440"
                value={state.topicTargets[topic.id] ?? ''}
                onChange={(e) =>
                  update((s) => {
                    const topicTargets = { ...s.topicTargets };
                    if (e.target.value)
                      topicTargets[topic.id] = Math.max(
                        1,
                        Math.min(1440, Number(e.target.value)),
                      );
                    else delete topicTargets[topic.id];
                    return { ...s, topicTargets };
                  })
                }
              />
            </label>
          </section>
          {!!topic.prerequisites.length && (
            <section className="panel">
              <h2>Prerequisites</h2>
              {topic.prerequisites.map((id) => (
                <button
                  className="resource-link"
                  key={id}
                  onClick={() => go({ view: 'topic', topic: id })}
                >
                  {snapshot.topics.find((t) => t.id === id)?.title ?? id}
                </button>
              ))}
            </section>
          )}
          <section className="panel">
            <h2>Recent changes</h2>
            {snapshot.changes
              .filter((c) => topic.documents.includes(c.path))
              .slice(0, 8)
              .map((c) => (
                <button
                  className="resource-link"
                  key={c.path}
                  onClick={() => go({ view: 'document', path: c.path })}
                >
                  <span className={`change-${c.status}`}>{c.status}</span>
                  {c.path.split('/').at(-1)}
                </button>
              ))}
            {!snapshot.changes.some((c) =>
              topic.documents.includes(c.path),
            ) && (
              <p className="empty-copy">
                No published file changes in this snapshot.
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
