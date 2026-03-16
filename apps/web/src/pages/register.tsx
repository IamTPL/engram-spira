import { createSignal, createMemo, Show, type Component } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { register } from '@/stores/auth.store';
import { Mail, Lock, ShieldCheck } from 'lucide-solid';

const RegisterPage: Component = () => {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  const passwordStrength = createMemo(() => {
    const pw = password();
    if (!pw) return { score: 0, label: '', variant: 'default' as const };
    let score = 0;
    if (pw.length >= 8) score += 25;
    if (pw.length >= 12) score += 15;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 20;
    if (/[0-9]/.test(pw)) score += 20;
    if (/[^a-zA-Z0-9]/.test(pw)) score += 20;
    if (score <= 25)
      return { score, label: 'Weak', variant: 'destructive' as const };
    if (score <= 50)
      return { score, label: 'Fair', variant: 'warning' as const };
    if (score <= 75)
      return { score, label: 'Good', variant: 'default' as const };
    return { score, label: 'Strong', variant: 'success' as const };
  });

  const passwordMismatch = createMemo(
    () => confirmPassword().length > 0 && password() !== confirmPassword(),
  );

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
    <div class="min-h-screen flex items-center justify-center px-4 bg-section-gradient">
      <Card class="w-full max-w-sm animate-scale-in" variant="elevated">
        <CardHeader class="text-center items-center">
          <img
            src="/logo-engram-full.webp"
            alt="Engram Spira"
            class="h-20 w-auto mb-2"
          />
          <CardTitle class="text-xl">Create Account</CardTitle>
          <CardDescription>Start learning with flashcards</CardDescription>
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
                autocomplete="new-password"
                placeholder="At least 8 characters"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
                iconLeft={<Lock class="h-4 w-4" />}
              />
              <Show when={password().length > 0}>
                <div class="space-y-1">
                  <Progress
                    value={passwordStrength().score}
                    variant={passwordStrength().variant}
                    size="sm"
                  />
                  <p class="text-xs text-muted-foreground">
                    Password strength:{' '}
                    <span class="font-medium">{passwordStrength().label}</span>
                  </p>
                </div>
              </Show>
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium" for="confirm-password">
                Confirm Password
              </label>
              <Input
                id="confirm-password"
                type="password"
                autocomplete="new-password"
                placeholder="Re-enter password"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                required
                error={passwordMismatch()}
                iconLeft={<ShieldCheck class="h-4 w-4" />}
              />
              <Show when={passwordMismatch()}>
                <p class="text-xs text-destructive">Passwords do not match</p>
              </Show>
            </div>
          </CardContent>
          <CardFooter class="flex-col gap-3">
            <Button type="submit" class="w-full" loading={loading()}>
              Create account
            </Button>
            <p class="text-sm text-muted-foreground">
              Already have an account?{' '}
              <A href="/login" class="text-primary font-medium hover:underline">
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
