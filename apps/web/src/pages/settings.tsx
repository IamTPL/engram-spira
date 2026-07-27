import {
  type Component,
  Show,
  For,
  createSignal,
  createEffect,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { createQuery, createMutation } from '@tanstack/solid-query';
import { queryClient } from '@/lib/query-client';
import PageShell from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  currentUser,
  resendVerificationEmail,
  updateProfile,
} from '@/stores/auth.store';
import {
  theme,
  setTheme,
  resolvedTheme,
  type Theme,
} from '@/stores/theme.store';
import { toast } from '@/stores/toast.store';
import { api, getApiError } from '@/api/client';
import {
  ArrowLeft,
  User,
  Palette,
  Monitor,
  Sun,
  Moon,
  Shield,
  Info,
  Check,
  Pencil,
  X,
  Loader2,
  BrainCircuit,
  Layers,
} from 'lucide-solid';
import TemplateBuilder from '@/components/templates/template-builder';

const THEME_OPTIONS: { value: Theme; label: string; icon: any }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Fetch avatar list from backend (backend reads filesystem, auto-picks up newly added files) */
async function fetchAvatars(): Promise<string[]> {
  try {
    const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
    const res = await fetch(`${API_URL}/users/avatars`);
    const data = await res.json();
    return data.avatars ?? [];
  } catch {
    return [];
  }
}

/** Render the user's avatar: shows the image if set, otherwise falls back to initials */
const AvatarDisplay: Component<{
  avatarUrl: string | null;
  email: string;
  size?: 'md' | 'lg';
}> = (props) => {
  const initials = () => {
    const name = props.email?.split('@')[0] ?? '?';
    return name.slice(0, 2).toUpperCase();
  };

  const sizeClass = () =>
    props.size === 'lg' ? 'w-25 h-25 text-2xl' : 'w-12 h-12 text-base';

  return (
    <Show
      when={props.avatarUrl}
      fallback={
        <div
          class={`${sizeClass()} flex shrink-0 items-center justify-center rounded-full bg-foreground font-semibold text-background ring-4 ring-border`}
          aria-label={`Initials for ${props.email}`}
        >
          {initials()}
        </div>
      }
    >
      <img
        src={props.avatarUrl!}
        alt={`Avatar for ${props.email}`}
        class={`${sizeClass()} shrink-0 rounded-full bg-muted object-contain p-0.5 ring-4 ring-border`}
      />
    </Show>
  );
};

