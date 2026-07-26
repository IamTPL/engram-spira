import { type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Home, SearchX } from 'lucide-solid';

const NotFoundPage: Component = () => {
  const navigate = useNavigate();
  return (
    <main class="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-12 text-center">
      <div class="animate-scale-in w-full max-w-md">
        <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border bg-card shadow-xs">
          <SearchX class="h-5 w-5 text-foreground" />
        </div>
        <p class="mt-8 select-none font-mono text-sm font-semibold tracking-[0.22em] text-muted-foreground">
          404
        </p>
        <h1 class="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Page not found
        </h1>
        <p class="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button onClick={() => navigate('/')} class="mt-7">
          <Home class="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    </main>
  );
};

export default NotFoundPage;
