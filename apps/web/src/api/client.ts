import { treaty } from '@elysiajs/eden';
import type { App } from '../../../api/src/index';
import type { ReviewAction } from '../../../api/src/shared/constants';

export const api = treaty<App>('http://localhost:3001', {
  fetch: {
    credentials: 'include',
  },
});

// Explicitly define the type for `api.study.review.post`
api.study.review.post as unknown as (body: {
  cardId: string;
  action: ReviewAction;
}) => Promise<void>;
