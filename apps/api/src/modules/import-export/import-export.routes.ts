import { Elysia, t } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import { requireAuth } from '../auth/auth.middleware';
import * as importExportService from './import-export.service';

const MAX_CSV_BYTES = 2 * 1024 * 1024;

export const importExportRoutes = new Elysia()
  .use(
    rateLimit({
      duration: 60 * 1000,
      max: 15,
      errorResponse: new Response(
        JSON.stringify({ error: 'Too many import/export requests' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    }),
  )
  .use(requireAuth)
  // ── Import CSV ─────────────────────────────────────────────
  .post(
    '/import/csv/:deckId',
    async ({ params, body, currentUser }) => {
      let csvText: string;

      if (typeof body.csv === 'string') {
        if (body.csv.length > MAX_CSV_BYTES) {
          return { error: 'CSV is too large. Max size is 2MB.' };
        }
        csvText = body.csv;
      } else if (body.file) {
        if (body.file.size > MAX_CSV_BYTES) {
          return { error: 'CSV file is too large. Max size is 2MB.' };
        }
        csvText = await body.file.text();
      } else {
        return { error: 'Provide either csv (string) or file (File upload)' };
      }

      return importExportService.importCSV(
        params.deckId,
        currentUser.id,
        csvText,
      );
    },
    {
      params: t.Object({ deckId: t.String({ format: 'uuid' }) }),
      body: t.Object({
        csv: t.Optional(t.String()),
        file: t.Optional(t.File({ type: 'text/csv' })),
      }),
    },
  )
  // ── Export CSV ─────────────────────────────────────────────
  .get(
    '/export/:deckId',
    async ({ params, query, set, currentUser }) => {
      const format = query.format ?? 'csv';

      if (format === 'json') {
        const result = await importExportService.exportJSON(
          params.deckId,
          currentUser.id,
        );
        return result.json;
      }

      // CSV — return as downloadable file
      const result = await importExportService.exportCSV(
        params.deckId,
        currentUser.id,
      );

      const safeName = result.deckName.replace(/[^a-zA-Z0-9_-]/g, '_');
      set.headers['Content-Type'] = 'text/csv; charset=utf-8';
      set.headers['Content-Disposition'] =
        `attachment; filename="${safeName}.csv"`;
      return result.csv;
    },
    {
      params: t.Object({ deckId: t.String({ format: 'uuid' }) }),
      query: t.Object({
        format: t.Optional(t.Union([t.Literal('csv'), t.Literal('json')])),
      }),
    },
  );
