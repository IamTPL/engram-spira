import { t } from 'elysia';

export const MAX_STUDY_CLUSTER_CARDS = 12;

const UUID_PATTERN =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const CARD_IDS_PATTERN = `^${UUID_PATTERN}(,${UUID_PATTERN}){0,${
  MAX_STUDY_CLUSTER_CARDS - 1
}}$`;
const MAX_CARD_IDS_QUERY_LENGTH =
  MAX_STUDY_CLUSTER_CARDS * 36 + (MAX_STUDY_CLUSTER_CARDS - 1);

export const studyDeckQuerySchema = t.Object({
  mode: t.Optional(t.Literal('all')),
  cardIds: t.Optional(
    t.String({
      minLength: 36,
      maxLength: MAX_CARD_IDS_QUERY_LENGTH,
      pattern: CARD_IDS_PATTERN,
    }),
  ),
});

export function parseStudyCardIds(value: string | undefined) {
  return value === undefined ? undefined : value.split(',');
}
