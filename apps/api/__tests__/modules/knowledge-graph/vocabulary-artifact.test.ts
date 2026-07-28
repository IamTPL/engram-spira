import { describe, expect, test } from 'bun:test';
import {
  buildVocabularyArtifact,
  type VocabularyArtifactInput,
} from '../../../src/modules/knowledge-graph/vocabulary-artifact';
import {
  canonicalizeLanguageTag,
  normalizeVocabularyText,
} from '../../../src/modules/knowledge-graph/vocabulary-normalization';
import { ValidationError } from '../../../src/shared/errors';

const vocabularyFields = [
  { id: 'word-field', name: 'Word' },
  { id: 'definition-field', name: 'Definition' },
  { id: 'pos-field', name: 'Part of Speech' },
  { id: 'ipa-field', name: 'IPA' },
  { id: 'examples-field', name: 'Examples' },
];

function artifactInput(
  overrides: Partial<VocabularyArtifactInput> = {},
): VocabularyArtifactInput {
  return {
    cardId: 'card-1',
    sourceLanguageTag: 'en-us',
    definitionLanguageTag: 'en',
    templateFields: vocabularyFields,
    fieldValues: [
      { templateFieldId: 'word-field', value: 'Café' },
      { templateFieldId: 'definition-field', value: 'A coffeehouse.' },
      { templateFieldId: 'pos-field', value: 'n.' },
      { templateFieldId: 'ipa-field', value: ' kaˈfe ' },
      { templateFieldId: 'examples-field', value: ['At the café.', 'Meet at noon.'] },
    ],
    ...overrides,
  };
}

describe('vocabulary normalization', () => {
  test('normalizes canonically equivalent Unicode and collapses whitespace without removing diacritics', () => {
    expect(normalizeVocabularyText('  Cafe\u0301\t\nau\t lait  ', 'en')).toBe(
      'café au lait',
    );
  });

  test('uses the source locale when lowercasing vocabulary text', () => {
    expect(normalizeVocabularyText('İSTANBUL', 'tr')).toBe('istanbul');
    expect(normalizeVocabularyText('İSTANBUL', 'en')).toBe('i̇stanbul');
  });

  test('canonicalizes valid BCP-47 tags and rejects invalid tags', () => {
    expect(canonicalizeLanguageTag('EN-us')).toBe('en-US');
    expect(() => canonicalizeLanguageTag('not a language tag')).toThrow(
      'Invalid language tag',
    );
  });
});

