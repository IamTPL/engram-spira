import { createSignal, type Component } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { register } from '@/stores/auth.store';

const RegisterPage: Component = () => {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (password() !== confirmPassword()) {
      setError('Passwords do not match');
      return;
    }
    if (password().length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await register(email(), password());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
            class="h-20 w-auto mb-2"
          />
          <CardTitle class="text-xl">Create Account</CardTitle>
          <CardDescription>Start learning with flashcards</CardDescription>
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
                placeholder="At least 8 characters"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
              />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium" for="confirm-password">
                Confirm Password
              </label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Re-enter password"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter class="flex-col gap-2">
            <Button type="submit" class="w-full" disabled={loading()}>
              {loading() ? 'Creating account...' : 'Create account'}
            </Button>
            <p class="text-sm text-muted-foreground">
              Already have an account?{' '}
              <A href="/login" class="text-palette-5 underline">
                Sign in
              </A>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default RegisterPage;
