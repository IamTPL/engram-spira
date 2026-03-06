import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { ENV } from './config/env';
import { AppError } from './shared/errors';

// Import routes
import { authRoutes } from './modules/auth/auth.routes';
import { classesRoutes } from './modules/classes/classes.routes';
import { foldersRoutes } from './modules/folders/folders.routes';
import { decksRoutes } from './modules/decks/decks.routes';
import { cardTemplatesRoutes } from './modules/card-templates/card-templates.routes';
import { cardsRoutes } from './modules/cards/cards.routes';
import { studyRoutes } from './modules/study/study.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { feedbackRoutes } from './modules/feedback/feedback.routes';
import { usersRoutes } from './modules/users/users.routes';
import { importExportRoutes } from './modules/import-export/import-export.routes';
import { aiRoutes } from './modules/ai/ai.routes';

const app = new Elysia({ aot: true })
  .use(
    cors({
      origin:
        ENV.NODE_ENV === 'production' ? false : /^http:\/\/localhost:\d+$/,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  )
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.statusCode;
      return { error: error.message };
    }

    // Elysia validation errors
    if ('message' in error && error.message === 'Unauthorized') {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    console.error('Unhandled error:', error);
    set.status = 500;
    return { error: 'Internal server error' };
  })
  .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
  .use(authRoutes)
  .use(classesRoutes)
  .use(foldersRoutes)
  .use(decksRoutes)
  .use(cardTemplatesRoutes)
  .use(cardsRoutes)
  .use(studyRoutes)
  .use(notificationsRoutes)
  .use(feedbackRoutes)
  .use(usersRoutes)
  .use(importExportRoutes)
  .use(aiRoutes)
  .listen(ENV.PORT);

console.log(`API server running at http://localhost:${ENV.PORT}`);

export type App = typeof app;
