import { type Component, createSignal, For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import PageShell from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { currentUser } from '@/stores/auth.store';
import { toast } from '@/stores/toast.store';
import { api, getApiError } from '@/api/client';
import {
  ArrowLeft,
  MessageSquare,
  Bug,
  Lightbulb,
  HelpCircle,
  Send,
  CheckCircle2,
} from 'lucide-solid';

type FeedbackType = 'bug' | 'feature' | 'general';

const FEEDBACK_TYPES: {
  value: FeedbackType;
  label: string;
  icon: any;
  description: string;
}[] = [
  {
    value: 'bug',
    label: 'Bug Report',
    icon: Bug,
    description: 'Something is broken or not working as expected',
  },
  {
    value: 'feature',
    label: 'Feature Request',
    icon: Lightbulb,
    description: 'Suggest a new feature or improvement',
  },
  {
    value: 'general',
    label: 'General Feedback',
    icon: HelpCircle,
    description: 'Share your thoughts or ask a question',
  },
];

const FeedbackPage: Component = () => {
  const navigate = useNavigate();

  const [feedbackType, setFeedbackType] = createSignal<FeedbackType>('general');
  const [subject, setSubject] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [contactEmail, setContactEmail] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [sent, setSent] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!message().trim()) {
      toast.error('Please enter a message');
      return;
    }
    setSending(true);
    try {
      const { error } = await (api as any).feedback.post({
        type: feedbackType(),
        subject:
          subject().trim() ||
          `[${feedbackType()}] Feedback from ${currentUser()?.email ?? 'user'}`,
        message: message().trim(),
        contactEmail: contactEmail().trim() || undefined,
      });
      if (error) throw new Error(getApiError(error));
      setSent(true);
      toast.success('Feedback sent successfully!');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to send feedback. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleReset = () => {
    setSent(false);
    setSubject('');
    setMessage('');
    setContactEmail('');
    setFeedbackType('general');
  };

  return (
    <PageShell maxWidth="max-w-5xl">
      <div class="animate-fade-in space-y-8">
        {/* Header */}
        <header class="flex items-start gap-4 border-b pb-7">
          <Button
            variant="ghost"
            size="icon"
            class="mt-0.5 h-9 w-9 shrink-0"
            onClick={() => navigate('/')}
            aria-label="Back to dashboard"
          >
            <ArrowLeft class="h-4 w-4" />
          </Button>
          <div class="min-w-0">
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Product feedback
            </p>
            <h1 class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Help shape Engram Spira
            </h1>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Report a problem, request an improvement, or tell us what would make
              studying feel better.
            </p>
          </div>
        </header>

        <Show
          when={!sent()}
          fallback={
            /* ── Success state ── */
            <div
              class="rounded-xl border bg-card p-6 shadow-xs sm:p-8"
              role="status"
              aria-live="polite"
            >
              <div class="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-success/10">
                  <CheckCircle2 class="h-5 w-5 text-success" />
                </div>
                <div class="min-w-0 flex-1">
                  <h2 class="text-xl font-semibold tracking-tight text-foreground">
                    Feedback received
                  </h2>
                  <p class="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    Thank you for taking the time to help us improve Engram Spira.
                    Your message is now with the development team.
                  </p>
                  <div class="mt-6 flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={handleReset}>
                      Send another
                    </Button>
                    <Button onClick={() => navigate('/')}>
                      Back to Dashboard
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          }
        >
          <div class="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
            {/* ── Feedback type selection ── */}
            <fieldset class="min-w-0">
              <legend class="text-base font-semibold text-foreground">
                What can we help with?
              </legend>
              <p class="mt-1 text-sm leading-5 text-muted-foreground">
                Pick the category that best matches your message.
              </p>
              <div
                class="mt-4 grid gap-2"
                role="radiogroup"
                aria-label="Feedback type"
              >
                <For each={FEEDBACK_TYPES}>
                  {(opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={feedbackType() === opt.value}
                        class={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          feedbackType() === opt.value
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                        onClick={() => setFeedbackType(opt.value)}
                      >
                        <Icon class="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <span class="block text-sm font-semibold">{opt.label}</span>
                          <span
                            class={`mt-1 block text-xs leading-5 ${
                              feedbackType() === opt.value
                                ? 'text-background/70'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {opt.description}
                          </span>
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </fieldset>

            {/* ── Feedback form ── */}
            <form
              onSubmit={handleSubmit}
              class="space-y-5 rounded-xl border bg-card p-5 shadow-xs sm:p-6"
              aria-busy={sending()}
            >
              <div class="flex items-start gap-3 border-b pb-5">
                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <MessageSquare class="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <h2 class="text-base font-semibold text-foreground">
                    Share the details
                  </h2>
                  <p class="mt-1 text-sm text-muted-foreground">
                    Specific examples help the team respond faster.
                  </p>
                </div>
              </div>

              <div class="space-y-2">
                <label for="feedback-subject" class="text-sm font-medium text-foreground">
                  Subject{' '}
                  <span class="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="feedback-subject"
                  placeholder="Brief summary of your feedback"
                  value={subject()}
                  onInput={(e) => setSubject(e.currentTarget.value)}
                  autocomplete="off"
                />
              </div>

              <div class="space-y-2">
                <label for="feedback-message" class="text-sm font-medium text-foreground">
                  Message <span class="text-destructive">*</span>
                </label>
                <Textarea
                  id="feedback-message"
                  placeholder="Describe your feedback in detail"
                  value={message()}
                  onInput={(e) => setMessage(e.currentTarget.value)}
                  required
                  class="min-h-44 resize-y"
                />
              </div>

              <div class="space-y-2">
                <label for="feedback-email" class="text-sm font-medium text-foreground">
                  Your email{' '}
                  <span class="font-normal text-muted-foreground">
                    (optional, so we can reply)
                  </span>
                </label>
                <Input
                  id="feedback-email"
                  type="email"
                  placeholder="your@email.com"
                  value={contactEmail()}
                  onInput={(e) => setContactEmail(e.currentTarget.value)}
                  autocomplete="email"
                />
              </div>

              <div class="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs leading-5 text-muted-foreground">
                  Feedback goes directly to the development team.
                </p>
                <Button
                  type="submit"
                  class="w-full whitespace-nowrap sm:w-auto"
                  disabled={sending() || !message().trim()}
                >
                  <Send class="mr-2 h-4 w-4" />
                  {sending() ? 'Sending...' : 'Send Feedback'}
                </Button>
              </div>
            </form>
          </div>
        </Show>
      </div>
    </PageShell>
  );
};

export default FeedbackPage;
