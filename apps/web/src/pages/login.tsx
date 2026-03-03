import { createSignal, type Component } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { login } from '@/stores/auth.store';

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
    <div class="min-h-screen flex items-center justify-center px-4">
      <Card class="w-full max-w-sm">
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
            {error() && (
              <div class="text-sm text-destructive text-center">{error()}</div>
            )}
            <div class="space-y-2">
              <label class="text-sm font-medium" for="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required
              />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium" for="password">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter class="flex-col gap-2">
            <Button type="submit" class="w-full" disabled={loading()}>
              {loading() ? 'Signing in...' : 'Sign in'}
            </Button>
            <p class="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <A href="/register" class="text-primary underline">
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
