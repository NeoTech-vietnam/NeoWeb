'use client';
import { useState, useSyncExternalStore, lazy, Suspense } from 'react';
import {
  Lightbulb,
  BookOpen,
  Code2,
  GitCompare,
  ArrowLeft,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Markdown } from './markdown';
import { useBlob } from './data';
import type { SnapshotManifest, ExerciseRecord } from '@/lib/content-schema';
import {
  draftKey,
  saveDraft,
  recordReview,
  type LearningStateV1,
  type Rating,
} from '@/lib/learning-state';
import type { UpdateState, Go } from './dashboard';
const Editor = lazy(() => import('./code-editor'));
const mobileQuery = '(max-width: 1020px)';
const subscribeLayout = (notify: () => void) => {
  const query = matchMedia(mobileQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
type Props = {
  snapshot: SnapshotManifest;
  exerciseId?: string;
  state: LearningStateV1;
  update: UpdateState;
  go: Go;
};
export default function Practice(props: Props) {
  const [query, setQuery] = useState('');
  const exercise = props.snapshot.exercises.find(
    (e) => e.id === props.exerciseId,
  );
  return exercise ? (
    <Exercise
      key={`${props.snapshot.sha}:${exercise.id}`}
      {...props}
      exercise={exercise}
    />
  ) : (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRACTICE LAB</span>
          <h1>Think it through. Make it yours.</h1>
          <p>
            A quiet place to reason about code, with your notes one glance away.
          </p>
        </div>
        <span className="subtle-tag">C / C++ · No compilation</span>
      </div>
      <Input
        className="topic-filter"
        aria-label="Find an exercise"
        placeholder="Search exercises…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="exercise-grid">
        {props.snapshot.exercises
          .filter((e) => e.title.toLowerCase().includes(query.toLowerCase()))
          .map((e) => (
            <button
              className="panel exercise-card"
              key={e.id}
              onClick={() => props.go({ view: 'practice', exercise: e.id })}
            >
              <span className="topic-icon">
                <Code2 />
              </span>
              <h2>{e.title}</h2>
              <p>
                {props.snapshot.topics.find((t) => t.id === e.topicId)?.title ??
                  'Example study'}
              </p>
              <div className="inline-meta">
                <span>
                  {Object.keys(e.solutions).join(' / ').toUpperCase()}
                </span>
                <span>
                  {e.hintHashes.length
                    ? `${e.hintHashes.length} hints`
                    : 'Source reveal'}
                </span>
                {props.state.reviews[e.id] && (
                  <span>
                    Review{' '}
                    {new Date(
                      props.state.reviews[e.id].dueAt,
                    ).toLocaleDateString()}
                  </span>
                )}
              </div>
            </button>
          ))}
      </div>
    </>
  );
}
function Exercise({
  snapshot,
  exercise,
  state,
  update,
  go,
}: Props & { exercise: ExerciseRecord }) {
  const mobile = useSyncExternalStore(
    subscribeLayout,
    () => matchMedia(mobileQuery).matches,
    () => false,
  );
  const [language, setLanguage] = useState<'c' | 'cpp'>(
    exercise.solutions.c ? 'c' : 'cpp',
  );
  const [mode, setMode] = useState<'edit' | 'solution' | 'diff'>('edit');
  const [docsOpen, setDocsOpen] = useState(false);
  const [confidence, setConfidence] = useState(3);
  const [correct, setCorrect] = useState('unassessed');
  const [saved, setSaved] = useState('');
  const key = draftKey(exercise.id, snapshot.sha, language);
  const draft = state.drafts[key];
  const value = draft?.source ?? '';
  const revealed = draft?.revealedHints ?? 0;
  const solution = snapshot.documents.find(
    (d) => d.path === exercise.solutions[language],
  );
  const source = useBlob(mode !== 'edit' ? solution?.contentHash : undefined);
  const document = snapshot.documents.find(
    (d) => d.path === exercise.documentationPath,
  );
  const save = (text: string, hints = revealed) =>
    update((s) =>
      saveDraft(s, {
        exerciseId: exercise.id,
        snapshot: snapshot.sha,
        language,
        source: text,
        revealedHints: hints,
      }),
    );
  const reveal = () => {
    if (revealed < exercise.hintHashes.length) save(value, revealed + 1);
    else setMode('solution');
  };
  const rate = (rating: Rating) => {
    update((s) =>
      recordReview(s, {
        exerciseId: exercise.id,
        snapshot: snapshot.sha,
        rating,
        correct: correct === 'unassessed' ? null : correct === 'correct',
        confidence,
      }),
    );
    setSaved('Review saved. Your next review is scheduled.');
  };
  const notePane = (
    <div className="practice-notes">
      <div className="pane-label">
        <BookOpen size={14} /> PROBLEM & NOTES
      </div>
      <Markdown hash={exercise.promptHash} snapshot={snapshot.sha} />
      {exercise.hintHashes.slice(0, revealed).map((hash, i) => (
        <section className="hint-section" key={hash}>
          <span className="eyebrow">
            <Lightbulb size={14} /> HINT {i + 1}
          </span>
          <Markdown hash={hash} snapshot={snapshot.sha} />
        </section>
      ))}
    </div>
  );
  const editorPane = (
    <div className="practice-editor">
      <div className="pane-label">
        <Code2 size={14} />
        {mode === 'edit'
          ? 'YOUR SCRATCHPAD'
          : mode === 'diff'
            ? 'REPOSITORY ← → YOUR ATTEMPT'
            : 'REPOSITORY SOLUTION'}
        <span>{language.toUpperCase()}</span>
      </div>
      <div className="editor-body">
        <Suspense fallback={<p className="empty-copy">Loading editor…</p>}>
          <Editor
            key={`${key}:${mode}`}
            language={language}
            value={mode === 'solution' ? (source.value?.source ?? '') : value}
            onChange={(text) => save(text)}
            original={
              mode === 'diff' ? (source.value?.source ?? '') : undefined
            }
            readOnly={mode !== 'edit'}
          />
        </Suspense>
      </div>
      <div className="editor-status">
        <span className="status-dot" /> Draft saved on this device ·{' '}
        {snapshot.sha.slice(0, 7)}
        <span>{value.split('\n').length} lines</span>
      </div>
    </div>
  );
  return (
    <>
      <div className="practice-heading">
        <button className="text-link" onClick={() => go({ view: 'practice' })}>
          <ArrowLeft size={16} /> All exercises
        </button>
        <h1>{exercise.title}</h1>
        <div className="practice-toolbar">
          <Tabs
            value={language}
            onValueChange={(v) => setLanguage(v as 'c' | 'cpp')}
          >
            <TabsList>
              {exercise.solutions.c && <TabsTrigger value="c">C</TabsTrigger>}
              {exercise.solutions.cpp && (
                <TabsTrigger value="cpp">C++</TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          <Button variant="outline" onClick={reveal}>
            <Lightbulb />
            {revealed < exercise.hintHashes.length
              ? `Hint ${revealed + 1}/${exercise.hintHashes.length}`
              : 'Reveal solution'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setMode(mode === 'diff' ? 'edit' : 'diff')}
          >
            <GitCompare />
            {mode === 'diff' ? 'Edit attempt' : 'Compare solution'}
          </Button>
          {mode === 'solution' && (
            <Button variant="ghost" onClick={() => setMode('edit')}>
              Back to draft
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={!document}
            onClick={() => setDocsOpen(true)}
          >
            <BookOpen /> Documentation
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const blob = new Blob([value], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = window.document.createElement('a');
              a.href = url;
              a.download = `attempt.${language}`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            aria-label="Download your attempt"
          >
            <Download />
          </Button>
        </div>
      </div>
      {mobile ? (
        <div className="practice-mobile">
          <Tabs defaultValue="notes">
            <TabsList>
              <TabsTrigger value="notes">Problem & notes</TabsTrigger>
              <TabsTrigger value="editor">Your code</TabsTrigger>
            </TabsList>
            <TabsContent value="notes">{notePane}</TabsContent>
            <TabsContent value="editor" keepMounted>
              {editorPane}
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="practice-desktop">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="45%" minSize="25%">
              {notePane}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="55%" minSize="25%">
              {editorPane}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
      <section className="panel self-review">
        <div>
          <span className="eyebrow">CLOSE THE LOOP</span>
          <h2>How did that feel?</h2>
          <p>Your assessment schedules the next review.</p>
        </div>
        <label className="field-label">
          Correctness
          <select value={correct} onChange={(e) => setCorrect(e.target.value)}>
            <option value="unassessed">Not assessed</option>
            <option value="correct">I believe it is correct</option>
            <option value="incorrect">Needs more work</option>
          </select>
        </label>
        <label className="field-label">
          Confidence (1–5)
          <Input
            type="number"
            min="1"
            max="5"
            value={confidence}
            onChange={(e) =>
              setConfidence(Math.max(1, Math.min(5, Number(e.target.value))))
            }
          />
        </label>
        <div className="rating-buttons">
          {(['again', 'hard', 'good', 'easy'] as const).map((r) => (
            <Button key={r} variant="outline" onClick={() => rate(r)}>
              {r[0].toUpperCase() + r.slice(1)}
            </Button>
          ))}
        </div>
        {saved && <p role="status">{saved}</p>}
      </section>
      <Dialog open={docsOpen} onOpenChange={setDocsOpen}>
        <DialogContent className="docs-dialog">
          <DialogTitle>{document?.title ?? 'Documentation'}</DialogTitle>
          <DialogDescription>
            Reference material for this exercise.
          </DialogDescription>
          {document && (
            <Markdown hash={document.contentHash} snapshot={snapshot.sha} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
