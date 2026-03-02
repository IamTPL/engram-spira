import { type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-solid';

const NotFoundPage: Component = () => {
  const navigate = useNavigate();
  return (
    <div class="min-h-screen flex flex-col items-center justify-center gap-4 text-center p-8">
      <p class="text-8xl font-black text-muted-foreground/30">404</p>
      <h1 class="text-2xl font-bold">Page not found</h1>
      <p class="text-muted-foreground max-w-sm">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button onClick={() => navigate('/')}>
        <Home class="h-4 w-4 mr-2" />
        Back to Dashboard
      </Button>
    </div>
  );
};

export default NotFoundPage;
