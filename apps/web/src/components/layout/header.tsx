import { type Component, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { currentUser, logout } from '@/stores/auth.store';
import { LogOut } from 'lucide-solid';

const Header: Component = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header class="border-b bg-card">
      <div class="flex items-center justify-between h-14 px-6">
        <div class="flex items-center gap-2.5">
          <img
            src="/logo-engram.png"
            alt="Engram Spira logo"
            class="h-8 w-auto"
          />
          <span class="text-lg font-bold tracking-tight text-foreground">
            <span class="text-blue-500 text-xl">Engram</span> Spira
          </span>
        </div>
        <Show when={currentUser()}>
          <div class="flex items-center gap-3">
            <span class="text-sm text-muted-foreground">
              {currentUser()!.email}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Logout"
            >
              <LogOut class="h-4 w-4" />
            </Button>
          </div>
        </Show>
      </div>
    </header>
  );
};

export default Header;
