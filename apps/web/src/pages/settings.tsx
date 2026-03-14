import {
  type Component,
  Show,
  For,
  createSignal,
  createResource,
  createEffect,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import PageShell from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { currentUser, updateProfile } from '@/stores/auth.store';
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
} from 'lucide-solid';

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
          class={`${sizeClass()} rounded-full text-slate-800 font-bold flex items-center justify-center ring-2 ring-palette-5 shrink-0`}
          style={{
            background: 'linear-gradient(135deg, #B2D8F1 0%, #B5CCFF 100%)',
          }}
        >
          {initials()}
        </div>
      }
    >
      <img
        src={props.avatarUrl!}
        alt="avatar"
        class={`${sizeClass()} rounded-full object-contain p-0.5 bg-muted ring-4 ring-palette-5/20 shrink-0`}
      />
    </Show>
  );
};

const SettingsPage: Component = () => {
  const navigate = useNavigate();

  // ── Fetch avatar collection ──────────────────────────────────────────
  const [avatars] = createResource(fetchAvatars);

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
    <PageShell maxWidth="max-w-2xl">
      <div class="space-y-8 animate-fade-in">
        {/* ── Page Header ── */}
        <div class="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8 shrink-0"
            onClick={() => navigate('/')}
          >
            <ArrowLeft class="h-4 w-4" />
          </Button>
          <div>
            <h1 class="text-xl font-bold">Settings</h1>
            <p class="text-sm text-muted-foreground">
              Manage your account and preferences
            </p>
          </div>
        </div>

        {/* ── Profile Section ── */}
        <section class="space-y-4">
          <div class="flex items-center gap-2">
            <User class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Profile
            </h2>
          </div>

          <div class="border rounded-xl bg-card overflow-hidden">
            {/* Current profile preview + display name */}
            <div class="px-5 py-5 flex items-center gap-4 border-b">
              <AvatarDisplay
                avatarUrl={selectedAvatar()}
                email={currentUser()?.email ?? ''}
                size="lg"
              />
              <div class="flex-1 min-w-0">
                <p class="text-xs text-muted-foreground mb-1.5">Display name</p>
                <Input
                  value={displayName()}
                  onInput={(e) => {
                    setDisplayName(e.currentTarget.value);
                    markDirty();
                  }}
                  placeholder={
                    currentUser()?.email?.split('@')[0] ?? 'Your name'
                  }
                  maxLength={50}
                  class="h-9"
                />
                <p class="text-xs text-muted-foreground mt-1.5">
                  {currentUser()?.email}
                </p>
              </div>
            </div>

            {/* Avatar collection picker */}
            <div class="px-5 py-4">
              <p class="text-sm font-medium text-foreground mb-3">
                Choose an avatar
              </p>

              <Show
                when={!avatars.loading}
                fallback={
                  <div class="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 class="h-4 w-4 animate-spin" />
                    Loading avatars...
                  </div>
                }
              >
                <Show
                  when={(avatars() ?? []).length > 0}
                  fallback={
                    <p class="text-sm text-muted-foreground py-2">
                      No avatars found in collection.
                    </p>
                  }
                >
                  <div class="grid grid-cols-8 gap-2">
                    {/* Option: no avatar (show initials) */}
                    <button
                      title="Remove avatar"
                      class={`relative w-11 h-11 rounded-full border-2 transition-colors flex items-center justify-center bg-muted/50 text-muted-foreground text-xs font-medium hover:bg-muted ${selectedAvatar() === null
                          ? 'border-palette-5 ring-2 ring-palette-5/40'
                          : 'border-transparent'
                        }`}
                      onClick={() => {
                        setSelectedAvatar(null);
                        markDirty();
                      }}
                    >
                      <X class="h-4 w-4" />
                      <Show when={selectedAvatar() === null}>
                        <span
                          class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: '#B5CCFF' }}
                        >
                          <Check class="h-2.5 w-2.5 text-slate-800" />
                        </span>
                      </Show>
                    </button>

                    {/* Avatar thumbnails */}
                    <For each={avatars()}>
                      {(url) => (
                        <button
                          title={url.split('/').pop()}
                          class={`relative w-11 h-11 rounded-full border-2 transition-[border-color,transform] overflow-hidden hover:scale-105 ${selectedAvatar() === url
                              ? 'border-palette-5 ring-2 ring-palette-5/40'
                              : 'border-transparent hover:border-muted-foreground/30'
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
                            <span
                              class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                              style={{ background: '#B5CCFF' }}
                            >
                              <Check class="h-2.5 w-2.5 text-slate-800" />
                            </span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>

              {/* Upload hint */}
              <p class="text-xs text-muted-foreground mt-3">
                Custom avatar upload coming soon.
              </p>
            </div>

            {/* Save / Cancel buttons */}
            <Show when={isDirty()}>
              <div class="px-5 py-4 border-t bg-muted/30 flex items-center justify-end gap-2">
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

        {/* ── Account Section (read-only info) ── */}
        <section class="space-y-4">
          <div class="flex items-center gap-2">
            <Shield class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Account
            </h2>
          </div>
          <div class="border rounded-xl bg-card overflow-hidden divide-y">
            <div class="px-5 py-4 flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-foreground">Email</p>
                <p class="text-sm text-muted-foreground mt-0.5">
                  {currentUser()?.email ?? '—'}
                </p>
              </div>
            </div>
            <div class="px-5 py-4 flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-foreground">Password</p>
                <p class="text-sm text-muted-foreground mt-0.5">••••••••</p>
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
          <Show when={showPwModal()}>
            <div
              class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pw-modal-title"
              onClick={() => setShowPwModal(false)}
            >
              <div
                class="bg-card border rounded-xl shadow-lg w-full max-w-sm mx-4 p-6 space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="pw-modal-title" class="text-lg font-semibold">
                  Change Password
                </h3>
                <div class="space-y-3">
                  <div>
                    <label
                      class="text-sm text-muted-foreground"
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
                    <label class="text-sm text-muted-foreground" for="new-pw">
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
                      class="text-sm text-muted-foreground"
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
                <div class="flex justify-end gap-2 pt-2">
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
                    disabled={
                      pwSaving() || !currentPw() || !newPw() || !confirmPw()
                    }
                  >
                    <Show when={pwSaving()} fallback="Save">
                      <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Saving...
                    </Show>
                  </Button>
                </div>
              </div>
            </div>
          </Show>
        </section>

        {/* ── Appearance Section ── */}
        <section class="space-y-4">
          <div class="flex items-center gap-2">
            <Palette class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Appearance
            </h2>
          </div>
          <div class="border rounded-xl bg-card overflow-hidden">
            <div class="px-5 py-4">
              <p class="text-sm font-medium text-foreground mb-3">Theme</p>
              <div class="grid grid-cols-3 gap-3">
                {THEME_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      class={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors cursor-pointer ${theme() === opt.value
                          ? 'border-palette-5 bg-palette-5/10 text-slate-700'
                          : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted'
                        }`}
                      onClick={() => setTheme(opt.value)}
                    >
                      <Icon class="h-5 w-5" />
                      <span class="text-xs font-medium">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <p class="text-xs text-muted-foreground mt-3">
                <Show when={theme() === 'system'}>
                  Currently using <strong>{resolvedTheme()}</strong> mode based
                  on your system settings.
                </Show>
              </p>
            </div>
          </div>
        </section>

        {/* ── About Section ── */}
        <section class="space-y-4">
          <div class="flex items-center gap-2">
            <Info class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              About
            </h2>
          </div>
          <div class="border rounded-xl bg-card overflow-hidden divide-y">
            <div class="px-5 py-4 flex items-center justify-between">
              <p class="text-sm text-foreground">Version</p>
              <span class="text-sm text-muted-foreground font-mono">1.0.0</span>
            </div>
            <div class="px-5 py-4 flex items-center justify-between">
              <p class="text-sm text-foreground">Built with</p>
              <span class="text-sm text-muted-foreground">
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
