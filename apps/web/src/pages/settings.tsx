import { type Component, Show, createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Header from '@/components/layout/header';
import Sidebar from '@/components/layout/sidebar';
import { Button } from '@/components/ui/button';
import { currentUser } from '@/stores/auth.store';
import {
  theme,
  setTheme,
  resolvedTheme,
  type Theme,
} from '@/stores/theme.store';
import {
  ArrowLeft,
  User,
  Palette,
  Monitor,
  Sun,
  Moon,
  Shield,
  Info,
} from 'lucide-solid';

const THEME_OPTIONS: { value: Theme; label: string; icon: any }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

const SettingsPage: Component = () => {
  const navigate = useNavigate();

  return (
    <div class="h-screen flex flex-col">
      <Header />
      <div class="flex flex-1 overflow-hidden">
        <Sidebar />

        <main class="flex-1 overflow-y-auto">
          <div class="p-6">
            <div class="max-w-2xl mx-auto space-y-8">
              {/* Header */}
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

              {/* ── Account Section ── */}
              <section class="space-y-4">
                <div class="flex items-center gap-2">
                  <User class="h-4 w-4 text-muted-foreground" />
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
                      <p class="text-sm font-medium text-foreground">
                        Username
                      </p>
                      <p class="text-sm text-muted-foreground mt-0.5">
                        {currentUser()?.email?.split('@')[0] ?? '—'}
                      </p>
                    </div>
                  </div>
                </div>
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
                    <p class="text-sm font-medium text-foreground mb-3">
                      Theme
                    </p>
                    <div class="grid grid-cols-3 gap-3">
                      {THEME_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            class={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer ${
                              theme() === opt.value
                                ? 'border-primary bg-primary/5 text-primary'
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
                        Currently using <strong>{resolvedTheme()}</strong> mode
                        based on your system settings.
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
                    <span class="text-sm text-muted-foreground font-mono">
                      1.0.0
                    </span>
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
          </div>
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;
