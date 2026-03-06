import {
  type Component,
  Show,
  For,
  createSignal,
  createResource,
  onCleanup,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { currentUser, logout } from '@/stores/auth.store';
import { sidebarCollapsed, toggleSidebar } from '@/stores/sidebar.store';
import { resolvedTheme, toggleTheme } from '@/stores/theme.store';
import { api } from '@/api/client';
import { NOTIFICATIONS_POLL_MS } from '@/constants';
import {
  Bell,
  LogOut,
  BookOpen,
  Zap,
  PanelLeft,
  Settings,
  Sun,
  Moon,
  MessageSquare,
  User,
  ChevronDown,
  Target,
  BookMarked,
} from 'lucide-solid';
import { openFocusDrawer, isRunning } from '@/stores/focus.store';

interface DueDeckNotification {
  deckId: string;
  deckName: string;
  dueCount: number;
}

const Header: Component = () => {
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = createSignal(false);
  const [showUserMenu, setShowUserMenu] = createSignal(false);

  // Poll due-decks every NOTIFICATIONS_POLL_MS when user is authenticated
  const [dueDecks, { refetch: refetchDue }] = createResource(
    () => currentUser()?.id,
    async () => {
      const { data } = await (api.notifications as any)['due-decks'].get();
      return (data ?? []) as DueDeckNotification[];
    },
  );

  // Auto-refresh timer
  const timer = setInterval(() => {
    if (currentUser()) refetchDue();
  }, NOTIFICATIONS_POLL_MS);
  onCleanup(() => clearInterval(timer));

  const totalDue = () => (dueDecks() ?? []).reduce((s, d) => s + d.dueCount, 0);
  const hasDue = () => totalDue() > 0;

  const userInitial = () => {
    const email = currentUser()?.email ?? '';
    return email.charAt(0).toUpperCase();
  };

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const handleDeckClick = (deckId: string) => {
    setShowNotifications(false);
    navigate(`/deck/${deckId}`);
  };

  return (
    <header class="border-b bg-card">
      <div class="flex items-center justify-between h-14 px-4">
        {/* ── Left: toggle + logo ── */}
        <div class="flex items-center gap-1">
          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed() ? 'Expand sidebar' : 'Collapse sidebar'}
            class="hidden md:flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <PanelLeft
              class={`h-4 w-4 transition-transform duration-300 ${
                sidebarCollapsed() ? 'rotate-180' : ''
              }`}
            />
          </button>

          <button
            class="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1 hover:bg-accent transition-colors ml-1"
            onClick={() => navigate('/')}
            title="Go to Dashboard"
          >
            <img
              src="/logo-engram.png"
              alt="Engram Spira logo"
              class="h-7 w-auto"
            />
            <span class="text-lg font-bold tracking-tight text-foreground">
              Engram Spira
            </span>
          </button>
        </div>

        {/* ── Right: bell + user dropdown ── */}
        <Show when={currentUser()}>
          <div class="flex items-center gap-2">
            {/* ── Notification Bell ── */}
            <div class="relative">
              <Button
                variant="ghost"
                size="icon"
                title="Notifications"
                onClick={() => {
                  setShowNotifications(!showNotifications());
                  setShowUserMenu(false);
                }}
                class="relative"
              >
                <Bell class="h-4 w-4" />
                <Show when={hasDue()}>
                  <span class="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {totalDue() > 99 ? '99+' : totalDue()}
                  </span>
                </Show>
              </Button>

              <Show when={showNotifications()}>
                <div
                  class="fixed inset-0 z-30"
                  onClick={() => setShowNotifications(false)}
                />
                <div class="absolute right-0 top-full mt-2 w-80 rounded-xl border bg-card shadow-xl z-40 overflow-hidden">
                  <div class="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
                    <div class="flex items-center gap-2">
                      <Zap class="h-4 w-4 text-yellow-500" />
                      <span class="text-sm font-semibold">Due for Review</span>
                    </div>
                    <Show when={hasDue()}>
                      <span class="text-xs text-muted-foreground">
                        {totalDue()} card{totalDue() !== 1 ? 's' : ''}
                      </span>
                    </Show>
                  </div>
                  <div class="max-h-80 overflow-y-auto">
                    <Show
                      when={!dueDecks.loading}
                      fallback={
                        <div class="px-4 py-6 text-center text-sm text-muted-foreground">
                          Loading...
                        </div>
                      }
                    >
                      <Show
                        when={hasDue()}
                        fallback={
                          <div class="px-4 py-8 text-center">
                            <p class="text-2xl mb-2">🎉</p>
                            <p class="text-sm font-medium text-foreground">
                              All caught up!
                            </p>
                            <p class="text-xs text-muted-foreground mt-1">
                              No cards due right now.
                            </p>
                          </div>
                        }
                      >
                        <For each={dueDecks() ?? []}>
                          {(deck) => (
                            <button
                              class="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors text-left border-b border-border/50 last:border-0"
                              onClick={() => handleDeckClick(deck.deckId)}
                            >
                              <div class="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                                <BookOpen class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              </div>
                              <div class="flex-1 min-w-0">
                                <p class="text-sm font-medium truncate">
                                  {deck.deckName}
                                </p>
                                <p class="text-xs text-muted-foreground">
                                  {deck.dueCount} card
                                  {deck.dueCount !== 1 ? 's' : ''} due
                                </p>
                              </div>
                              <span class="text-xs font-semibold text-red-500 shrink-0">
                                Study
                              </span>
                            </button>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>

            {/* ── User Menu ── */}
            <div class="relative">
              <button
                class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition-colors cursor-pointer"
                onClick={() => {
                  setShowUserMenu(!showUserMenu());
                  setShowNotifications(false);
                }}
              >
                {/* Avatar circle */}
                <Show
                  when={currentUser()?.avatarUrl}
                  fallback={
                    <div class="h-8 w-8 rounded-full bg-linear-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-sm font-bold shadow-sm">
                      {userInitial()}
                    </div>
                  }
                >
                  <img
                    src={currentUser()!.avatarUrl!}
                    alt="avatar"
                    class="h-8 w-8 rounded-full object-cover shadow-sm ring-1 ring-border"
                  />
                </Show>
                <ChevronDown
                  class={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
                    showUserMenu() ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <Show when={showUserMenu()}>
                <div
                  class="fixed inset-0 z-30"
                  onClick={() => setShowUserMenu(false)}
                />
                <div class="absolute right-0 top-full mt-2 w-64 rounded-xl border bg-card shadow-xl z-40 overflow-hidden animate-fade-in">
                  {/* User info */}
                  <div class="px-4 py-3 border-b bg-muted/30">
                    <div class="flex items-center gap-3">
                      <Show
                        when={currentUser()?.avatarUrl}
                        fallback={
                          <div class="h-10 w-10 rounded-full bg-linear-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-base font-bold shadow-sm shrink-0">
                            {userInitial()}
                          </div>
                        }
                      >
                        <img
                          src={currentUser()!.avatarUrl!}
                          alt="avatar"
                          class="h-10 w-10 rounded-full object-cover shadow-sm ring-1 ring-border shrink-0"
                        />
                      </Show>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold truncate text-foreground">
                          {currentUser()!.email.split('@')[0]}
                        </p>
                        <p class="text-xs text-muted-foreground truncate">
                          {currentUser()!.email}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div class="py-1">
                    <button
                      class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                      onClick={() => {
                        setShowUserMenu(false);
                        openFocusDrawer();
                      }}
                    >
                      <Target class="h-4 w-4 text-muted-foreground" />
                      <span>Focus Mode</span>
                      <Show when={isRunning()}>
                        <span class="ml-auto relative flex h-2 w-2">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                        </span>
                      </Show>
                    </button>

                    <button
                      class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate('/docs');
                      }}
                    >
                      <BookMarked class="h-4 w-4 text-muted-foreground" />
                      <span>Docs</span>
                    </button>

                    <button
                      class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate('/settings');
                      }}
                    >
                      <Settings class="h-4 w-4 text-muted-foreground" />
                      <span>Settings</span>
                    </button>

                    <button
                      class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                      onClick={() => {
                        toggleTheme();
                      }}
                    >
                      <Show
                        when={resolvedTheme() === 'dark'}
                        fallback={
                          <Moon class="h-4 w-4 text-muted-foreground" />
                        }
                      >
                        <Sun class="h-4 w-4 text-muted-foreground" />
                      </Show>
                      <span>
                        {resolvedTheme() === 'dark'
                          ? 'Light Mode'
                          : 'Dark Mode'}
                      </span>
                      <span class="ml-auto text-xs text-muted-foreground">
                        <kbd class="kbd">
                          {resolvedTheme() === 'dark' ? '☀' : '🌙'}
                        </kbd>
                      </span>
                    </button>

                    <button
                      class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate('/feedback');
                      }}
                    >
                      <MessageSquare class="h-4 w-4 text-muted-foreground" />
                      <span>Report / Feedback</span>
                    </button>
                  </div>

                  {/* Logout */}
                  <div class="border-t py-1">
                    <button
                      class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
                      onClick={handleLogout}
                    >
                      <LogOut class="h-4 w-4" />
                      <span>Log out</span>
                    </button>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </header>
  );
};

export default Header;
