import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as cardTemplatesService from './card-templates.service';

export const cardTemplatesRoutes = new Elysia({ prefix: '/card-templates' })
  .use(requireAuth)
  .get('/', ({ currentUser }) =>
    cardTemplatesService.listAvailable(currentUser.id),
  )
  .get('/:id', ({ params }) => cardTemplatesService.getWithFields(params.id))
  .post(
    '/',
    ({ currentUser, body }) =>
      cardTemplatesService.create(currentUser.id, body),
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        fields: t.Array(
          t.Object({
            name: t.String({ minLength: 1 }),
            fieldType: t.String(),
            side: t.String(),
            sortOrder: t.Number(),
            isRequired: t.Optional(t.Boolean()),
            config: t.Optional(t.Unknown()),
          }),
        ),
      }),
    },
  );
