import { type Component, Show, lazy, onMount } from 'solid-js';
import { Router, Route, Navigate } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { queryClient } from '@/lib/query-client';
import { currentUser, isLoading, fetchCurrentUser } from '@/stores/auth.store';
import AppErrorBoundary from '@/components/ui/app-error-boundary';
import Toaster from '@/components/ui/toaster';
import FocusDrawer from '@/components/focus/focus-drawer';
import RouteAnnouncer from '@/components/route-announcer';
import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import ResetPasswordPage from '@/pages/reset-password';
import DashboardPage from '@/pages/dashboard';
import NotFoundPage from '@/pages/not-found';
import FeedbackPage from '@/pages/feedback';
import FolderViewPage from '@/pages/folder-view';

const StudyModePage = lazy(() => import('@/pages/study-mode'));
const DeckViewPage = lazy(() => import('@/pages/deck-view'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const DocsPage = lazy(() => import('@/pages/docs'));
const InterleavedStudyPage = lazy(() => import('@/pages/interleaved-study'));

const LoadingScreen = () => (
  <div class="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
    <img
      src="/logo-engram.png"
      alt="Engram Spira"
      class="h-10 w-auto opacity-60 animate-pulse"
    />
    <div class="flex items-center gap-2 text-muted-foreground text-sm">
      <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="3"
        />
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      Loading...
    </div>
  </div>
);

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

const App: Component = () => {
  onMount(() => {
    fetchCurrentUser();
  });

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Router>
          <Route
            path="/login"
            component={() => (
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            )}
          />
          <Route
            path="/register"
            component={() => (
              <GuestRoute>
                <RegisterPage />
              </GuestRoute>
            )}
          />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route
            path="/"
            component={() => (
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/folder/:folderId"
            component={() => (
              <ProtectedRoute>
                <FolderViewPage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/deck/:deckId"
            component={() => (
              <ProtectedRoute>
                <DeckViewPage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/study/interleaved"
            component={() => (
              <ProtectedRoute>
                <InterleavedStudyPage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/study/:deckId"
            component={() => (
              <ProtectedRoute>
                <StudyModePage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/settings"
            component={() => (
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/feedback"
            component={() => (
              <ProtectedRoute>
                <FeedbackPage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/docs"
            component={() => (
              <ProtectedRoute>
                <DocsPage />
              </ProtectedRoute>
            )}
          />
          <Route path="*" component={NotFoundPage} />
        </Router>
        <RouteAnnouncer />
        <Toaster />
        <FocusDrawer />
      </QueryClientProvider>
    </AppErrorBoundary>
  );
};

export default App;
