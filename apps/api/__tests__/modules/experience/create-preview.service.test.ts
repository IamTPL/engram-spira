import { describe, expect, test } from 'bun:test';

import {
  commitCreatePreview,
  createInMemoryPreviewStore,
  createPreview,
} from '../../../src/modules/experience/create-preview.service';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '../../../src/shared/errors';

const frontField = {
  id: 'field-front',
  name: 'Front',
  sortOrder: 0,
  isRequired: true,
};
const backField = {
  id: 'field-back',
  name: 'Back',
  sortOrder: 1,
  isRequired: true,
};
const noteField = {
  id: 'field-note',
  name: 'Note',
  sortOrder: 2,
  isRequired: false,
};

function services(overrides: Record<string, unknown> = {}) {
  const created: Array<{ deckId: string; fields: Record<string, string> }> = [];
  const merged: Array<{ cardId: string; fields: Record<string, string> }> = [];
  const existingCards = [
    {
      id: 'existing-card',
      deckId: 'deck-1',
      title: 'Photosynthesis',
      fields: { Front: 'Photosynthesis', Back: '', Note: '' },
    },
    {
      id: 'conflict-card',
      deckId: 'deck-1',
      title: 'Mitosis',
      fields: { Front: 'Mitosis', Back: 'Existing answer', Note: '' },
    },
    {
      id: 'different-deck-card',
      deckId: 'deck-2',
      title: 'Photosynthesis',
      fields: { Front: 'Photosynthesis', Back: '' },
    },
  ];

  return {
    created,
    merged,
    store: createInMemoryPreviewStore(),
    now: () => new Date('2026-06-28T10:00:00.000Z'),
    previewTtlMs: 15 * 60 * 1000,
    loadDeck: async (_userId: string, deckId: string) => {
      if (deckId === 'missing' || deckId === 'other-deck') {
        throw new NotFoundError('Deck');
      }
      return {
        id: deckId,
        userId: 'user-1',
        folderId: 'folder-1',
        cardTemplateId: 'template-1',
        name: 'Biology',
      };
    },
    loadTemplate: async (templateId: string) => ({
      id: templateId,
      fields: [frontField, backField, noteField],
    }),
    listCardsInDeck: async (_userId: string, deckId: string) =>
      existingCards.filter((card) => card.deckId === deckId),
    createCard: async (
      _userId: string,
      deckId: string,
      fields: Record<string, string>,
    ) => {
      const id = `created-${created.length + 1}`;
      created.push({ deckId, fields });
      return { id };
    },
    loadMergeCard: async (_userId: string, cardId: string) => {
      const card = existingCards.find((candidate) => candidate.id === cardId);
      if (!card) throw new NotFoundError('Card');
      return card;
    },
    fillMissingCardFields: async (
      _userId: string,
      cardId: string,
      fields: Record<string, string>,
    ) => {
      merged.push({ cardId, fields });
      return { id: cardId };
    },
    ...overrides,
  } as any;
}

async function validPreview(svc = services()) {
  const preview = await createPreview(
    'user-1',
    {
      source: 'manual',
      targetDeckId: 'deck-1',
      templateId: 'template-1',
      payload: {
        fields: {
          Front: ' Photosynthesis ',
          Back: 'Plants make sugar',
          Note: '',
        },
      },
    },
    svc,
  );
  return { preview, svc };
}

