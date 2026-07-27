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
  const [aiFetching, setAiFetching] = createSignal(false);
  const [aiPreviewOpen, setAiPreviewOpen] = createSignal(false);
  const [aiPreviewCards, setAiPreviewCards] = createStore<AiPreviewCard[]>([]);
  const [aiJobId, setAiJobId] = createSignal<string | null>(null);
  const [aiSaving, setAiSaving] = createSignal(false);
  const [aiConfirmDiscard, setAiConfirmDiscard] = createSignal(false);

  let dialogRef: HTMLDivElement | undefined;
  let confirmRef: HTMLDivElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;
  let previousFocus: HTMLElement | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  onCleanup(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  // Reset state when modal opens
  createEffect(() => {
    if (props.open) {
      // If resuming a pending/processing job, load its data
      const job = props.pendingJob;
      if (job) {
        setAiJobId(job.id);
        if (job.status === 'processing') {
          setAiGenerating(true);
        } else if (job.status === 'pending') {
          // It's already pending, but we need the full generatedCards payload
          // which might not be in the list endpoint from parent. 
          // Polling once will fetch it and transition to preview phase.
          setAiFetching(true); // Show fetching spinner
        }
        startPolling(job.id);
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
          setAiFetching(false);
          setAiPreviewCards(reconcile((data.generatedCards as any[]) ?? []));
          setAiPreviewOpen(true);
        } else if (data.status === 'failed') {
          stopPolling();
          setAiGenerating(false);
          setAiFetching(false);
          setAiJobId(null);
          toast.error(data.errorMessage ?? 'AI generation failed');
        }
      } catch {
        // Network hiccup, keep polling.
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
      toast.success(`${aiPreviewCards.length} cards saved.`);
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
      setAiFetching(false);
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
      setAiFetching(false);
    });
    setAiPreviewCards(reconcile([]));
    props.onClose();
  };

  createEffect(() => {
    if (!props.open) return;

    previousFocus = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => closeButtonRef?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (aiConfirmDiscard()) {
          setAiConfirmDiscard(false);
        } else {
          closeModal();
        }
        return;
      }

      if (event.key !== 'Tab') return;
      const scope =
        aiConfirmDiscard() && confirmRef ? confirmRef : dialogRef;
      if (!scope) return;

      const focusable = Array.from(
        scope.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('aria-hidden'));

      if (focusable.length === 0) {
        event.preventDefault();
        scope.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
      previousFocus = null;
    });
  });

  createEffect(() => {
    if (!aiConfirmDiscard()) return;
    const focusFrame = requestAnimationFrame(() => {
      confirmRef
        ?.querySelector<HTMLButtonElement>('button:not([disabled])')
        ?.focus();
    });
    onCleanup(() => cancelAnimationFrame(focusFrame));
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-overlay sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-modal-title"
          aria-describedby="ai-modal-description"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            ref={dialogRef}
            class="relative flex h-[100dvh] w-full max-w-2xl flex-col border bg-card shadow-xl outline-none motion-safe:animate-fade-in sm:h-auto sm:max-h-[88dvh] sm:rounded-xl"
            style={{ 'overscroll-behavior': 'contain' }}
            tabindex="-1"
          >
            {/* Header */}
            <div
              class="flex items-start justify-between gap-4 border-b p-4 sm:p-5"
              aria-hidden={aiConfirmDiscard() || undefined}
            >
              <div class="flex min-w-0 items-start gap-3">
                <div class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-info-surface text-info">
                  <Sparkles class="h-4 w-4" />
                </div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2
                      id="ai-modal-title"
                      class="text-lg font-semibold tracking-tight text-foreground"
                    >
                      Generate cards with AI
                    </h2>
                    <Show when={aiGenerating()}>
                      <span class="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                        Generating
                      </span>
                    </Show>
                  </div>
                  <p
                    id="ai-modal-description"
                    class="mt-1 text-sm text-muted-foreground"
                  >
                    Turn notes or a topic into editable card drafts.
                  </p>
                </div>
              </div>
              <Button
                ref={closeButtonRef}
                variant="ghost"
                size="icon"
                class="h-9 w-9 shrink-0"
                onClick={closeModal}
                aria-label="Close AI card generator"
                title="Close"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>

            {/* Layer 2: Confirm discard overlay */}
            <Show when={aiConfirmDiscard()}>
              <div class="absolute inset-0 z-10 flex items-center justify-center bg-overlay p-4 sm:rounded-xl">
                <div
                  ref={confirmRef}
                  class="w-full max-w-sm space-y-4 rounded-lg border bg-card p-5 shadow-xl outline-none sm:p-6"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="discard-ai-title"
                  aria-describedby="discard-ai-description"
                  tabindex="-1"
                >
                  <h3
                    id="discard-ai-title"
                    class="font-semibold text-foreground"
                  >
                    Discard unsaved cards?
                  </h3>
                  <p
                    id="discard-ai-description"
                    class="text-sm text-muted-foreground"
                  >
                    You have{' '}
                    <strong>{aiPreviewCards.length} generated cards</strong>{' '}
                    that haven't been saved yet. The session will be available
                    for 24 hours. You can resume it later from the deck view.
                  </p>
                  <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      variant="outline"
                      onClick={() => setAiConfirmDiscard(false)}
                    >
                      Keep editing
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={forceClose}
                    >
                      Close anyway
                    </Button>
                  </div>
                </div>
              </div>
            </Show>

            {/* Body */}
            <div
              class="flex-1 space-y-5 overflow-y-auto bg-surface p-4 sm:p-5"
              aria-hidden={aiConfirmDiscard() || undefined}
              aria-busy={
                aiGenerating() || aiFetching() || aiSaving() || undefined
              }
            >
              <Show
                when={aiPreviewOpen()}
                fallback={
                  <Show
                    when={aiFetching()}
                    fallback={
                      <Show
                        when={aiGenerating()}
                        fallback={
                          /* ── Input phase ── */
                          <div class="space-y-5">
                            {/* Back language selector */}
                            <fieldset class="space-y-2">
                              <legend class="text-sm font-medium text-foreground">
                                Back (explanation) language
                              </legend>
                              <div
                                class="grid grid-cols-2 gap-2"
                                role="radiogroup"
                                aria-label="Card explanation language"
                              >
                                <For
                                  each={
                                    [
                                      { value: 'vi', label: 'Vietnamese' },
                                      { value: 'en', label: 'English' },
                                    ] as const
                                  }
                                >
                                  {(opt) => (
                                    <button
                                      type="button"
                                      role="radio"
                                      aria-checked={aiBackLang() === opt.value}
                                      onClick={() => setAiBackLang(opt.value)}
                                      class={`rounded-md border px-4 py-2.5 text-sm font-medium transition-[background-color,border-color,color] ${
                                        aiBackLang() === opt.value
                                          ? 'border-primary bg-primary text-primary-foreground'
                                          : 'border-input bg-card text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  )}
                                </For>
                              </div>
                            </fieldset>
    
                            {/* Source text */}
                            <div class="space-y-2">
                              <label
                                for="ai-source-text"
                                class="text-sm font-medium text-foreground"
                              >
                                Paste your notes, text, or describe a topic
                              </label>
                              <Textarea
                                id="ai-source-text"
                                placeholder={`Enter or paste at least ${AI_SOURCE_MIN_CHARS} characters`}
                                value={aiSourceText()}
                                onInput={(e) => {
                                  const raw = e.currentTarget.value;
                                  const val = raw.slice(0, AI_SOURCE_MAX_CHARS);
                                  if (raw !== val) e.currentTarget.value = val;
                                  setAiSourceText(val);
                                }}
                                class="min-h-52 resize-y bg-card"
                                aria-invalid={
                                  (aiSourceText().trim().length > 0 &&
                                    aiSourceText().trim().length <
                                      AI_SOURCE_MIN_CHARS) ||
                                  undefined
                                }
                                aria-describedby={
                                  aiSourceText().trim().length > 0 &&
                                  aiSourceText().trim().length <
                                    AI_SOURCE_MIN_CHARS
                                    ? 'ai-source-help ai-source-count'
                                    : 'ai-source-count'
                                }
                              />
                              <div class="flex items-start justify-between gap-3 text-xs">
                                <Show
                                  when={
                                    aiSourceText().trim().length > 0 &&
                                    aiSourceText().trim().length < AI_SOURCE_MIN_CHARS
                                  }
                                >
                                  <span
                                    id="ai-source-help"
                                    class="text-destructive"
                                  >
                                    Need at least {AI_SOURCE_MIN_CHARS} characters
                                  </span>
                                </Show>
                                <span
                                  id="ai-source-count"
                                  class="ml-auto"
                                  classList={{
                                    'text-destructive':
                                      aiSourceText().length >= AI_SOURCE_MAX_CHARS,
                                    'text-warning':
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
                        <div class="flex flex-col items-center justify-center gap-5 py-16">
                          <Spinner size="lg" />
                          <div class="text-center space-y-1.5">
                            <p class="text-sm font-medium text-foreground">
                              AI is generating your flashcards…
                            </p>
                            <p class="text-xs text-muted-foreground max-w-xs">
                              You can close this modal at any time. Generation
                              continues in the background.
                            </p>
                          </div>
                        </div>
                      </Show>
                    }
                  >
                    {/* ── Fetching state ── */}
                    <div class="flex flex-col items-center justify-center gap-5 py-16">
                      <Spinner size="lg" />
                      <div class="text-center space-y-1.5">
                        <p class="text-sm font-medium text-foreground">
                          Loading your cards…
                        </p>
                        <p class="text-xs text-muted-foreground max-w-xs mx-auto">
                          Please wait a moment while we retrieve your generated cards.
                        </p>
                      </div>
                    </div>
                  </Show>
                }
              >
                {/* ── Preview phase ── */}
                <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 class="text-sm font-semibold text-foreground">
                      Review generated cards
                    </h3>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      Edit the front and back before saving.
                    </p>
                  </div>
                  <p class="text-xs tabular-nums text-muted-foreground">
                    {aiPreviewCards.length} card
                    {aiPreviewCards.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div class="space-y-2.5">
                  <For each={aiPreviewCards}>
                    {(card, getIdx) => (
                      <article class="space-y-4 rounded-lg border bg-card p-4">
                        {/* Card header */}
                        <div class="flex items-center justify-between">
                          <div class="flex items-center gap-2">
                            <span class="text-xs font-medium tabular-nums text-muted-foreground">
                              Card {getIdx() + 1}
                            </span>
                            <Show when={card.wordType || card.ipa}>
                              <div class="flex flex-wrap items-center gap-1.5">
                                <Show when={card.wordType}>
                                  <span class="rounded-sm border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                    {card.wordType}
                                  </span>
                                </Show>
                                <Show when={card.ipa}>
                                  <span class="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                                    {card.ipa}
                                  </span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="h-8 w-8 text-muted-foreground hover:bg-destructive-surface hover:text-destructive"
                            onClick={() =>
                              setAiPreviewCards(
                                produce((c) => {
                                  c.splice(getIdx(), 1);
                                }),
                              )
                            }
                            aria-label={`Remove generated card ${
                              getIdx() + 1
                            }`}
                            title="Remove card"
                          >
                            <Trash2 class="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        {/* Front */}
                        <div class="space-y-1.5">
                          <label
                            for={`ai-card-${getIdx()}-front`}
                            class="text-xs font-medium text-foreground"
                          >
                            Front
                          </label>
                          <Textarea
                            id={`ai-card-${getIdx()}-front`}
                            value={card.front}
                            onInput={(e) =>
                              setAiPreviewCards(getIdx(), 'front', e.currentTarget.value)
                            }
                            class="min-h-20 bg-card"
                          />
                        </div>

                        {/* Back */}
                        <div class="space-y-1.5">
                          <label
                            for={`ai-card-${getIdx()}-back`}
                            class="text-xs font-medium text-foreground"
                          >
                            Back
                          </label>
                          <Textarea
                            id={`ai-card-${getIdx()}-back`}
                            value={card.back}
                            onInput={(e) =>
                              setAiPreviewCards(getIdx(), 'back', e.currentTarget.value)
                            }
                            class="min-h-20 bg-card"
                          />
                        </div>

                        {/* Examples */}
                        <Show when={card.examples}>
                          <div class="border-t pt-3">
                            <p class="mb-1 text-xs font-medium text-foreground">
                              Examples
                            </p>
                            <p class="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                              {card.examples}
                            </p>
                          </div>
                        </Show>
                      </article>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Footer */}
            <div
              class="flex flex-col-reverse gap-2 border-t bg-card p-4 sm:flex-row sm:items-center sm:justify-end sm:p-5"
              aria-hidden={aiConfirmDiscard() || undefined}
            >
              <Show
                when={aiPreviewOpen()}
                fallback={
                  <Show
                    when={aiGenerating() || aiFetching()}
                    fallback={
                      <>
                        <Button
                          variant="outline"
                          onClick={closeModal}
                          class="w-full sm:w-auto"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleAiGenerate}
                          class="w-full sm:w-auto"
                          disabled={
                            aiSourceText().trim().length < AI_SOURCE_MIN_CHARS ||
                            aiSourceText().length > AI_SOURCE_MAX_CHARS
                          }
                        >
                          <Sparkles class="h-4 w-4" />
                          Generate cards
                        </Button>
                      </>
                    }
                  >
                    <Button
                      variant="outline"
                      onClick={closeModal}
                      class="w-full sm:w-auto"
                    >
                      {aiFetching()
                        ? 'Close'
                        : 'Close and run in background'}
                    </Button>
                  </Show>
                }
              >
                <Button
                  variant="outline"
                  class="w-full sm:w-auto"
                  onClick={() => {
                    setAiPreviewOpen(false);
                    setAiJobId(null);
                  }}
                >
                  Back to Edit
                </Button>
                <Button
                  onClick={handleAiSave}
                  loading={aiSaving()}
                  disabled={!aiPreviewCards.length}
                  class="w-full sm:w-auto"
                >
                  <Show when={!aiSaving()}>
                    <Save class="h-4 w-4" />
                  </Show>
                  Save {aiPreviewCards.length} card
                  {aiPreviewCards.length !== 1 ? 's' : ''}
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
