'use client';
import { useEffect, useState, lazy, Suspense } from 'react';
import {
  Orbit,
  LayoutDashboard,
  Compass,
  FolderTree,
  Code2,
  GitBranch,
  Settings,
  Search,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { useCatalog, useSnapshot } from '@/components/portal/data';
import { href, parseRoute, type Route } from '@/lib/routes';
import { useLearningState } from '@/lib/use-learning-state';
import { Dashboard, Topics, Topic } from '@/components/portal/dashboard';
import {
  SettingsView,
  initializeIntegrations,
} from '@/components/portal/personal';
const Library = lazy(() => import('@/components/portal/library'));
const Practice = lazy(() => import('@/components/portal/practice'));
const Versions = lazy(() => import('@/components/portal/versions'));
const nav = [
  ['dashboard', 'Mission control', LayoutDashboard],
  ['topics', 'Explore roadmap', Compass],
  ['library', 'Knowledge library', FolderTree],
  ['practice', 'Practice lab', Code2],
  ['versions', 'Version explorer', GitBranch],
] as const;
export default function Portal() {
  const [route, setRoute] = useState<Route>({ view: 'dashboard' });
  const [query, setQuery] = useState('');
  const catalog = useCatalog();
  const selected = route.snapshot ?? catalog.value?.defaultSnapshot;
  const snapshot = useSnapshot(selected);
  const learning = useLearningState();
  useEffect(() => {
    const change = () => setRoute(parseRoute(location.hash));
    change();
    window.addEventListener('hashchange', change);
    void initializeIntegrations().then(change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = learning.state.preferences
      .reducedMotion
      ? 'reduced'
      : 'full';
  }, [learning.state.preferences.reducedMotion]);
  const go = (next: Route) => {
    location.hash = href({
      ...next,
      snapshot: next.snapshot ?? selected,
    }).slice(1);
    setQuery('');
  };
  const data = snapshot.value;
  const groups = data?.topics.filter((t) => !t.parentId) ?? [];
  const viewTitle =
    route.view === 'topic'
      ? data?.topics.find((t) => t.id === route.topic)?.title
      : (nav.find((n) => n[0] === route.view)?.[1] ?? 'Your workspace');
  const active =
    route.view === 'document'
      ? 'library'
      : route.view === 'topic'
        ? 'topics'
        : route.view;
  return (
    <SidebarProvider>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="app-background" aria-hidden="true" />
      <Sidebar className="mission-sidebar">
        <SidebarHeader>
          <a
            className="brand"
            href={href({ view: 'dashboard', snapshot: selected })}
          >
            <span className="brand-mark">
              <Orbit size={27} />
            </span>
            <span>
              NEO<span className="brand-light">LEARNING</span>
              <small>YOUR LEARNING UNIVERSE</small>
            </span>
          </a>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">WORKSPACE</div>
          <SidebarMenu>
            {nav.map(([view, label, Icon]) => (
              <SidebarMenuItem key={view}>
                <SidebarMenuButton
                  isActive={active === view}
                  onClick={() => go({ view })}
                >
                  <Icon />
                  <span>{label}</span>
                  {active === view && <span className="nav-dot" />}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="nav-label nav-label-space">QUICK ACCESS</div>
          <SidebarMenu>
            {groups
              .filter((t) =>
                [
                  'programming-languages',
                  'programming-fundamentals',
                  'operating-systems',
                  'microcontrollers',
                ].includes(t.id),
              )
              .map((t, i) => (
                <SidebarMenuItem key={t.id}>
                  <SidebarMenuButton
                    onClick={() => go({ view: 'topic', topic: t.id })}
                  >
                    <span className={`color-dot color-${i}`} />
                    <span>{t.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
          <div className="sidebar-note">
            <span className="eyebrow">ONE SMALL STEP</span>
            <p>
              Build understanding.
              <br />
              One concept at a time.
            </p>
            <Orbit size={58} strokeWidth={0.6} aria-hidden="true" />
          </div>
        </SidebarContent>
        <SidebarFooter>
          <Button
            variant="ghost"
            className="settings-nav"
            onClick={() => go({ view: 'settings' })}
          >
            <Settings /> Workspace settings
          </Button>
          <div className="local-profile">
            <div className="avatar">N</div>
            <span>
              Personal workspace
              <small>
                <span className="status-dot" /> Saved on this device
              </small>
            </span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb-line">
            <SidebarTrigger />
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{viewTitle}</strong>
          </div>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              go({ view: 'library', path: query });
            }}
          >
            <Search size={16} />
            <Input
              aria-label="Search documentation"
              placeholder="Search your universe…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <button
            className="version-pill"
            onClick={() => go({ view: 'versions' })}
          >
            <GitBranch size={14} />
            {selected?.slice(0, 7) ?? 'Connecting'}
            <span className="status-dot" />
          </button>
        </header>
        <main id="main-content" tabIndex={-1} className="main-content">
          {learning.error && (
            <div className="notice" role="alert">
              {learning.error}
            </div>
          )}
          {catalog.error || snapshot.error ? (
            <div className="empty-state">
              <Orbit size={36} />
              <h1>Waiting for your learning library</h1>
              <p>{catalog.error || snapshot.error}</p>
              <Button onClick={() => location.reload()}>Try again</Button>
            </div>
          ) : !data ? (
            <div className="loading-state" role="status">
              <Orbit className="spin" />
              <p>Aligning your learning universe…</p>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="loading-state" role="status">
                  Loading workspace…
                </div>
              }
            >
              {route.view === 'dashboard' && (
                <Dashboard
                  snapshot={data}
                  state={learning.state}
                  update={learning.update}
                  go={go}
                />
              )}
              {route.view === 'topics' && (
                <Topics snapshot={data} state={learning.state} go={go} />
              )}
              {route.view === 'topic' && (
                <Topic
                  snapshot={data}
                  id={route.topic}
                  state={learning.state}
                  update={learning.update}
                  go={go}
                />
              )}
              {(route.view === 'library' || route.view === 'document') && (
                <Library
                  snapshot={data}
                  published={catalog.value?.snapshots.map((s) => s.sha) ?? []}
                  route={route}
                  go={go}
                />
              )}
              {route.view === 'practice' && (
                <Practice
                  snapshot={data}
                  exerciseId={route.exercise}
                  state={learning.state}
                  update={learning.update}
                  go={go}
                />
              )}
              {route.view === 'versions' && catalog.value && (
                <Versions catalog={catalog.value} snapshot={data} go={go} />
              )}
              {route.view === 'settings' && (
                <SettingsView state={learning.state} update={learning.update} />
              )}
            </Suspense>
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            <span className="status-dot" /> YOUR PROGRESS, YOUR ORBIT
          </span>
          <span>
            NeoLearning · {selected?.slice(0, 7)} ·{' '}
            {data?.documents.length ?? 0} files
          </span>
        </footer>
      </div>
    </SidebarProvider>
  );
}
