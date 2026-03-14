import { type Component, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  Plus,
  Play,
  Layers,
  Search,
  Hash,
  Sparkles,
  CheckSquare,
} from 'lucide-solid';
import type { DeckData, TemplateData } from './use-deck-data';
import type { Resource } from 'solid-js';

interface DeckHeaderProps {
  deck: Resource<DeckData | null>;
  template: Resource<TemplateData | null>;
  cardCount: () => number;
  searchQuery: () => string;
  setSearchQuery: (v: string) => void;
  showAddCard: () => boolean;
  setShowAddCard: (v: boolean) => void;
  setAddInputs: (v: Record<string, unknown>) => void;
  showAiModal: () => boolean;
  setShowAiModal: (v: boolean) => void;
  selectMode: () => boolean;
  toggleSelectMode: () => void;
}

const DeckHeader: Component<DeckHeaderProps> = (props) => {
  const navigate = useNavigate();

  return (
    <div class="border-b px-6 py-4">
      <div class="max-w-5xl mx-auto">
        <div class="flex items-center gap-3 mb-3">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8 shrink-0"
            onClick={() => {
              const folderId = props.deck()?.folderId;
              navigate(folderId ? `/folder/${folderId}` : '/');
            }}
          >
            <ArrowLeft class="h-4 w-4" />
          </Button>
          <div class="flex-1 min-w-0">
            <h1 class="text-xl font-bold truncate leading-tight">
              {props.deck()?.name ?? 'Loading...'}
            </h1>
            <div class="flex items-center gap-3 mt-1">
              <Show when={props.template()}>
                <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-palette-5/15 text-palette-5 font-medium">
                  <Layers class="h-3 w-3" />
                  {props.template()!.name}
                </span>
              </Show>
              <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Hash class="h-3 w-3" />
                {props.cardCount()} card{props.cardCount() !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Actions row */}
        <div class="flex items-center gap-3">
          <Button
            onClick={() => navigate(`/study/${props.deck()?.id ?? ''}`)}
            class="shadow-sm"
          >
            <Play class="h-4 w-4 mr-2" />
            Study Now
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              props.setAddInputs({});
              props.setShowAddCard(true);
            }}
            disabled={props.showAddCard()}
          >
            <Plus class="h-4 w-4 mr-2" />
            Add Card
          </Button>
          <Button
            variant="outline"
            onClick={() => props.setShowAiModal(true)}
            disabled={props.showAiModal()}
            class="text-palette-5 border-palette-5/30 hover:bg-palette-5/10"
          >
            <Sparkles class="h-4 w-4 mr-2" />
            AI Generate
          </Button>{' '}
          <Button
            variant={props.selectMode() ? 'default' : 'outline'}
            onClick={props.toggleSelectMode}
          >
            <CheckSquare class="h-4 w-4 mr-2" />
            {props.selectMode() ? 'Cancel' : 'Select'}
          </Button>
          {/* Search */}
          <div class="ml-auto relative max-w-xs w-full">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search cards..."
              class="pl-9 h-9 text-sm"
              value={props.searchQuery()}
              onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeckHeader;