describe('buildVocabularyArtifact', () => {
  test('builds the canonical v1 artifact from named fields and JSONB-like values', () => {
    expect(buildVocabularyArtifact(artifactInput())).toEqual({
      cardId: 'card-1',
      sourceLanguageTag: 'en-US',
      definitionLanguageTag: 'en',
      lemma: 'Café',
      normalizedLemma: 'café',
      partOfSpeech: 'noun',
      definition: 'A coffeehouse.',
      normalizedDefinition: 'a coffeehouse.',
      ipa: 'kaˈfe',
      examples: ['At the café.', 'Meet at noon.'],
      contentHash: 'e954b86ccd714a9a9d5e98e654419c282e4b708982a7fd3f1a7358f7d76f7aeb',
      representationVersion: 'v1',
    });
  });

  test('keeps the content hash stable when template fields and values arrive in different orders', () => {
    const first = buildVocabularyArtifact(artifactInput());
    const second = buildVocabularyArtifact(
      artifactInput({
        templateFields: [...vocabularyFields].reverse(),
        fieldValues: [...artifactInput().fieldValues].reverse(),
      }),
    );

    expect(second.contentHash).toBe(first.contentHash);
  });

  test('hashes sorted canonical JSON instead of artifact property insertion order', () => {
    expect(buildVocabularyArtifact(artifactInput()).contentHash).toBe(
      'e954b86ccd714a9a9d5e98e654419c282e4b708982a7fd3f1a7358f7d76f7aeb',
    );
  });

  test('maps known part-of-speech aliases and falls back to unknown', () => {
    const adjective = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'bright' },
          { templateFieldId: 'definition-field', value: 'Giving out light.' },
          { templateFieldId: 'pos-field', value: 'adj.' },
        ],
      }),
    );
    const unknown = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'bright' },
          { templateFieldId: 'definition-field', value: 'Giving out light.' },
          { templateFieldId: 'pos-field', value: 'interjectionish' },
        ],
      }),
    );

    expect(adjective.partOfSpeech).toBe('adjective');
    expect(unknown.partOfSpeech).toBe('unknown');
  });

  test('recognizes the canonical system template type field as part of speech', () => {
    const result = buildVocabularyArtifact({
      cardId: 'card-system-template',
      sourceLanguageTag: 'en',
      definitionLanguageTag: 'vi',
      templateFields: [
        { id: 'word', name: 'word' },
        { id: 'definition', name: 'definition' },
        { id: 'type', name: 'type' },
      ],
      fieldValues: [
        { templateFieldId: 'word', value: 'bank' },
        { templateFieldId: 'definition', value: 'ngân hàng' },
        { templateFieldId: 'type', value: 'noun' },
      ],
    });

    expect(result.partOfSpeech).toBe('noun');
  });

  test('canonicalizes every project-defined word type and round-trips canonical POS', () => {
    const cases = [
      ['det', 'determiner'],
      ['intj', 'interjection'],
      ['phrasal verb', 'phrasal_verb'],
      ['idiom', 'idiom'],
      ['phrase', 'phrase'],
    ] as const;

    for (const [storedValue, canonical] of cases) {
      const artifact = buildVocabularyArtifact(
        artifactInput({
          fieldValues: [
            { templateFieldId: 'word-field', value: 'take off' },
            {
              templateFieldId: 'definition-field',
              value: 'leave the ground',
            },
            { templateFieldId: 'pos-field', value: storedValue },
          ],
        }),
      );
      const rebuilt = buildVocabularyArtifact(
        artifactInput({
          fieldValues: [
            { templateFieldId: 'word-field', value: artifact.lemma },
            {
              templateFieldId: 'definition-field',
              value: artifact.definition,
            },
            {
              templateFieldId: 'pos-field',
              value: artifact.partOfSpeech,
            },
          ],
        }),
      );

      expect(artifact.partOfSpeech).toBe(canonical);
      expect(rebuilt.partOfSpeech).toBe(canonical);
      expect(rebuilt.contentHash).toBe(artifact.contentHash);
    }
  });

  test('parses examples deterministically from arrays, serialized arrays, and multiline text', () => {
    const arrays = buildVocabularyArtifact(artifactInput());
    const serialized = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'café' },
          { templateFieldId: 'definition-field', value: 'A coffeehouse.' },
          { templateFieldId: 'examples-field', value: '[" One ", "Two"]' },
        ],
      }),
    );
    const multiline = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'café' },
          { templateFieldId: 'definition-field', value: 'A coffeehouse.' },
          { templateFieldId: 'examples-field', value: ' First\n\n Second ' },
        ],
      }),
    );

    expect(arrays.examples).toEqual(['At the café.', 'Meet at noon.']);
    expect(serialized.examples).toEqual(['One', 'Two']);
    expect(multiline.examples).toEqual(['First', 'Second']);
  });

  test('distinguishes homographs and polysemy through the canonical content hash', () => {
    const financialBank = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'bank' },
          { templateFieldId: 'definition-field', value: 'A financial institution.' },
          { templateFieldId: 'pos-field', value: 'noun' },
        ],
      }),
    );
    const riverBank = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'bank' },
          { templateFieldId: 'definition-field', value: 'The land beside a river.' },
          { templateFieldId: 'pos-field', value: 'noun' },
        ],
      }),
    );

    expect(financialBank.normalizedLemma).toBe('bank');
    expect(riverBank.normalizedLemma).toBe('bank');
    expect(riverBank.contentHash).not.toBe(financialBank.contentHash);
  });

  test('rejects duplicate recognized template fields', () => {
    expect(() =>
      buildVocabularyArtifact(
        artifactInput({
          templateFields: [
            ...vocabularyFields,
            { id: 'other-word-field', name: 'WORD' },
          ],
        }),
      ),
    ).toThrow('Vocabulary template must define exactly one word field');
  });

  test('rejects duplicate rows for a recognized field value', () => {
    expect(() =>
      buildVocabularyArtifact(
        artifactInput({
          fieldValues: [
            { templateFieldId: 'word-field', value: 'Café' },
            { templateFieldId: 'word-field', value: 'Coffee' },
            { templateFieldId: 'definition-field', value: 'A coffeehouse.' },
          ],
        }),
      ),
    ).toThrow('Vocabulary artifact has duplicate field values');
  });

  test('changes the hash when a recognized part of speech changes', () => {
    const noun = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'record' },
          { templateFieldId: 'definition-field', value: 'An account of information.' },
          { templateFieldId: 'pos-field', value: 'noun' },
        ],
      }),
    );
    const verb = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'record' },
          { templateFieldId: 'definition-field', value: 'An account of information.' },
          { templateFieldId: 'pos-field', value: 'v.' },
        ],
      }),
    );

    expect(noun.partOfSpeech).toBe('noun');
    expect(verb.partOfSpeech).toBe('verb');
    expect(verb.contentHash).not.toBe(noun.contentHash);
  });

  test('changes the hash when IPA changes for the same lemma and definition', () => {
    const firstPronunciation = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'read' },
          { templateFieldId: 'definition-field', value: 'To interpret written words.' },
          { templateFieldId: 'ipa-field', value: 'riːd' },
        ],
      }),
    );
    const secondPronunciation = buildVocabularyArtifact(
      artifactInput({
        fieldValues: [
          { templateFieldId: 'word-field', value: 'read' },
          { templateFieldId: 'definition-field', value: 'To interpret written words.' },
          { templateFieldId: 'ipa-field', value: 'rɛd' },
        ],
      }),
    );

    expect(secondPronunciation.contentHash).not.toBe(firstPronunciation.contentHash);
  });

  test('rejects templates without the required named fields', () => {
    const unsupportedTemplate = () =>
      buildVocabularyArtifact(
        artifactInput({
          templateFields: [{ id: 'front-field', name: 'Front' }],
        }),
      );

    expect(unsupportedTemplate).toThrow(ValidationError);
    expect(() =>
      unsupportedTemplate(),
    ).toThrow('Vocabulary template must include a word field');
    expect(() =>
      buildVocabularyArtifact(
        artifactInput({
          templateFields: [{ id: 'word-field', name: 'word' }],
        }),
      ),
    ).toThrow('Vocabulary template must include a definition field');
  });

  test('rejects missing or empty required field values', () => {
    expect(() =>
      buildVocabularyArtifact(
        artifactInput({
          fieldValues: [{ templateFieldId: 'definition-field', value: 'Meaning' }],
        }),
      ),
    ).toThrow('Vocabulary artifact requires a non-empty word value');
    expect(() =>
      buildVocabularyArtifact(
        artifactInput({
          fieldValues: [
            { templateFieldId: 'word-field', value: 'term' },
            { templateFieldId: 'definition-field', value: '  ' },
          ],
        }),
      ),
    ).toThrow('Vocabulary artifact requires a non-empty definition value');
  });

  test('rejects normalized identities that cannot fit PostgreSQL unique indexes', () => {
    expect(() =>
      buildVocabularyArtifact(
        artifactInput({
          fieldValues: [
            { templateFieldId: 'word-field', value: 'é'.repeat(513) },
            { templateFieldId: 'definition-field', value: 'valid' },
          ],
        }),
      ),
    ).toThrow('word exceeds 1024 UTF-8 bytes');
    expect(() =>
      buildVocabularyArtifact(
        artifactInput({
          fieldValues: [
            { templateFieldId: 'word-field', value: 'valid' },
            {
              templateFieldId: 'definition-field',
              value: 'đ'.repeat(1025),
            },
          ],
        }),
      ),
    ).toThrow('definition exceeds 2048 UTF-8 bytes');
  });
});
