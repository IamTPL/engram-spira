import { type Component, type JSX, createSignal } from 'solid-js';

interface AppErrorBoundaryProps {
  children: JSX.Element;
}

const AppErrorBoundary: Component<AppErrorBoundaryProps> = (props) => {
  const [error, setError] = createSignal<Error | null>(null);

  return (
    <ErrorBoundaryWrapper error={error()} setError={setError}>
      {props.children}
    </ErrorBoundaryWrapper>
  );
};

/**
 * Thin wrapper using SolidJS <ErrorBoundary>.
 * Catches render errors and shows a friendly fallback UI.
 */
import { ErrorBoundary } from 'solid-js';

const ErrorBoundaryWrapper: Component<{
  error: Error | null;
  setError: (e: Error | null) => void;
  children: JSX.Element;
}> = (props) => {
  return (
    <ErrorBoundary
      fallback={(err, reset) => (
        <div class="min-h-screen flex items-center justify-center bg-background">
          <div class="max-w-md w-full p-8 text-center space-y-4">
            <div class="text-5xl">💥</div>
            <h1 class="text-2xl font-bold text-foreground">
              Something went wrong
            </h1>
            <p class="text-muted-foreground text-sm">
              {err?.message || 'An unexpected error occurred.'}
            </p>
            <div class="flex gap-3 justify-center pt-2">
              <button
                onClick={() => reset()}
                class="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => (window.location.href = '/')}
                class="px-4 py-2 rounded-md border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
};

export default AppErrorBoundary;
