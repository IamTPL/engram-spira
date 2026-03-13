import {
  type Component,
  Show,
  For,
  createSignal,
  createResource,
  onCleanup,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import {
  Bell,
  Zap,
  BookOpen,
  ChevronDown,
  Target,
  BookMarked,
  Settings,
  Sun,
  Moon,
  MessageSquare,
  LogOut,
} from 'lucide-solid';
import { Button } from '@/components/ui/button';
import { currentUser, logout } from '@/stores/auth.store';
import { api } from '@/api/client';
import { NOTIFICATIONS_POLL_MS } from '@/constants';
import { resolvedTheme, toggleTheme } from '@/stores/theme.store';
import { openFocusDrawer, isRunning } from '@/stores/focus.store';

interface DueDeckNotification {
  deckId: string;
  deckName: string;
  dueCount: number;
}

export const SidebarFooter: Component<{ compact?: boolean }> = (props) => {
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = createSignal(false);
  const [showUserMenu, setShowUserMenu] = createSignal(false);

  const [dueDecks, { refetch: refetchDue }] = createResource(
    () => currentUser()?.id,
    async () => {
      const { data } = await (api.notifications as any)['due-decks'].get();
      return (data ?? []) as DueDeckNotification[];
    },
  );

  const timer = setInterval(() => {
    if (currentUser()) refetchDue();
  }, NOTIFICATIONS_POLL_MS);
  onCleanup(() => clearInterval(timer));

  const totalDue = () =>
    (dueDecks() ?? []).reduce((sum, d) => sum + d.dueCount, 0);
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
    <Show when={currentUser()}>
      <div
        class={
          props.compact
            ? 'mt-auto pt-2 border-t border-border w-full flex flex-col items-center gap-1.5'
            : 'border-t border-border p-3 shrink-0 flex items-center justify-between gap-1'
        }
      >
        <div class={props.compact ? 'relative' : 'relative shrink-0'}>
          <Button
            variant="ghost"
            size="icon"
            title="Notifications"
            onClick={() => {
              setShowNotifications(!showNotifications());
              setShowUserMenu(false);
            }}
            class={
              props.compact
                ? 'h-8 w-8 relative'
                : 'relative h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent'
            }
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
            <div
              class={`fixed z-40 w-80 max-w-[90vw] rounded-xl border bg-card shadow-xl overflow-hidden ${
                props.compact ? 'left-14 bottom-14' : 'left-64 bottom-2'
              }`}
            >
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
                          <div class="h-8 w-8 rounded-lg bg-palette-1 flex items-center justify-center shrink-0">
                            <BookOpen class="h-4 w-4 text-slate-700" />
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

        <div
          class={
            props.compact ? 'relative' : 'relative flex-1 min-w-0 order-first'
          }
        >
          <button
            class={
              props.compact
                ? 'h-8 w-8 rounded-full bg-linear-to-br from-palette-5 to-palette-3 flex items-center justify-center text-slate-800 text-sm font-bold shadow-sm'
                : 'flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition-colors cursor-pointer w-full'
            }
            onClick={() => {
              setShowUserMenu(!showUserMenu());
              setShowNotifications(false);
            }}
          >
            <Show
              when={currentUser()?.avatarUrl}
              fallback={
                <div
                  class={
                    props.compact
                      ? 'h-8 w-8 rounded-full bg-linear-to-br from-palette-5 to-palette-3 flex items-center justify-center text-slate-800 text-sm font-bold shadow-sm'
                      : 'h-8 w-8 rounded-full flex shrink-0 items-center justify-center text-slate-800 text-sm font-bold shadow-sm bg-linear-to-br from-palette-5 to-palette-3 '
                  }
                >
                  {userInitial()}
                </div>
              }
            >
              <img
                src={currentUser()!.avatarUrl!}
                alt="avatar"
                class="h-8 w-8 rounded-full object-cover shadow-sm ring-1 ring-border shrink-0"
              />
            </Show>
            <Show when={!props.compact}>
              <div class="flex-1 min-w-0 text-left">
                <p class="text-sm font-medium truncate text-foreground">
                  {currentUser()!.email.split('@')[0]}
                </p>
                <p class="text-xs text-muted-foreground truncate">
                  {currentUser()!.email}
                </p>
              </div>
              <ChevronDown
                class={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                  showUserMenu() ? 'rotate-180' : ''
                }`}
              />
            </Show>
          </button>

          <Show when={showUserMenu()}>
            <div
              class="fixed inset-0 z-30"
              onClick={() => setShowUserMenu(false)}
            />
            <div
              class={`fixed z-40 w-64 rounded-xl border bg-card shadow-xl overflow-hidden ${
                props.compact ? 'left-14 bottom-2' : 'left-64 bottom-2'
              }`}
            >
              <div class="px-4 py-3 border-b bg-muted/30">
                <div class="flex items-center gap-3">
                  <Show
                    when={currentUser()?.avatarUrl}
                    fallback={
                      <div class="h-10 w-10 rounded-full bg-linear-to-br from-palette-5 to-palette-3 flex items-center justify-center text-slate-800 text-base font-bold shadow-sm shrink-0">
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
                  onClick={toggleTheme}
                >
                  <Show
                    when={resolvedTheme() === 'dark'}
                    fallback={<Moon class="h-4 w-4 text-muted-foreground" />}
                  >
                    <Sun class="h-4 w-4 text-muted-foreground" />
                  </Show>
                  <span>
                    {resolvedTheme() === 'dark' ? 'Light Mode' : 'Dark Mode'}
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

              <div class="border-t py-1">
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors text-left"
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
  );
};
