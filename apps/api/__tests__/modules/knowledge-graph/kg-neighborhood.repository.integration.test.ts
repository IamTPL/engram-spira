import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';

import { createPostgresCardNeighborhoodRepository } from '../../../src/modules/knowledge-graph/kg-neighborhood.repository';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const createdDatabases = new Set<string>();
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

async function canUseDisposablePostgres() {
  const admin = postgres(ADMIN_URL, {
    max: 1,
    connect_timeout: 2,
    idle_timeout: 1,
  });
  try {
    await admin`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await admin.end();
  }
}

const postgresAvailable = await canUseDisposablePostgres();
const integrationTest = postgresAvailable ? test : test.skip;

function assertDisposableDatabaseName(databaseName: string) {
  if (!/^engram_kg_neighborhood_test_[a-f0-9]+$/.test(databaseName)) {
    throw new Error(`Refusing unsafe disposable database name: ${databaseName}`);
  }
}

async function createDisposableDatabase() {
  const databaseName =
    `engram_kg_neighborhood_test_${crypto.randomUUID().replaceAll('-', '')}`;
  assertDisposableDatabaseName(databaseName);
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabases.add(databaseName);
  } finally {
    await admin.end();
  }

  const databaseUrl = new URL(ADMIN_URL);
  databaseUrl.pathname = `/${databaseName}`;
  const client = postgres(databaseUrl.toString(), {
    max: 4,
    onnotice: () => {},
  });
  await client.unsafe(`
    CREATE TABLE users (id uuid PRIMARY KEY);
    CREATE TABLE decks (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL
    );
    CREATE TABLE cards (
      id uuid PRIMARY KEY,
      deck_id uuid NOT NULL
    );
    CREATE TABLE study_progress (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      card_id uuid NOT NULL,
      ease_factor double precision NOT NULL DEFAULT 2.5,
      interval_days integer NOT NULL DEFAULT 1,
      next_review_at timestamptz NOT NULL,
      last_reviewed_at timestamptz,
      stability real
    );
    CREATE TABLE lexemes (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      language_tag text NOT NULL,
      lemma text NOT NULL,
      normalized_lemma text NOT NULL
    );
    CREATE TABLE lexical_senses (
      id uuid PRIMARY KEY,
      lexeme_id uuid NOT NULL,
      part_of_speech text NOT NULL,
      definition_language_tag text NOT NULL,
      definition text NOT NULL,
      normalized_definition text NOT NULL
    );
    CREATE TABLE card_senses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id uuid NOT NULL,
      sense_id uuid NOT NULL,
      source text NOT NULL DEFAULT 'deterministic',
      is_primary boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (card_id, sense_id)
    );
    CREATE UNIQUE INDEX uq_card_senses_primary_card
      ON card_senses (card_id)
      WHERE is_primary = true;
    CREATE TABLE sense_relations (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      source_sense_id uuid NOT NULL,
      target_sense_id uuid NOT NULL,
      relation_type text NOT NULL,
      origin text NOT NULL,
      confidence real NOT NULL,
      evidence jsonb
    );
    CREATE INDEX idx_sense_relations_source
      ON sense_relations (source_sense_id);
    CREATE INDEX idx_sense_relations_target
      ON sense_relations (target_sense_id);
  `);
  return { databaseName, client };
}

async function dropDisposableDatabase(databaseName: string) {
  assertDisposableDatabaseName(databaseName);
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    createdDatabases.delete(databaseName);
  } finally {
    await admin.end();
  }
}

afterAll(async () => {
  for (const databaseName of [...createdDatabases]) {
    await dropDisposableDatabase(databaseName);
  }
});

integrationTest(
  'loads an ownership-scoped one-hop page, learning state and accurate deck summary',
  async () => {
    // Catches whole-graph scans, cross-user edges, broken orientation, and inflated counts.
    const { databaseName, client } = await createDisposableDatabase();
    try {
      const repository = createPostgresCardNeighborhoodRepository(client);
      const userId = id(1_001);
      const otherUserId = id(1_002);
      const deckId = id(1_010);
      const otherDeckId = id(1_011);
      const ownedOtherDeckId = id(1_012);
      const sameSenseOtherCardId = id(1_019);
      const rootCardId = id(1_020);
      const auntCardId = id(1_021);
      const isolatedCardId = id(1_022);
      const unmappedCardId = id(1_023);
      const foreignCardId = id(1_024);
      const rootSenseId = id(1_030);
      const auntSenseId = id(1_031);
      const ancestorSenseId = id(1_032);
      const foreignSenseId = id(1_033);
      const lexemeIds = [id(1_040), id(1_041), id(1_042), id(1_043)];

      await client`
        INSERT INTO users (id)
        VALUES (${userId}), (${otherUserId})
      `;
      await client`
        INSERT INTO decks (id, user_id)
        VALUES
          (${deckId}, ${userId}),
          (${otherDeckId}, ${otherUserId}),
          (${ownedOtherDeckId}, ${userId})
      `;
      await client`
        INSERT INTO cards (id, deck_id)
        VALUES
          (${sameSenseOtherCardId}, ${ownedOtherDeckId}),
          (${rootCardId}, ${deckId}),
          (${auntCardId}, ${deckId}),
          (${isolatedCardId}, ${deckId}),
          (${unmappedCardId}, ${deckId}),
          (${foreignCardId}, ${otherDeckId})
      `;
      await client`
        INSERT INTO lexemes (
          id, user_id, language_tag, lemma, normalized_lemma
        )
        VALUES
          (${lexemeIds[0]}, ${userId}, 'en', 'root', 'root'),
          (${lexemeIds[1]}, ${userId}, 'en', 'Aunt', 'aunt'),
          (${lexemeIds[2]}, ${userId}, 'en', 'Ancestor', 'ancestor'),
          (${lexemeIds[3]}, ${otherUserId}, 'en', 'foreign', 'foreign')
      `;
      await client`
        INSERT INTO lexical_senses (
          id,
          lexeme_id,
          part_of_speech,
          definition_language_tag,
          definition,
          normalized_definition
        )
        VALUES
          (${rootSenseId}, ${lexemeIds[0]}, 'noun', 'vi', 'gốc', 'gốc'),
          (${auntSenseId}, ${lexemeIds[1]}, 'noun', 'vi', 'cô hoặc dì', 'cô hoặc dì'),
          (${ancestorSenseId}, ${lexemeIds[2]}, 'noun', 'vi', 'tổ tiên', 'tổ tiên'),
          (${foreignSenseId}, ${lexemeIds[3]}, 'noun', 'vi', 'ngoại lai', 'ngoại lai')
      `;
      await client`
        INSERT INTO card_senses (
          card_id, sense_id, source, is_primary
        )
        VALUES
          (${rootCardId}, ${rootSenseId}, 'deterministic', true),
          (${auntCardId}, ${auntSenseId}, 'deterministic', true),
          (${sameSenseOtherCardId}, ${auntSenseId}, 'manual', true),
          (${foreignCardId}, ${foreignSenseId}, 'deterministic', true)
      `;
      await client`
        INSERT INTO study_progress (
          id,
          user_id,
          card_id,
          interval_days,
          ease_factor,
          stability,
          last_reviewed_at,
          next_review_at
        )
        VALUES (
          ${id(1_050)},
          ${userId},
          ${auntCardId},
          8,
          2.5,
          10,
          now() - interval '2 days',
          '2030-03-04T05:06:07Z'
        )
      `;
      await client`
        INSERT INTO sense_relations (
          id,
          user_id,
          source_sense_id,
          target_sense_id,
          relation_type,
          origin,
          confidence,
          evidence
        )
        VALUES
          (
            ${id(1_060)},
            ${userId},
            ${rootSenseId},
            ${auntSenseId},
            'collocation',
            'ai',
            0.9,
            ${client.json({ source: 'root phrase', target: 'aunt phrase' })}
          ),
          (
            ${id(1_061)},
            ${userId},
            ${ancestorSenseId},
            ${rootSenseId},
            'is_a',
            'manual',
            1,
            null
          ),
          (
            ${id(1_062)},
            ${otherUserId},
            ${rootSenseId},
            ${foreignSenseId},
            'synonym',
            'ai',
            0.9,
            null
          )
      `;

      const focus = await repository.loadFocus(userId, rootCardId);
      expect(focus).not.toBeNull();
      expect(focus!.focus).toEqual({
        id: rootSenseId,
        lexemeId: lexemeIds[0],
        label: 'root',
        normalizedLemma: 'root',
        languageTag: 'en',
        partOfSpeech: 'noun',
        definition: 'gốc',
        mappedCardIds: [rootCardId],
        inCurrentDeck: true,
        retention: null,
        dueAt: null,
      });
      expect(await repository.loadFocus(otherUserId, rootCardId)).toBeNull();
      expect(await repository.loadFocus(userId, unmappedCardId)).toEqual({
        cardId: unmappedCardId,
        deckId,
        focus: null,
      });

      const hierarchyPage = await repository.loadPage({
        userId,
        deckId,
        focusCardId: rootCardId,
        focusSenseId: rootSenseId,
        groups: ['hierarchy'],
        relationTypes: ['is_a', 'part_of'],
        nodeLimit: 24,
        edgeLimit: 40,
        after: null,
      });
      expect(hierarchyPage.nodes.map((item) => item.id)).toEqual([
        ancestorSenseId,
      ]);
      expect(hierarchyPage.edges).toEqual([
        {
          id: id(1_061),
          source: ancestorSenseId,
          target: rootSenseId,
          type: 'is_a',
          group: 'hierarchy',
          directed: true,
          origin: 'manual',
          confidenceBand: null,
          evidence: null,
        },
      ]);

      const usagePage = await repository.loadPage({
        userId,
        deckId,
        focusCardId: rootCardId,
        focusSenseId: rootSenseId,
        groups: ['usage'],
        relationTypes: ['collocation', 'confused_with'],
        nodeLimit: 24,
        edgeLimit: 40,
        after: null,
      });
      expect(usagePage.nodes).toHaveLength(1);
      expect(usagePage.nodes[0]).toMatchObject({
        id: auntSenseId,
        mappedCardIds: [auntCardId, sameSenseOtherCardId],
        inCurrentDeck: true,
        dueAt: new Date('2030-03-04T05:06:07.000Z'),
      });
      expect(usagePage.nodes[0]!.retention).toBeGreaterThan(0);
      expect(usagePage.nodes[0]!.retention).toBeLessThanOrEqual(1);
      expect(usagePage.edges[0]).toEqual({
        id: id(1_060),
        source: rootSenseId,
        target: auntSenseId,
        type: 'collocation',
        group: 'usage',
        directed: false,
        origin: 'ai',
        confidenceBand: 'high',
        evidence: 'root phrase ↔ aunt phrase',
      });

      const summary = await repository.loadSummary({
        userId,
        deckId,
        focusSenseId: rootSenseId,
      });
      expect(summary).toEqual({
        deckCards: 4,
        connectedCards: 2,
        isolatedCards: 2,
        groupCounts: {
          hierarchy: 1,
          meaning: 0,
          form: 0,
          usage: 1,
        },
      });
    } finally {
      await client.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'paginates by stable lemma/id cursor and gives every returned node an edge',
  async () => {
    // Catches OFFSET drift and an edge cap that leaves orphan nodes.
    const { databaseName, client } = await createDisposableDatabase();
    try {
      const repository = createPostgresCardNeighborhoodRepository(client);
      const userId = id(2_001);
      const deckId = id(2_002);
      const rootCardId = id(2_003);
      const rootSenseId = id(2_004);
      const rootLexemeId = id(2_005);
      await client`INSERT INTO users (id) VALUES (${userId})`;
      await client`
        INSERT INTO decks (id, user_id) VALUES (${deckId}, ${userId})
      `;
      await client`
        INSERT INTO cards (id, deck_id) VALUES (${rootCardId}, ${deckId})
      `;
      await client`
        INSERT INTO lexemes (
          id, user_id, language_tag, lemma, normalized_lemma
        )
        VALUES (${rootLexemeId}, ${userId}, 'en', 'root', 'root')
      `;
      await client`
        INSERT INTO lexical_senses (
          id,
          lexeme_id,
          part_of_speech,
          definition_language_tag,
          definition,
          normalized_definition
        )
        VALUES (${rootSenseId}, ${rootLexemeId}, 'noun', 'vi', 'gốc', 'gốc')
      `;
      await client`
        INSERT INTO card_senses (card_id, sense_id, source, is_primary)
        VALUES (${rootCardId}, ${rootSenseId}, 'deterministic', true)
      `;

      const neighbors = [
        { senseId: id(2_010), lexemeId: id(2_020), lemma: 'alpha' },
        { senseId: id(2_011), lexemeId: id(2_021), lemma: 'beta' },
        { senseId: id(2_012), lexemeId: id(2_022), lemma: 'gamma' },
      ];
      for (const [index, neighbor] of neighbors.entries()) {
        await client`
          INSERT INTO lexemes (
            id, user_id, language_tag, lemma, normalized_lemma
          )
          VALUES (
            ${neighbor.lexemeId},
            ${userId},
            'en',
            ${neighbor.lemma},
            ${neighbor.lemma}
          )
        `;
        await client`
          INSERT INTO lexical_senses (
            id,
            lexeme_id,
            part_of_speech,
            definition_language_tag,
            definition,
            normalized_definition
          )
          VALUES (
            ${neighbor.senseId},
            ${neighbor.lexemeId},
            'noun',
            'vi',
            ${neighbor.lemma},
            ${neighbor.lemma}
          )
        `;
        await client`
          INSERT INTO sense_relations (
            id,
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${id(2_100 + index)},
            ${userId},
            ${rootSenseId},
            ${neighbor.senseId},
            'synonym',
            'manual',
            1
          )
        `;
      }

      const first = await repository.loadPage({
        userId,
        deckId,
        focusCardId: rootCardId,
        focusSenseId: rootSenseId,
        groups: ['meaning'],
        relationTypes: ['synonym'],
        nodeLimit: 2,
        edgeLimit: 2,
        after: null,
      });
      expect(first.nodes.map((item) => item.label)).toEqual(['alpha', 'beta']);
      expect(first.edges).toHaveLength(2);
      expect(
        new Set(first.edges.flatMap((edge) => [edge.source, edge.target])),
      ).toEqual(new Set([rootSenseId, neighbors[0]!.senseId, neighbors[1]!.senseId]));
      expect(first.hasMore).toBe(true);

      const second = await repository.loadPage({
        userId,
        deckId,
        focusCardId: rootCardId,
        focusSenseId: rootSenseId,
        groups: ['meaning'],
        relationTypes: ['synonym'],
        nodeLimit: 2,
        edgeLimit: 2,
        after: {
          normalizedLemma: 'beta',
          senseId: neighbors[1]!.senseId,
        },
      });
      expect(second.nodes.map((item) => item.label)).toEqual(['gamma']);
      expect(second.edges).toHaveLength(1);
      expect(second.hasMore).toBe(false);
    } finally {
      await client.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'maps an owned card to an owned sense idempotently and preserves one primary',
  async () => {
    // Catches cross-user attachment, duplicate rows, and two primary senses.
    const { databaseName, client } = await createDisposableDatabase();
    try {
      const repository = createPostgresCardNeighborhoodRepository(client);
      const userId = id(3_001);
      const otherUserId = id(3_002);
      const deckId = id(3_003);
      const otherDeckId = id(3_004);
      const cardId = id(3_005);
      const otherCardId = id(3_006);
      const senseId = id(3_007);
      const secondSenseId = id(3_008);
      const foreignSenseId = id(3_009);
      await client`
        INSERT INTO users (id) VALUES (${userId}), (${otherUserId})
      `;
      await client`
        INSERT INTO decks (id, user_id)
        VALUES (${deckId}, ${userId}), (${otherDeckId}, ${otherUserId})
      `;
      await client`
        INSERT INTO cards (id, deck_id)
        VALUES (${cardId}, ${deckId}), (${otherCardId}, ${otherDeckId})
      `;
      await client`
        INSERT INTO lexemes (
          id, user_id, language_tag, lemma, normalized_lemma
        )
        VALUES
          (${id(3_020)}, ${userId}, 'en', 'one', 'one'),
          (${id(3_021)}, ${userId}, 'en', 'two', 'two'),
          (${id(3_022)}, ${otherUserId}, 'en', 'foreign', 'foreign')
      `;
      await client`
        INSERT INTO lexical_senses (
          id,
          lexeme_id,
          part_of_speech,
          definition_language_tag,
          definition,
          normalized_definition
        )
        VALUES
          (${senseId}, ${id(3_020)}, 'noun', 'vi', 'một', 'một'),
          (${secondSenseId}, ${id(3_021)}, 'noun', 'vi', 'hai', 'hai'),
          (${foreignSenseId}, ${id(3_022)}, 'noun', 'vi', 'ngoại', 'ngoại')
      `;

      expect(
        await repository.mapCardSense(userId, otherCardId, senseId),
      ).toEqual({ outcome: 'card_not_found' });
      expect(
        await repository.mapCardSense(userId, cardId, foreignSenseId),
      ).toEqual({ outcome: 'sense_not_found' });

      const [first, concurrentRepeat] = await Promise.all([
        repository.mapCardSense(userId, cardId, senseId),
        repository.mapCardSense(userId, cardId, senseId),
      ]);
      expect([first, concurrentRepeat]).toContainEqual({
        outcome: 'mapped',
        mapping: {
          cardId,
          senseId,
          source: 'manual',
          isPrimary: true,
          created: true,
        },
      });
      expect([first, concurrentRepeat]).toContainEqual({
        outcome: 'mapped',
        mapping: {
          cardId,
          senseId,
          source: 'manual',
          isPrimary: true,
          created: false,
        },
      });

      expect(
        await repository.mapCardSense(userId, cardId, secondSenseId),
      ).toEqual({
        outcome: 'mapped',
        mapping: {
          cardId,
          senseId: secondSenseId,
          source: 'manual',
          isPrimary: false,
          created: true,
        },
      });
      const [counts] = await client<{
        total: number;
        primaryCount: number;
      }[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_primary)::int AS "primaryCount"
        FROM card_senses
        WHERE card_id = ${cardId}
      `;
      expect(counts).toEqual({ total: 2, primaryCount: 1 });
    } finally {
      await client.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);
