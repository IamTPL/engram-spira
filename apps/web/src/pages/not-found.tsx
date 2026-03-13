import { type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Home, SearchX } from 'lucide-solid';

const NotFoundPage: Component = () => {
  const navigate = useNavigate();
  return (
    <div class="min-h-screen flex flex-col items-center justify-center gap-6 text-center p-8 bg-section-gradient">
      <div class="animate-scale-in flex flex-col items-center gap-4">
        <div class="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
          <SearchX class="h-10 w-10 text-muted-foreground" />
        </div>
        <p class="text-7xl font-black text-muted-foreground/20 select-none">
          404
        </p>
        <h1 class="text-2xl font-bold">Page not found</h1>
        <p class="text-muted-foreground max-w-sm text-sm">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button onClick={() => navigate('/')} class="mt-2">
          <Home class="h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
};

export default NotFoundPage;
