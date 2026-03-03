import Elysia from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as notificationsService from './notifications.service';

export const notificationsRoutes = new Elysia({ prefix: '/notifications' })
  .use(requireAuth)
  /**
   * GET /notifications/due-decks
   * Returns all decks with due cards for the authenticated user.
   */
  .get('/due-decks', ({ currentUser }) =>
    notificationsService.getDueDecks(currentUser.id),
  )
  /**
   * GET /notifications/due-count
   * Returns the total number of due cards across all decks (for badge).
   */
  .get('/due-count', async ({ currentUser }) => {
    const total = await notificationsService.getTotalDueCount(currentUser.id);
    return { total };
  });
