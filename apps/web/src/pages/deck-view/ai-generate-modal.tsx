import {
  type Component,
  createSignal,
  createEffect,
  Show,
  For,
  batch,
  onCleanup,
} from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, getApiError } from '@/api/client';
import { toast } from '@/stores/toast.store';
import {
  Sparkles,
  Loader2,
  Save,
  X,
  Trash2,
} from 'lucide-solid';
import {
  AI_SOURCE_MIN_CHARS,
  AI_SOURCE_MAX_CHARS,
} from '@/constants';
import Spinner from '@/components/ui/spinner';
import type { AiPreviewCard } from './types';

interface AiGenerateModalProps {
  deckId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Pending job data from parent (if any) */
  pendingJob: {
    id: string;
    status: string;
    cardCount?: number;
    generatedCards?: any[];
  } | null;
}

const AiGenerateModal: Component<AiGenerateModalProps> = (props) => {
  const [aiSourceText, setAiSourceText] = createSignal('');
  const [aiBackLang, setAiBackLang] = createSignal<'vi' | 'en'>('vi');
  const [aiGenerating, setAiGenerating] = createSignal(false);
  const [aiPreviewOpen, setAiPreviewOpen] = createSignal(false);
  const [aiPreviewCards, setAiPreviewCards] = createStore<AiPreviewCard[]>([]);
  const [aiJobId, setAiJobId] = createSignal<string | null>(null);
  const [aiSaving, setAiSaving] = createSignal(false);
  const [aiConfirmDiscard, setAiConfirmDiscard] = createSignal(false);

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  onCleanup(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  // Reset state when modal opens
  createEffect(() => {
    if (props.open) {
      // If resuming a pending job, load its data
      const job = props.pendingJob;
      if (job) {
        if (job.status === 'processing') {
          setAiJobId(job.id);
          setAiGenerating(true);
          startPolling(job.id);
        } else if (job.status === 'pending' && job.generatedCards) {
          setAiPreviewCards(reconcile(job.generatedCards as AiPreviewCard[]));
          setAiJobId(job.id);
          setAiPreviewOpen(true);
        }
      }
    }
  });

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const { data, error } = await (api.ai as any).jobs({ jobId }).get();
        if (error || !data) return;
        if (data.status === 'pending') {
          stopPolling();
          setAiGenerating(false);
          setAiPreviewCards(reconcile((data.generatedCards as any[]) ?? []));
          setAiPreviewOpen(true);
        } else if (data.status === 'failed') {
          stopPolling();
          setAiGenerating(false);
          setAiJobId(null);
          toast.error(data.errorMessage ?? 'AI generation failed');
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 2000);
  };

  const handleAiGenerate = async () => {
    const text = aiSourceText().trim();
    if (!text || text.length < 10) {
      toast.error('Please enter at least 10 characters');
      return;
    }
    setAiGenerating(true);
    try {
      const { data, error } = await (api.ai as any).generate.post({
        deckId: props.deckId,
        sourceText: text,
        backLanguage: aiBackLang(),
      });
      if (error) throw new Error(getApiError(error));
      setAiJobId(data.jobId);
      startPolling(data.jobId);
    } catch (err: any) {
      setAiGenerating(false);
      toast.error(err?.message ?? 'AI generation failed');
    }
  };

  const handleAiSave = async () => {
    const jobId = aiJobId();
    if (!jobId || !aiPreviewOpen()) return;
    stopPolling();
    setAiSaving(true);
    try {
      const { error } = await (api.ai as any).jobs({ jobId }).save.post({
        cards: aiPreviewCards.map((c) => ({
          front: c.front,
          back: c.back,
          ...(c.ipa != null ? { ipa: c.ipa } : {}),
          ...(c.wordType != null ? { wordType: c.wordType } : {}),
          ...(c.examples != null ? { examples: c.examples } : {}),
        })),
      });
      if (error) throw new Error(getApiError(error));
      toast.success(`${aiPreviewCards.length} cards saved!`);
      resetAndClose();
      props.onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save cards');
    } finally {
      setAiSaving(false);
    }
  };

  const closeModal = () => {
    if (aiPreviewOpen() && aiJobId()) {
      setAiConfirmDiscard(true);
      return;
    }
    forceClose();
  };

  const forceClose = () => {
    stopPolling();
    batch(() => {
      setAiConfirmDiscard(false);
      setAiPreviewOpen(false);
      setAiJobId(null);
      setAiSourceText('');
      setAiBackLang('vi');
      setAiGenerating(false);
    });
    setAiPreviewCards(reconcile([]));
    props.onClose();
  };

  const resetAndClose = () => {
    stopPolling();
    batch(() => {
      setAiConfirmDiscard(false);
      setAiPreviewOpen(false);
      setAiJobId(null);
      setAiSourceText('');
      setAiGenerating(false);
    });
    setAiPreviewCards(reconcile([]));
    props.onClose();
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            class="relative bg-card border rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4 animate-fade-in"
            style={{ 'overscroll-behavior': 'contain' }}
          >
            {/* Header */}
            <div class="flex items-center justify-between p-5 border-b">
              <div class="flex items-center gap-2">
                <Sparkles class="h-5 w-5 text-palette-4" />
                <h2 id="ai-modal-title" class="text-lg font-semibold">
                  AI Card Generator
                </h2>
                <Show when={aiGenerating()}>
                  <span class="text-xs text-muted-foreground">Generating…</span>
                </Show>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                onClick={closeModal}
                aria-label="Close"
                title="Close"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>

            {/* Layer 2: Confirm discard overlay */}
            <Show when={aiConfirmDiscard()}>
              <div class="absolute inset-0 z-10 flex items-center justify-center bg-black/60 rounded-2xl">
                <div class="bg-card border rounded-xl shadow-xl p-6 mx-6 space-y-4 max-w-sm w-full">
                  <h3 class="font-semibold text-foreground">
                    Discard unsaved cards?
                  </h3>
                  <p class="text-sm text-muted-foreground">
                    You have{' '}
                    <strong>{aiPreviewCards.length} generated cards</strong>{' '}
                    that haven't been saved yet. The session will be available
                    for 24 hours — you can resume it later from the deck view.
                  </p>
                  <div class="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAiConfirmDiscard(false)}
                    >
                      Keep editing
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={forceClose}
                    >
                      Close anyway
                    </Button>
                  </div>
                </div>
              </div>
            </Show>

            {/* Body */}
            <div class="flex-1 overflow-y-auto p-5 space-y-4">
              <Show
                when={aiPreviewOpen()}
                fallback={
                  <Show
                    when={aiGenerating()}
                    fallback={
                      /* ── Input phase ── */
                      <div class="space-y-4">
                        {/* Back language selector */}
                        <div class="space-y-2">
                          <label class="text-sm font-medium text-foreground">
                            Back (explanation) language
                          </label>
                          <div class="flex gap-2">
                            <For
                              each={
                                [
                                  { value: 'vi', label: '🇻🇳 Tiếng Việt' },
                                  { value: 'en', label: '🇬🇧 English' },
                                ] as const
                              }
                            >
                              {(opt) => (
                                <button
                                  type="button"
                                  onClick={() => setAiBackLang(opt.value)}
                                  class={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                                    aiBackLang() === opt.value
                                      ? 'border-palette-4 bg-palette-4/10 text-foreground'
                                      : 'border-border bg-background text-muted-foreground hover:border-palette-4/50'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>

                        {/* Source text */}
                        <div class="space-y-2">
                          <label class="text-sm font-medium text-foreground">
                            Paste your notes, text, or describe a topic
                          </label>
                          <Textarea
                            placeholder={`Enter or paste text to generate flashcards from... (min ${AI_SOURCE_MIN_CHARS} characters)`}
                            value={aiSourceText()}
                            onInput={(e) => {
                              const raw = e.currentTarget.value;
                              const val = raw.slice(0, AI_SOURCE_MAX_CHARS);
                              if (raw !== val) e.currentTarget.value = val;
                              setAiSourceText(val);
                            }}
                            class="min-h-50 resize-y"
                          />
                          <div class="flex justify-between text-xs">
                            <Show
                              when={
                                aiSourceText().trim().length > 0 &&
                                aiSourceText().trim().length < AI_SOURCE_MIN_CHARS
                              }
                            >
                              <span class="text-destructive">
                                Need at least {AI_SOURCE_MIN_CHARS} characters
                              </span>
                            </Show>
                            <span
                              class="ml-auto"
                              classList={{
                                'text-destructive':
                                  aiSourceText().length >= AI_SOURCE_MAX_CHARS,
                                'text-amber-500':
                                  aiSourceText().length >= AI_SOURCE_MAX_CHARS * 0.9,
                                'text-muted-foreground':
                                  aiSourceText().length < AI_SOURCE_MAX_CHARS * 0.9,
                              }}
                            >
                              {aiSourceText().length.toLocaleString()} /{' '}
                              {AI_SOURCE_MAX_CHARS.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    }
                  >
                    {/* ── Generating state ── */}
                    <div class="flex flex-col items-center justify-center py-16 gap-6">
                      <Spinner size="lg" />
                      <div class="text-center space-y-1.5">
                        <p class="text-sm font-medium text-foreground">
                          AI is generating your flashcards…
                        </p>
                        <p class="text-xs text-muted-foreground max-w-xs">
                          You can close this modal anytime — generation runs in
                          the background and you can resume when it's done.
                        </p>
                      </div>
                    </div>
                  </Show>
                }
              >
                {/* ── Preview phase ── */}
                <div class="space-y-1">
                  <p class="text-sm text-muted-foreground">
                    Review and edit generated cards before saving.
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {aiPreviewCards.length} cards generated
                  </p>
                </div>
                <div class="space-y-3">
                  <For each={aiPreviewCards}>
                    {(card, getIdx) => (
                      <div class="border rounded-lg p-4 space-y-3 bg-background">
                        {/* Card header */}
                        <div class="flex items-center justify-between">
                          <div class="flex items-center gap-2">
                            <span class="text-xs font-medium text-muted-foreground">
                              Card {getIdx() + 1}
                            </span>
                            <Show when={card.wordType || card.ipa}>
                              <div class="flex items-center gap-1">
                                <Show when={card.wordType}>
                                  <span class="text-xs px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
                                    {card.wordType}
                                  </span>
                                </Show>
                                <Show when={card.ipa}>
                                  <span class="text-xs px-1.5 py-0.5 rounded bg-muted border font-mono text-muted-foreground">
                                    {card.ipa}
                                  </span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="h-6 w-6 text-destructive"
                            onClick={() =>
                              setAiPreviewCards(
                                produce((c) => {
                                  c.splice(getIdx(), 1);
                                }),
                              )
                            }
                          >
                            <Trash2 class="h-3 w-3" />
                          </Button>
                        </div>

                        {/* Front */}
                        <div>
                          <label class="text-xs text-muted-foreground">Front</label>
                          <Textarea
                            value={card.front}
                            onInput={(e) =>
                              setAiPreviewCards(getIdx(), 'front', e.currentTarget.value)
                            }
                            class="mt-1 min-h-15"
                          />
                        </div>

                        {/* Back */}
                        <div>
                          <label class="text-xs text-muted-foreground">Back</label>
                          <Textarea
                            value={card.back}
                            onInput={(e) =>
                              setAiPreviewCards(getIdx(), 'back', e.currentTarget.value)
                            }
                            class="mt-1 min-h-15"
                          />
                        </div>

                        {/* Examples */}
                        <Show when={card.examples}>
                          <div class="pt-1 border-t">
                            <p class="text-xs font-medium text-muted-foreground mb-1">
                              Examples
                            </p>
                            <p class="text-xs text-muted-foreground italic leading-relaxed whitespace-pre-line">
                              {card.examples}
                            </p>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Footer */}
            <div class="flex items-center justify-end gap-2 p-5 border-t">
              <Show
                when={aiPreviewOpen()}
                fallback={
                  <Show
                    when={aiGenerating()}
                    fallback={
                      <>
                        <Button variant="outline" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button
                          onClick={handleAiGenerate}
                          disabled={
                            aiSourceText().trim().length < AI_SOURCE_MIN_CHARS ||
                            aiSourceText().length > AI_SOURCE_MAX_CHARS
                          }
                        >
                          <Sparkles class="h-4 w-4 mr-2" />
                          Generate Cards
                        </Button>
                      </>
                    }
                  >
                    <Button variant="outline" onClick={closeModal}>
                      Close — run in background
                    </Button>
                  </Show>
                }
              >
                <Button
                  variant="outline"
                  onClick={() => {
                    setAiPreviewOpen(false);
                    setAiJobId(null);
                  }}
                >
                  Back to Edit
                </Button>
                <Button
                  onClick={handleAiSave}
                  disabled={aiSaving() || !aiPreviewCards.length}
                >
                  <Show
                    when={aiSaving()}
                    fallback={<Save class="h-4 w-4 mr-2" />}
                  >
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                  </Show>
                  {aiSaving()
                    ? 'Saving...'
                    : `Save ${aiPreviewCards.length} Cards`}
                </Button>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default AiGenerateModal;
