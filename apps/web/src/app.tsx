import { type Component, Show, onMount } from 'solid-js';
import { Router, Route, Navigate } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { queryClient } from '@/lib/query-client';
import { currentUser, isLoading, fetchCurrentUser } from '@/stores/auth.store';
import Toaster from '@/components/ui/toaster';
import FocusDrawer from '@/components/focus/focus-drawer';
import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import DashboardPage from '@/pages/dashboard';
import StudyModePage from '@/pages/study-mode';
import DeckViewPage from '@/pages/deck-view';
import SettingsPage from '@/pages/settings';
import FeedbackPage from '@/pages/feedback';
import NotFoundPage from '@/pages/not-found';

const ProtectedRoute: Component<{ children: any }> = (props) => {
  return (
    <Show
      when={!isLoading()}
      fallback={
        <div class="min-h-screen flex items-center justify-center">
          <p class="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <Show when={currentUser()} fallback={<Navigate href="/login" />}>
        {props.children}
      </Show>
    </Show>
  );
};

const GuestRoute: Component<{ children: any }> = (props) => {
  return (
    <Show
      when={!isLoading()}
      fallback={
        <div class="min-h-screen flex items-center justify-center">
          <p class="text-muted-foreground">Loading...</p>
        </div>
      }
    >
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
        <Route
          path="/"
          component={() => (
            <ProtectedRoute>
              <DashboardPage />
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
        <Route path="*" component={NotFoundPage} />
      </Router>
      <Toaster />
      <FocusDrawer />
    </QueryClientProvider>
  );
};

export default App;
