import Elysia from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as embeddingService from './embedding.service';

export const embeddingRoutes = new Elysia({ prefix: '/embedding' })
  .use(requireAuth)
  .get('/status', () => embeddingService.getEmbeddingStatus())
  .post('/backfill', async () => {
    // Trigger backfill in background — return immediately
    const promise = embeddingService.backfillEmbeddings();
    promise.catch(() => {}); // swallow — logged internally
    return { started: true, message: 'Embedding backfill started in background' };
  });
