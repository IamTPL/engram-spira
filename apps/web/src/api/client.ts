import { treaty } from '@elysiajs/eden';
import type { App } from '../../../api/src/index';
import type { ReviewAction } from '../../../api/src/shared/constants';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const api = treaty<App>(API_URL, {
  fetch: {
    credentials: 'include',
  },
});

// Explicitly define the type for `api.study.review.post`
api.study.review.post as unknown as (body: {
  cardId: string;
  action: ReviewAction;
}) => Promise<void>;
