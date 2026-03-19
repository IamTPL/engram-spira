import { type Component, Show, lazy, onMount, Suspense } from 'solid-js';
import { Router, Route, Navigate } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { queryClient } from '@/lib/query-client';
import { currentUser, isLoading, fetchCurrentUser } from '@/stores/auth.store';
import AppErrorBoundary from '@/components/ui/app-error-boundary';
import Spinner from '@/components/ui/spinner';
import Toaster from '@/components/ui/toaster';
import RouteAnnouncer from '@/components/route-announcer';

// Direct imports for critical-path pages (login, register, dashboard)
// to avoid lazy-load Suspense interaction with the Router
import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import ResetPasswordPage from '@/pages/reset-password';
import VerifyEmailPage from '@/pages/verify-email';
import DashboardPage from '@/pages/dashboard';

// Lazy-load secondary pages for code splitting
const FeedbackPage = lazy(() => import('@/pages/feedback'));
const FolderViewPage = lazy(() => import('@/pages/folder-view'));
const StudyModePage = lazy(() => import('@/pages/study-mode'));
const DeckViewPage = lazy(() => import('@/pages/deck-view'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const DocsPage = lazy(() => import('@/pages/docs'));
const InterleavedStudyPage = lazy(() => import('@/pages/interleaved-study'));
const NotFoundPage = lazy(() => import('@/pages/not-found'));

// Lazy-load FocusDrawer — it pulls in Three.js (~500KB) via reward popup
const FocusDrawer = lazy(() => import('@/components/focus/focus-drawer'));

// Lazy-load GlobalSearch — only loaded when user presses Cmd+K
const GlobalSearch = lazy(() => import('@/components/search/global-search'));

const LoadingScreen = () => (
  <div class="min-h-screen flex items-center justify-center bg-background">
    <Spinner size="lg" />
  </div>
);

// Stable wrapper components — defined once, not inline per-route
const ProtectedRoute: Component<{ children: any }> = (props) => {
  return (
    <Show when={!isLoading()} fallback={<LoadingScreen />}>
      <Show when={currentUser()} fallback={<Navigate href="/login" />}>
        {props.children}
      </Show>
    </Show>
  );
};

const GuestRoute: Component<{ children: any }> = (props) => {
  return (
    <Show when={!isLoading()} fallback={<LoadingScreen />}>
      <Show when={!currentUser()} fallback={<Navigate href="/" />}>
        {props.children}
      </Show>
    </Show>
  );
};

// Stable route wrapper factories — avoids recreating component functions on navigation
const guest = (Page: Component) => () => (
  <GuestRoute>
    <Page />
  </GuestRoute>
);

const protect = (Page: Component) => () => (
  <ProtectedRoute>
    <Page />
  </ProtectedRoute>
);

const App: Component = () => {
  onMount(() => {
    fetchCurrentUser();
  });

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Router
          root={(props) => (
            <>
              {props.children}
              <RouteAnnouncer />
              <Toaster />
              <Suspense>
                <FocusDrawer />
                <GlobalSearch />
              </Suspense>
            </>
          )}
        >
          <Route path="/login" component={guest(LoginPage)} />
          <Route path="/register" component={guest(RegisterPage)} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/verify-email" component={VerifyEmailPage} />
          <Route path="/" component={protect(DashboardPage)} />
          <Route path="/folder/:folderId" component={protect(FolderViewPage)} />
          <Route path="/deck/:deckId" component={protect(DeckViewPage)} />
          <Route
            path="/study/interleaved"
            component={protect(InterleavedStudyPage)}
          />
          <Route path="/study/:deckId" component={protect(StudyModePage)} />
          <Route path="/settings" component={protect(SettingsPage)} />
          <Route path="/feedback" component={protect(FeedbackPage)} />
          <Route path="/docs" component={protect(DocsPage)} />
          <Route path="*" component={NotFoundPage} />
        </Router>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
};

export default App;