const SettingsPage: Component = () => {
  const navigate = useNavigate();

  // ── Fetch avatar collection ──────────────────────────────────
  const avatarsQuery = createQuery(() => ({
    queryKey: ['avatars'],
    queryFn: fetchAvatars,
    staleTime: 5 * 60_000,
  }));
  const avatars = () => avatarsQuery.data ?? [];

  // ── SRS Algorithm preference ──────────────────────────────────
  const algorithmQuery = createQuery(() => ({
    queryKey: ['srsAlgorithm'],
    queryFn: async () => {
      const { data } = await (api.study as any).algorithm.get();
      return (data?.algorithm ?? 'sm2') as 'sm2' | 'fsrs';
    },
    staleTime: 60_000,
  }));

  const algorithmMutation = createMutation(() => ({
    mutationFn: async (algorithm: 'sm2' | 'fsrs') => {
      const { error } = await (api.study as any).algorithm.patch({ algorithm });
      if (error) throw new Error(getApiError(error));
      return algorithm;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['srsAlgorithm'] });
      toast.success('Algorithm updated!');
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to update algorithm');
    },
  }));

  // ── Profile edit state ───────────────────────────────────────────────
  const [displayName, setDisplayName] = createSignal(
    currentUser()?.displayName ?? '',
  );
  const [selectedAvatar, setSelectedAvatar] = createSignal<string | null>(
    currentUser()?.avatarUrl ?? null,
  );
  const [isSaving, setIsSaving] = createSignal(false);
  const [isDirty, setIsDirty] = createSignal(false);

  // ── Change password state ─────────────────────────────────────────
  const [showPwModal, setShowPwModal] = createSignal(false);
  const [currentPw, setCurrentPw] = createSignal('');
  const [newPw, setNewPw] = createSignal('');
  const [confirmPw, setConfirmPw] = createSignal('');
  const [pwSaving, setPwSaving] = createSignal(false);
  const [isResendingVerification, setIsResendingVerification] =
    createSignal(false);

  const handleResendVerification = async () => {
    if (isResendingVerification()) return;

    setIsResendingVerification(true);
    try {
      const result = await resendVerificationEmail();
      if (result.alreadyVerified) {
        toast.info('Your email is already verified.');
        return;
      }

      toast.success(
        'Verification request is being processed. Check your Inbox or Spam folder shortly.',
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to resend verification email. Please try again.',
      );
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPw().length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPw() !== confirmPw()) {
      toast.error('Passwords do not match');
      return;
    }
    setPwSaving(true);
    try {
      const { error } = await (api.auth as any)['change-password'].post({
        currentPassword: currentPw(),
        newPassword: newPw(),
      });
      if (error) throw new Error(getApiError(error));
      toast.success('Password changed successfully!');
      setShowPwModal(false);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to change password');
    } finally {
      setPwSaving(false);
    }
  };

  // Sync local state when currentUser changes (e.g., after initial app load completes)
  createEffect(() => {
    const user = currentUser();
    if (user) {
      setDisplayName(user.displayName ?? '');
      setSelectedAvatar(user.avatarUrl ?? null);
    }
  });

  const markDirty = () => setIsDirty(true);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await updateProfile({
        displayName: displayName().trim() || undefined,
        avatarUrl: selectedAvatar() ?? '',
      });
      setIsDirty(false);
      toast.success('Profile updated!');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelProfile = () => {
    const user = currentUser();
    setDisplayName(user?.displayName ?? '');
    setSelectedAvatar(user?.avatarUrl ?? null);
    setIsDirty(false);
  };

  return (
    <PageShell maxWidth="max-w-5xl">
      <div class="animate-fade-in space-y-10">
        {/* ── Page Header ── */}
        <header class="flex items-start gap-4 border-b pb-7">
          <Button
            variant="ghost"
            size="icon"
            class="mt-0.5 h-9 w-9 shrink-0"
            onClick={() => navigate('/')}
            aria-label="Back to dashboard"
          >
            <ArrowLeft class="h-4 w-4" />
          </Button>
          <div class="min-w-0">
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Workspace settings
            </p>
            <h1 class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Make Engram Spira yours
            </h1>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Manage your identity, study model, appearance, and account security.
            </p>
          </div>
        </header>

        {/* ── Profile Section ── */}
        <section class="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <User class="h-4 w-4 text-muted-foreground" />
              <h2 class="text-base font-semibold text-foreground">Profile</h2>
            </div>
            <p class="text-sm leading-5 text-muted-foreground">
              Choose how your name and avatar appear across the workspace.
            </p>
          </div>

          <div class="overflow-hidden rounded-xl border bg-card shadow-xs">
            {/* Current profile preview + display name */}
            <div class="flex flex-col gap-5 border-b p-5 sm:flex-row sm:items-center sm:p-6">
              <AvatarDisplay
                avatarUrl={selectedAvatar()}
                email={currentUser()?.email ?? ''}
                size="lg"
              />
              <div class="flex-1 min-w-0">
                <label
                  for="profile-display-name"
                  class="mb-2 block text-sm font-medium text-foreground"
                >
                  Display name
                </label>
                <Input
                  id="profile-display-name"
                  value={displayName()}
                  onInput={(e) => {
                    setDisplayName(e.currentTarget.value);
                    markDirty();
                  }}
                  placeholder={
                    currentUser()?.email?.split('@')[0] ?? 'Your name'
                  }
                  maxLength={50}
                  autocomplete="name"
                />
                <p class="mt-2 truncate text-xs text-muted-foreground">
                  {currentUser()?.email}
                </p>
              </div>
            </div>

            {/* Avatar collection picker */}
            <div class="p-5 sm:p-6">
              <p class="mb-4 text-sm font-medium text-foreground">
                Choose an avatar
              </p>

              <Show
                when={!avatarsQuery.isLoading}
                fallback={
                  <div
                    class="flex items-center gap-2 py-4 text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    <Loader2 class="h-4 w-4 animate-spin" />
                    Loading avatars...
                  </div>
                }
              >
                <Show
                  when={avatars().length > 0}
                  fallback={
                    <p class="py-2 text-sm text-muted-foreground">
                      No avatars found in collection.
                    </p>
                  }
                >
                  <div class="grid grid-cols-4 gap-2 min-[360px]:grid-cols-5 min-[360px]:gap-3 sm:grid-cols-8">
                    {/* Option: no avatar (show initials) */}
                    <button
                      type="button"
                      title="Remove avatar"
                      aria-label="Use initials instead of an avatar"
                      aria-pressed={selectedAvatar() === null}
                      class={`relative flex h-11 w-11 items-center justify-center rounded-full border-2 bg-muted/50 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selectedAvatar() === null
                          ? 'border-foreground ring-2 ring-foreground/15'
                          : 'border-transparent hover:border-border'
                      }`}
                      onClick={() => {
                        setSelectedAvatar(null);
                        markDirty();
                      }}
                    >
                      <X class="h-4 w-4" />
                      <Show when={selectedAvatar() === null}>
                        <span class="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                          <Check class="h-2.5 w-2.5" />
                        </span>
                      </Show>
                    </button>

                    {/* Avatar thumbnails */}
                    <For each={avatars()}>
                      {(url) => (
                        <button
                          type="button"
                          title={url.split('/').pop()}
                          aria-label={`Choose avatar ${url.split('/').pop() ?? ''}`}
                          aria-pressed={selectedAvatar() === url}
                          class={`relative h-11 w-11 overflow-hidden rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            selectedAvatar() === url
                              ? 'border-foreground ring-2 ring-foreground/15'
                              : 'border-transparent hover:border-muted-foreground/40'
                          }`}
                          onClick={() => {
                            setSelectedAvatar(url);
                            markDirty();
                          }}
                        >
                          <img
                            src={url}
                            alt={url.split('/').pop()}
                            class="w-full h-full object-cover"
                          />
                          <Show when={selectedAvatar() === url}>
                            <span class="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                              <Check class="h-2.5 w-2.5" />
                            </span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>

              {/* Upload hint */}
              <p class="mt-4 text-xs text-muted-foreground">
                Custom avatar upload coming soon.
              </p>
            </div>

            {/* Save / Cancel buttons */}
            <Show when={isDirty()}>
              <div class="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-4 sm:px-6">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelProfile}
                  disabled={isSaving()}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveProfile}
                  disabled={isSaving()}
                >
                  <Show
                    when={isSaving()}
                    fallback={
                      <>
                        <Check class="h-3.5 w-3.5 mr-1.5" />
                        Save changes
                      </>
                    }
                  >
                    <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Saving...
                  </Show>
                </Button>
              </div>
            </Show>
          </div>
        </section>

        {/* ── Account Section ── */}
        <section class="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <Shield class="h-4 w-4 text-muted-foreground" />
              <h2 class="text-base font-semibold text-foreground">Account</h2>
            </div>
            <p class="text-sm leading-5 text-muted-foreground">
              Review your sign-in details and keep your account secure.
            </p>
          </div>
          <div class="overflow-hidden rounded-xl border bg-card shadow-xs">
            <div class="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div class="min-w-0">
                <p class="text-sm font-medium text-foreground">Email</p>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  <p class="truncate text-sm text-muted-foreground">
                    {currentUser()?.email ?? 'Not available'}
                  </p>
                  <Show when={currentUser()}>
                    <Show
                      when={currentUser()!.emailVerified}
                      fallback={<Badge variant="warning">Unverified</Badge>}
                    >
                      <Badge variant="success">Verified</Badge>
                    </Show>
                  </Show>
                </div>
              </div>
              <Show when={currentUser()?.emailVerified === false}>
                <Button
                  variant="outline"
                  size="sm"
                  class="shrink-0 self-start sm:self-auto"
                  loading={isResendingVerification()}
                  disabled={isResendingVerification()}
                  onClick={handleResendVerification}
                >
                  Resend verification email
                </Button>
              </Show>
            </div>
            <div class="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
              <div>
                <p class="text-sm font-medium text-foreground">Password</p>
                <p class="mt-1 text-sm tracking-[0.16em] text-muted-foreground">
                  ••••••••
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPwModal(true)}
              >
                <Pencil class="h-3.5 w-3.5 mr-1.5" />
                Change
              </Button>
            </div>
          </div>

          {/* Change password modal */}
          <Dialog open={showPwModal()} onOpenChange={setShowPwModal}>
            <DialogContent class="max-w-md">
              <DialogHeader>
                <DialogTitle>Change password</DialogTitle>
                <DialogDescription>
                  Use at least eight characters for your new password.
                </DialogDescription>
              </DialogHeader>
              <div class="space-y-4">
                <div>
                  <label
                    class="text-sm font-medium text-foreground"
                    for="current-pw"
                  >
                    Current password
                  </label>
                  <Input
                    id="current-pw"
                    type="password"
                    autocomplete="current-password"
                    value={currentPw()}
                    onInput={(e) => setCurrentPw(e.currentTarget.value)}
                    class="mt-1"
                  />
                </div>
                <div>
                  <label class="text-sm font-medium text-foreground" for="new-pw">
                    New password
                  </label>
                  <Input
                    id="new-pw"
                    type="password"
                    autocomplete="new-password"
                    value={newPw()}
                    onInput={(e) => setNewPw(e.currentTarget.value)}
                    class="mt-1"
                  />
                </div>
                <div>
                  <label
                    class="text-sm font-medium text-foreground"
                    for="confirm-pw"
                  >
                    Confirm new password
                  </label>
                  <Input
                    id="confirm-pw"
                    type="password"
                    autocomplete="new-password"
                    value={confirmPw()}
                    onInput={(e) => setConfirmPw(e.currentTarget.value)}
                    class="mt-1"
                  />
                </div>
              </div>
              <DialogFooter class="border-t pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPwModal(false)}
                  disabled={pwSaving()}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleChangePassword}
                  disabled={pwSaving() || !currentPw() || !newPw() || !confirmPw()}
                >
                  <Show when={pwSaving()} fallback="Save">
                    <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Saving...
                  </Show>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>

        {/* ── Appearance Section ── */}
        <section class="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <Palette class="h-4 w-4 text-muted-foreground" />
              <h2 class="text-base font-semibold text-foreground">Appearance</h2>
            </div>
            <p class="text-sm leading-5 text-muted-foreground">
              Select a theme that stays comfortable throughout every study session.
            </p>
          </div>
          <div class="overflow-hidden rounded-xl border bg-card p-5 shadow-xs sm:p-6">
              <p class="mb-4 text-sm font-medium text-foreground">Theme</p>
              <div
                class="grid grid-cols-1 gap-2 sm:grid-cols-3"
                role="radiogroup"
                aria-label="Color theme"
              >
                {THEME_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={theme() === opt.value}
                      class={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        theme() === opt.value
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                      onClick={() => setTheme(opt.value)}
                    >
                      <Icon class="h-4 w-4" />
                      <span class="text-sm font-medium">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <p class="mt-4 min-h-4 text-xs text-muted-foreground">
                <Show when={theme() === 'system'}>
                  Currently using <strong>{resolvedTheme()}</strong> mode based
                  on your system settings.
                </Show>
              </p>
          </div>
        </section>

        {/* ── Study Algorithm Section ── */}
        <section class="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <BrainCircuit class="h-4 w-4 text-muted-foreground" />
              <h2 class="text-base font-semibold text-foreground">
                Spaced repetition
              </h2>
            </div>
            <p class="text-sm leading-5 text-muted-foreground">
              Control how Engram schedules the next review for each card.
            </p>
          </div>
          <div class="overflow-hidden rounded-xl border bg-card p-5 shadow-xs sm:p-6">
              <p class="text-sm font-medium text-foreground">Algorithm</p>
              <p class="mb-4 mt-1 text-xs leading-5 text-muted-foreground">
                Choose which spaced repetition algorithm schedules your reviews.
              </p>
              <div
                class="grid grid-cols-1 gap-3 sm:grid-cols-2"
                role="radiogroup"
                aria-label="Spaced repetition algorithm"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={(algorithmQuery.data ?? 'sm2') === 'sm2'}
                  class={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    (algorithmQuery.data ?? 'sm2') === 'sm2'
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background hover:bg-muted'
                  }`}
                  disabled={algorithmMutation.isPending}
                  onClick={() => algorithmMutation.mutate('sm2')}
                >
                  <span class="text-sm font-semibold">SM-2</span>
                  <span
                    class={`text-xs ${
                      (algorithmQuery.data ?? 'sm2') === 'sm2'
                        ? 'text-background/70'
                        : 'text-muted-foreground'
                    }`}
                  >
                    Classic SuperMemo algorithm. Simple and proven.
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={algorithmQuery.data === 'fsrs'}
                  class={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    algorithmQuery.data === 'fsrs'
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background hover:bg-muted'
                  }`}
                  disabled={algorithmMutation.isPending}
                  onClick={() => algorithmMutation.mutate('fsrs')}
                >
                  <span class="text-sm font-semibold">FSRS</span>
                  <span
                    class={`text-xs ${
                      algorithmQuery.data === 'fsrs'
                        ? 'text-background/70'
                        : 'text-muted-foreground'
                    }`}
                  >
                    Modern algorithm with better retention modeling.
                  </span>
                </button>
              </div>
              <Show when={algorithmMutation.isPending}>
                <div
                  class="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  <Loader2 class="h-3 w-3 animate-spin" />
                  Switching algorithm...
                </div>
              </Show>
          </div>
        </section>

        {/* ── Card Templates Section ── */}
        <section class="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <Layers class="h-4 w-4 text-muted-foreground" />
              <h2 class="text-base font-semibold text-foreground">
                Card templates
              </h2>
            </div>
            <p class="text-sm leading-5 text-muted-foreground">
              Define reusable card structures for consistent knowledge capture.
            </p>
          </div>
          <div class="min-w-0">
            <TemplateBuilder />
          </div>
        </section>

        {/* ── About Section ── */}
        <section class="grid gap-4 border-t pt-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <Info class="h-4 w-4 text-muted-foreground" />
              <h2 class="text-base font-semibold text-foreground">About</h2>
            </div>
            <p class="text-sm leading-5 text-muted-foreground">
              Technical details for this Engram Spira build.
            </p>
          </div>
          <div class="overflow-hidden rounded-xl border bg-card shadow-xs">
            <div class="flex items-center justify-between border-b px-5 py-4 sm:px-6">
              <p class="text-sm font-medium text-foreground">Version</p>
              <span class="text-sm text-muted-foreground font-mono">1.0.0</span>
            </div>
            <div class="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p class="text-sm font-medium text-foreground">Built with</p>
              <span class="text-sm text-muted-foreground sm:text-right">
                SolidJS + ElysiaJS + Drizzle
              </span>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
};

export default SettingsPage;
