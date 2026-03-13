import { type Component, createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Sidebar from '@/components/layout/sidebar';
import MobileNav from '@/components/layout/mobile-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { currentUser } from '@/stores/auth.store';
import { toast } from '@/stores/toast.store';
import { api } from '@/api/client';
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
      await (api as any).feedback.post({
        type: feedbackType(),
        subject:
          subject().trim() ||
          `[${feedbackType()}] Feedback from ${currentUser()?.email ?? 'user'}`,
        message: message().trim(),
        contactEmail: contactEmail().trim() || undefined,
      });
      setSent(true);
      toast.success('Feedback sent successfully!');
    } catch {
      toast.error('Failed to send feedback. Please try again.');
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
    <div class="h-screen flex overflow-hidden">
      <Sidebar />
      <div class="flex flex-col flex-1 overflow-hidden">
        <MobileNav />
        <main id="main-content" class="flex-1 overflow-y-auto pb-mobile-nav">
          <div class="p-6">
            <div class="max-w-2xl mx-auto space-y-6">
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
                  <h1 class="text-xl font-bold">Report / Feedback</h1>
                  <p class="text-sm text-muted-foreground">
                    Help us improve Engram Spira
                  </p>
                </div>
              </div>

              <Show
                when={!sent()}
                fallback={
                  /* ── Success state ── */
                  <div class="border rounded-xl bg-card p-8 text-center space-y-4">
                    <div class="inline-flex h-16 w-16 rounded-full bg-green-50 dark:bg-green-900/20 items-center justify-center mx-auto">
                      <CheckCircle2 class="h-8 w-8 text-green-500" />
                    </div>
                    <div>
                      <p class="text-lg font-semibold text-foreground">
                        Thank you for your feedback!
                      </p>
                      <p class="text-sm text-muted-foreground mt-1">
                        We appreciate you taking the time to help us improve.
                      </p>
                    </div>
                    <div class="flex gap-3 justify-center pt-2">
                      <Button variant="outline" onClick={handleReset}>
                        Send another
                      </Button>
                      <Button onClick={() => navigate('/')}>
                        Back to Dashboard
                      </Button>
                    </div>
                  </div>
                }
              >
                {/* ── Feedback type selection ── */}
                <div class="grid grid-cols-3 gap-3">
                  {FEEDBACK_TYPES.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        class={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors cursor-pointer text-center ${
                          feedbackType() === opt.value
                            ? 'border-palette-5 bg-palette-5/10 text-slate-700 dark:text-palette-5'
                            : 'border bg-card text-muted-foreground hover:bg-muted/50 border-border'
                        }`}
                        onClick={() => setFeedbackType(opt.value)}
                      >
                        <Icon class="h-5 w-5" />
                        <span class="text-sm font-medium">{opt.label}</span>
                        <span class="text-xs opacity-70 leading-tight">
                          {opt.description}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* ── Feedback form ── */}
                <form
                  onSubmit={handleSubmit}
                  class="border rounded-xl bg-card p-6 space-y-4"
                >
                  <div class="space-y-1">
                    <label class="text-sm font-medium text-foreground">
                      Subject{' '}
                      <span class="text-muted-foreground font-normal">
                        (optional)
                      </span>
                    </label>
                    <Input
                      placeholder="Brief summary of your feedback..."
                      value={subject()}
                      onInput={(e) => setSubject(e.currentTarget.value)}
                    />
                  </div>

                  <div class="space-y-1">
                    <label class="text-sm font-medium text-foreground">
                      Message <span class="text-destructive">*</span>
                    </label>
                    <Textarea
                      placeholder="Describe your feedback in detail..."
                      value={message()}
                      onInput={(e) => setMessage(e.currentTarget.value)}
                      required
                      class="min-h-40"
                    />
                  </div>

                  <div class="space-y-1">
                    <label class="text-sm font-medium text-foreground">
                      Your email{' '}
                      <span class="text-muted-foreground font-normal">
                        (optional — so we can reply to you)
                      </span>
                    </label>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={contactEmail()}
                      onInput={(e) => setContactEmail(e.currentTarget.value)}
                    />
                  </div>

                  <div class="flex items-center justify-between pt-2">
                    <p class="text-xs text-muted-foreground">
                      Feedback will be sent to the development team.
                    </p>
                    <Button
                      type="submit"
                      disabled={sending() || !message().trim()}
                    >
                      <Send class="h-4 w-4 mr-2" />
                      {sending() ? 'Sending...' : 'Send Feedback'}
                    </Button>
                  </div>
                </form>
              </Show>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default FeedbackPage;
