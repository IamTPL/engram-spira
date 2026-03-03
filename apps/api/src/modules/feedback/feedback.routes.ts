import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import { sendFeedbackEmail } from '../../shared/email';

/**
 * Feedback routes — accepts user feedback and sends an email notification.
 */
export const feedbackRoutes = new Elysia({ prefix: '/feedback' })
  .use(requireAuth)
  .post(
    '/',
    async ({ body, currentUser }) => {
      const { type, subject, message, contactEmail } = body;

      // Fire-and-forget: don't block response if email fails
      sendFeedbackEmail({
        fromEmail: currentUser.email,
        contactEmail,
        type,
        subject,
        message,
      }).catch((err) => {
        console.error('[feedback] Failed to send email:', err.message);
      });

      return { success: true };
    },
    {
      body: t.Object({
        type: t.Union([
          t.Literal('bug'),
          t.Literal('feature'),
          t.Literal('general'),
        ]),
        subject: t.String(),
        message: t.String({ minLength: 1 }),
        contactEmail: t.Optional(t.String()),
      }),
    },
  );