describe('create preview service', () => {
  test('manual payload validation', async () => {
    await expect(
      createPreview(
        'user-1',
        {
          source: 'manual',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: { fields: {} },
        },
        services(),
      ),
    ).rejects.toThrow(new ValidationError('Required fields missing: Front, Back'));
  });

  test('AI paste size/requested count limits', async () => {
    await expect(
      createPreview(
        'user-1',
        {
          source: 'ai-paste',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: {
            text: 'x'.repeat(10_001),
            mode: 'qa',
            requestedCount: 5,
          },
        },
        services(),
      ),
    ).rejects.toThrow(PayloadTooLargeError);

    await expect(
      createPreview(
        'user-1',
        {
          source: 'ai-paste',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: { text: 'valid source text', mode: 'qa', requestedCount: 31 },
        },
        services(),
      ),
    ).rejects.toThrow(new ValidationError('requestedCount must be between 1 and 30'));
  });

  test('malformed preview payloads return validation errors instead of TypeError', async () => {
    await expect(
      createPreview(
        'user-1',
        {
          source: 'ai-paste',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: {},
        } as any,
        services(),
      ),
    ).rejects.toThrow(new ValidationError('text is required'));

    await expect(
      createPreview(
        'user-1',
        {
          source: 'csv',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: { filename: 'cards.csv', content: 'A,B', hasHeader: true },
        } as any,
        services(),
      ),
    ).rejects.toThrow(new ValidationError('fieldMapping is required'));

    await expect(
      createPreview(
        'user-1',
        {
          source: 'not-real',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: {},
        } as any,
        services(),
      ),
    ).rejects.toThrow(new ValidationError('Invalid create source'));
  });

  test('CSV/JSON size and row limits', async () => {
    await expect(
      createPreview(
        'user-1',
        {
          source: 'csv',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: {
            filename: 'cards.csv',
            content: 'x'.repeat(1_000_001),
            hasHeader: true,
            fieldMapping: { Front: 'Front', Back: 'Back' },
          },
        },
        services(),
      ),
    ).rejects.toThrow(PayloadTooLargeError);

    await expect(
      createPreview(
        'user-1',
        {
          source: 'json',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: {
            filename: 'cards.json',
            content: JSON.stringify(
              Array.from({ length: 501 }, () => ({
                Front: 'A',
                Back: 'B',
              })),
            ),
          },
        },
        services(),
      ),
    ).rejects.toThrow(new PayloadTooLargeError('JSON row limit exceeded'));
  });

  test('preview record stores normalized card fields and duplicate candidates', async () => {
    const { preview, svc } = await validPreview();
    const stored = svc.store.get(preview.previewId);

    expect(preview.cards[0]).toMatchObject({
      fields: { Front: 'Photosynthesis', Back: 'Plants make sugar', Note: '' },
      resolution: 'merge',
    });
    expect(preview.cards[0].duplicateCandidates[0]).toMatchObject({
      cardId: 'existing-card',
      title: 'Photosynthesis',
    });
    expect(stored?.cards[0].fields.Front).toBe('Photosynthesis');
  });

  test('merge fill-only semantics', async () => {
    const { preview, svc } = await validPreview();

    const result = await commitCreatePreview(
      'user-1',
      {
        previewId: preview.previewId,
        idempotencyKey: 'merge-key',
        cards: [
          {
            clientId: preview.cards[0].clientId,
            resolution: 'merge',
            mergeTargetCardId: 'existing-card',
          },
        ],
      },
      svc,
    );

    expect(result).toEqual({
      createdCardIds: [],
      skippedClientIds: [],
      mergedCardIds: ['existing-card'],
    });
    expect(svc.merged).toEqual([
      { cardId: 'existing-card', fields: { Back: 'Plants make sugar' } },
    ]);
  });

  test('required idempotencyKey validation', async () => {
    const { preview, svc } = await validPreview();

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: '',
          cards: [{ clientId: preview.cards[0].clientId, resolution: 'skip' }],
        },
        svc,
      ),
    ).rejects.toThrow(new ValidationError('idempotencyKey is required'));
  });

  test('idempotent commit replay returns original success before and after preview expiry when first commit succeeded', async () => {
    let now = new Date('2026-06-28T10:00:00.000Z');
    const svc = services({ now: () => now });
    const { preview } = await validPreview(svc);
    const request = {
      previewId: preview.previewId,
      idempotencyKey: 'same-key',
      cards: [
        { clientId: preview.cards[0].clientId, resolution: 'create' as const },
      ],
    };

    const first = await commitCreatePreview('user-1', request, svc);
    const replay = await commitCreatePreview('user-1', request, svc);
    now = new Date('2026-06-28T11:00:00.000Z');
    const expiredReplay = await commitCreatePreview('user-1', request, svc);

    expect(first).toEqual(replay);
    expect(first).toEqual(expiredReplay);
    expect(svc.created).toHaveLength(1);
  });

  test('same key different payload returns conflict error', async () => {
    const { preview, svc } = await validPreview();

    await commitCreatePreview(
      'user-1',
      {
        previewId: preview.previewId,
        idempotencyKey: 'same-key',
        cards: [{ clientId: preview.cards[0].clientId, resolution: 'skip' }],
      },
      svc,
    );

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'same-key',
          cards: [{ clientId: preview.cards[0].clientId, resolution: 'create' }],
        },
        svc,
      ),
    ).rejects.toThrow(new ConflictError('Idempotency key conflict'));
  });

  test('same preview with different key after success returns conflict error', async () => {
    const { preview, svc } = await validPreview();

    await commitCreatePreview(
      'user-1',
      {
        previewId: preview.previewId,
        idempotencyKey: 'first-key',
        cards: [{ clientId: preview.cards[0].clientId, resolution: 'skip' }],
      },
      svc,
    );

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'second-key',
          cards: [{ clientId: preview.cards[0].clientId, resolution: 'skip' }],
        },
        svc,
      ),
    ).rejects.toThrow(new ConflictError('Preview already committed'));
  });

  test('commit preflights all cards before creating any cards', async () => {
    const svc = services();
    const preview = await createPreview(
      'user-1',
      {
        source: 'json',
        targetDeckId: 'deck-1',
        templateId: 'template-1',
        payload: {
          filename: 'cards.json',
          content: JSON.stringify([
            { Front: 'Valid one', Back: 'Back one' },
            { Front: 'Missing back' },
          ]),
        },
      },
      svc,
    );

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'preflight-before-create',
          cards: [
            { clientId: preview.cards[0].clientId, resolution: 'create' },
            { clientId: preview.cards[1].clientId, resolution: 'create' },
          ],
        },
        svc,
      ),
    ).rejects.toThrow(new ValidationError('Required fields missing: Back'));

    expect(svc.created).toEqual([]);
  });

  test('target deck ownership failure returns Deck not found', async () => {
    await expect(
      createPreview(
        'user-1',
        {
          source: 'manual',
          targetDeckId: 'other-deck',
          templateId: 'template-1',
          payload: { fields: { Front: 'A', Back: 'B' } },
        },
        services(),
      ),
    ).rejects.toThrow(new NotFoundError('Deck'));
  });

  test('invalid template for target deck returns Template not valid for target deck', async () => {
    await expect(
      createPreview(
        'user-1',
        {
          source: 'manual',
          targetDeckId: 'deck-1',
          templateId: 'template-2',
          payload: { fields: { Front: 'A', Back: 'B' } },
        },
        services(),
      ),
    ).rejects.toThrow(
      new ValidationError('Template not valid for target deck'),
    );
  });

  test('commit rejects missing required fields not normalized into stored preview', async () => {
    const svc = services();
    const preview = await createPreview(
      'user-1',
      {
        source: 'json',
        targetDeckId: 'deck-1',
        templateId: 'template-1',
        payload: {
          filename: 'cards.json',
          content: JSON.stringify([{ Front: 'Only front' }]),
        },
      },
      svc,
    );

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'missing-fields',
          cards: [{ clientId: preview.cards[0].clientId, resolution: 'create' }],
        },
        svc,
      ),
    ).rejects.toThrow(new ValidationError('Required fields missing: Back'));
  });

  test('expired preview returns Preview expired', async () => {
    const svc = services({ now: () => new Date('2026-06-28T11:00:00.000Z') });
    const store = createInMemoryPreviewStore();
    const preview = await createPreview(
      'user-1',
      {
        source: 'manual',
        targetDeckId: 'deck-1',
        templateId: 'template-1',
        payload: { fields: { Front: 'A', Back: 'B' } },
      },
      { ...svc, store, now: () => new Date('2026-06-28T10:00:00.000Z') },
    );

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'expired',
          cards: [{ clientId: preview.cards[0].clientId, resolution: 'skip' }],
        },
        { ...svc, store },
      ),
    ).rejects.toThrow(new ConflictError('Preview expired'));
  });

  test('expired preview without matching successful idempotency replay returns Preview expired', async () => {
    const svc = services({ now: () => new Date('2026-06-28T11:00:00.000Z') });
    const store = createInMemoryPreviewStore();
    const preview = await createPreview(
      'user-1',
      {
        source: 'manual',
        targetDeckId: 'deck-1',
        templateId: 'template-1',
        payload: { fields: { Front: 'A', Back: 'B' } },
      },
      { ...svc, store, now: () => new Date('2026-06-28T10:00:00.000Z') },
    );

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'new-key-after-expiry',
          cards: [{ clientId: preview.cards[0].clientId, resolution: 'skip' }],
        },
        { ...svc, store },
      ),
    ).rejects.toThrow(new ConflictError('Preview expired'));
  });

  test('unknown clientId returns Unknown preview record', async () => {
    const { preview, svc } = await validPreview();

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'unknown-client',
          cards: [{ clientId: 'missing-client', resolution: 'skip' }],
        },
        svc,
      ),
    ).rejects.toThrow(new ConflictError('Unknown preview record'));
  });

  test('merge resolution without mergeTargetCardId returns Merge target is required', async () => {
    const { preview, svc } = await validPreview();

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'missing-merge-target',
          cards: [{ clientId: preview.cards[0].clientId, resolution: 'merge' } as any],
        },
        svc,
      ),
    ).rejects.toThrow(new ValidationError('Merge target is required'));
  });

  test('invalid/unauthorized merge target returns Merge target not found', async () => {
    const { preview, svc } = await validPreview();

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'bad-merge-target',
          cards: [
            {
              clientId: preview.cards[0].clientId,
              resolution: 'merge',
              mergeTargetCardId: 'missing-card',
            },
          ],
        },
        svc,
      ),
    ).rejects.toThrow(new ConflictError('Merge target not found'));
  });

  test('same-user merge target in different deck returns Merge target not found', async () => {
    const { preview, svc } = await validPreview();

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'wrong-deck-target',
          cards: [
            {
              clientId: preview.cards[0].clientId,
              resolution: 'merge',
              mergeTargetCardId: 'different-deck-card',
            },
          ],
        },
        svc,
      ),
    ).rejects.toThrow(new ConflictError('Merge target not found'));
  });

  test('merge conflict reports conflicting field names', async () => {
    const { preview, svc } = await validPreview();

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'merge-conflict',
          cards: [
            {
              clientId: preview.cards[0].clientId,
              resolution: 'merge',
              mergeTargetCardId: 'conflict-card',
            },
          ],
        },
        svc,
      ),
    ).rejects.toThrow(new ConflictError('Merge conflict: Front, Back'));
  });

  test('trimmed equal-value merge is no-op, not conflict', async () => {
    const svc = services();
    const preview = await createPreview(
      'user-1',
      {
        source: 'manual',
        targetDeckId: 'deck-1',
        templateId: 'template-1',
        payload: { fields: { Front: ' Photosynthesis ', Back: 'Answer' } },
      },
      svc,
    );

    await expect(
      commitCreatePreview(
        'user-1',
        {
          previewId: preview.previewId,
          idempotencyKey: 'equal-noop',
          cards: [
            {
              clientId: preview.cards[0].clientId,
              resolution: 'merge',
              mergeTargetCardId: 'existing-card',
            },
          ],
        },
        {
          ...svc,
          loadMergeCard: async () => ({
            id: 'existing-card',
            deckId: 'deck-1',
            title: 'Photosynthesis',
            fields: { Front: 'Photosynthesis', Back: '' },
          }),
        },
      ),
    ).resolves.toEqual({
      createdCardIds: [],
      skippedClientIds: [],
      mergedCardIds: ['existing-card'],
    });
  });

  test('omitted commit fields use stored preview fields instead of trusting client resubmission', async () => {
    const { preview, svc } = await validPreview();

    await commitCreatePreview(
      'user-1',
      {
        previewId: preview.previewId,
        idempotencyKey: 'stored-fields',
        cards: [{ clientId: preview.cards[0].clientId, resolution: 'create' }],
      },
      svc,
    );

    expect(svc.created[0].fields).toEqual({
      Front: 'Photosynthesis',
      Back: 'Plants make sugar',
      Note: '',
    });
  });
});
