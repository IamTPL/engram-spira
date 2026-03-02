import { type Component } from 'solid-js';
import Header from '@/components/layout/header';
import Sidebar from '@/components/layout/sidebar';

const DashboardPage: Component = () => {
  return (
    <div class="h-screen flex flex-col">
      <Header />
      <div class="flex flex-1 overflow-hidden">
        <Sidebar />
        <main class="flex-1 p-8 overflow-y-auto">
          <div class="max-w-2xl mx-auto">
            <h2 class="text-2xl font-bold mb-2">Welcome back</h2>
            <p class="text-muted-foreground">
              Select a deck from the sidebar to view its cards, or create a new
              class to get started.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardPage;
