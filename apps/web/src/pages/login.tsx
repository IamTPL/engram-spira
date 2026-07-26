import { createSignal, Show, type Component } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import AuthFrame from '@/components/auth/auth-frame';
import { login } from '@/stores/auth.store';
import { getApiError } from '@/api/client';
import { Mail, Lock } from 'lucide-solid';

const LoginPage: Component = () => {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email(), password());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : getApiError(err) || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame
      title="Welcome back"
      description="Sign in to continue your review queue and focus sessions."
    >
      <form onSubmit={handleSubmit} class="space-y-5">
        <Show when={error()}>
          <Alert variant="destructive">{error()}</Alert>
        </Show>

        <div class="space-y-2">
          <label class="text-sm font-medium" for="email">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            required
            error={!!error()}
            iconLeft={<Mail class="h-4 w-4" />}
          />
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4">
            <label class="text-sm font-medium" for="password">
              Password
            </label>
            <A
              href="/reset-password"
              class="text-xs font-medium text-foreground hover:underline"
            >
              Forgot password?
            </A>
          </div>
          <Input
            id="password"
            type="password"
            autocomplete="current-password"
            placeholder="Enter your password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            required
            error={!!error()}
            iconLeft={<Lock class="h-4 w-4" />}
          />
        </div>

        <Button type="submit" class="w-full" loading={loading()}>
          Sign in
        </Button>

        <p class="text-center text-sm text-muted-foreground">
          Don't have an account?{' '}
          <A href="/register" class="font-medium text-foreground hover:underline">
            Create one
          </A>
        </p>
      </form>
    </AuthFrame>
  );
};

export default LoginPage;
