import { createSignal, Show, type Component } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { login } from '@/stores/auth.store';
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
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center px-4 bg-section-gradient">
      <Card class="w-full max-w-sm animate-scale-in" variant="elevated">
        <CardHeader class="text-center items-center">
          <img
            src="/logo-engram-full.png"
            alt="Engram Spira"
            class="h-40 w-auto mb-2"
          />
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent class="space-y-4">
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
              <label class="text-sm font-medium" for="password">
                Password
              </label>
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
              <div class="text-right">
                <A
                  href="/reset-password"
                  class="text-xs text-palette-5 hover:underline"
                >
                  Forgot password?
                </A>
              </div>
            </div>
          </CardContent>
          <CardFooter class="flex-col gap-3">
            <Button type="submit" class="w-full" loading={loading()}>
              Sign in
            </Button>
            <p class="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <A
                href="/register"
                class="text-primary font-medium hover:underline"
              >
                Sign up
              </A>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default LoginPage;
