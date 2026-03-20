import {
  type Component,
  Show,
  For,
  createSignal,
  onMount,
  onCleanup,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { currentUser, logout } from '@/stores/auth.store';
import { sidebarCollapsed, toggleSidebar } from '@/stores/sidebar.store';
import { resolvedTheme, toggleTheme } from '@/stores/theme.store';
import {
  dueDecks,
  dueDeckLoading,
  totalDue,
  hasDue,
} from '@/stores/notifications.store';
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
  ChevronDown,
  Target,
  BookMarked,
  Search,
} from 'lucide-solid';
import { openFocusDrawer, isRunning } from '@/stores/focus.store';
import { openSearch } from '@/stores/search.store';

const Header: Component = () => {
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = createSignal(false);
  const [showUserMenu, setShowUserMenu] = createSignal(false);

  // Global Cmd+K / Ctrl+K shortcut for search
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
  };

  onMount(() => document.addEventListener('keydown', handleGlobalKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleGlobalKeyDown));

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
    <header class="bg-card border-b">
      <div class="flex items-center justify-between h-14 px-4">
        {/* ── Left: toggle + logo ── */}
        <div class="flex items-center gap-1">
          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed() ? 'Expand sidebar' : 'Collapse sidebar'}
            class="hidden md:flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-[--duration-fast] cursor-pointer"
          >
            <PanelLeft
              class={`h-4 w-4 transition-transform duration-300 ${
                sidebarCollapsed() ? 'rotate-180' : ''
              }`}
            />
          </button>

          <button
            class="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1 hover:bg-accent transition-colors duration-[--duration-fast] ml-1"
            onClick={() => navigate('/')}
            title="Go to Dashboard"
          >
            <img
              src="/logo-engram.webp"
              alt="Engram Spira logo"
              class="h-7 w-auto"
            />
            <span class="text-lg font-bold tracking-tight text-foreground hidden sm:inline">
              Engram Spira
            </span>
          </button>
        </div>

        {/* ── Right: search + bell + user dropdown ── */}
        <Show when={currentUser()}>
          <div class="flex items-center gap-1">
            {/* ── Search Button ── */}
            <Button
              variant="ghost"
              size="sm"
              title="Search (Cmd+K)"
              onClick={openSearch}
              class="hidden sm:inline-flex items-center gap-2 text-muted-foreground hover:text-foreground px-2.5"
            >
              <Search class="h-4 w-4" />
              <span class="text-xs">Search</span>
              <kbd class="ml-1 inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Search"
              onClick={openSearch}
              class="sm:hidden"
            >
              <Search class="h-4 w-4" />
            </Button>

            {/* ── Notification Bell ── */}
            <DropdownMenu
              open={showNotifications()}
              onOpenChange={setShowNotifications}
            >
              <DropdownMenuTrigger>
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
                    <Badge
                      variant="destructive"
                      class="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 text-[10px] leading-none justify-center"
                    >
                      {totalDue() > 99 ? '99+' : totalDue()}
                    </Badge>
                  </Show>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" class="w-80 p-0">
                  <div class="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
                    <div class="flex items-center gap-2">
                      <Zap class="h-4 w-4 text-yellow-500" />
                      <span class="text-sm font-semibold">Due for Review</span>
                    </div>
                    <Show when={hasDue()}>
                      <Badge variant="muted">
                        {totalDue()} card{totalDue() !== 1 ? 's' : ''}
                      </Badge>
                    </Show>
                  </div>
                  <div class="max-h-80 overflow-y-auto">
                    <Show
                      when={!dueDeckLoading()}
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
                            <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                              <Zap class="h-5 w-5 text-success" />
                            </div>
                            <p class="text-sm font-medium text-foreground">
                              All caught up!
                            </p>
                            <p class="text-xs text-muted-foreground mt-1">
                              No cards due right now.
                            </p>
                          </div>
                        }
                      >
                        <For each={dueDecks()}>
                          {(deck) => (
                            <button
                              class="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors duration-[--duration-fast] text-left border-b border-border/50 last:border-0 cursor-pointer"
                              onClick={() => handleDeckClick(deck.deckId)}
                            >
                              <div class="h-8 w-8 rounded-lg bg-palette-1/20 flex items-center justify-center shrink-0">
                                <BookOpen class="h-4 w-4 text-palette-1" />
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
                              <Badge variant="destructive" class="text-[10px]">
                                Study
                              </Badge>
                            </button>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* ── User Menu ── */}
            <DropdownMenu open={showUserMenu()} onOpenChange={setShowUserMenu}>
              <DropdownMenuTrigger>
                <button
                  class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition-colors duration-[--duration-fast] cursor-pointer"
                  onClick={() => {
                    setShowUserMenu(!showUserMenu());
                    setShowNotifications(false);
                  }}
                >
                  <Show
                    when={currentUser()?.avatarUrl}
                    fallback={
                      <div class="h-8 w-8 rounded-full bg-linear-to-br from-palette-5 to-palette-3 flex items-center justify-center text-slate-800 text-sm font-bold shadow-sm">
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
              </DropdownMenuTrigger>

              <Show when={showUserMenu()}>
                <DropdownMenuContent align="end" class="w-64 p-0">
                  {/* User info */}
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
                    <DropdownMenuItem
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
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate('/docs');
                      }}
                    >
                      <BookMarked class="h-4 w-4 text-muted-foreground" />
                      <span>Docs</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate('/settings');
                      }}
                    >
                      <Settings class="h-4 w-4 text-muted-foreground" />
                      <span>Settings</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={toggleTheme}>
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
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate('/feedback');
                      }}
                    >
                      <MessageSquare class="h-4 w-4 text-muted-foreground" />
                      <span>Report / Feedback</span>
                    </DropdownMenuItem>
                  </div>

                  <DropdownMenuSeparator />
                  <div class="py-1">
                    <DropdownMenuItem destructive onClick={handleLogout}>
                      <LogOut class="h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </Show>
            </DropdownMenu>
          </div>
        </Show>
      </div>
    </header>
  );
};

export default Header;
