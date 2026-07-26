import { type Component, type JSX, ErrorBoundary } from 'solid-js';
import { AlertTriangle } from 'lucide-solid';
import { Button } from '@/components/ui/button';

interface AppErrorBoundaryProps {
  children: JSX.Element;
}

const AppErrorBoundary: Component<AppErrorBoundaryProps> = (props) => {
  return (
    <ErrorBoundary
      fallback={(err, reset) => (
        <div class="flex min-h-[100dvh] items-center justify-center bg-background p-5">
          <div class="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-md sm:p-8">
            <div class="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-destructive/20 bg-destructive-surface text-destructive">
              <AlertTriangle class="h-5 w-5" />
            </div>
            <h1 class="text-xl font-semibold tracking-tight text-foreground">
              Something went wrong
            </h1>
            <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
              {err?.message || 'An unexpected error occurred.'}
            </p>
            <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
              <Button
                variant="outline"
                class="w-full sm:w-auto"
                onClick={() => (window.location.href = '/')}
              >
                Go home
              </Button>
              <Button class="w-full sm:w-auto" onClick={() => reset()}>
                Try again
              </Button>
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
