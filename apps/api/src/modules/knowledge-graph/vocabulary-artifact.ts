import { createHash } from 'node:crypto';

import { ValidationError } from '../../shared/errors';
import {
  canonicalizeLanguageTag,
  normalizeVocabularyDisplayText,
  normalizeVocabularyText,
} from './vocabulary-normalization';

export interface VocabularyArtifact {
  cardId: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
  lemma: string;
  normalizedLemma: string;
  partOfSpeech: string;
  definition: string;
  normalizedDefinition: string;
  ipa: string | null;
  examples: string[];
  contentHash: string;
  representationVersion: 'v1';
}

export type VocabularyTemplateField = {
  id: string;
  name: string;
};

export type VocabularyFieldValue = {
  templateFieldId: string;
  value: unknown;
};

export type VocabularyArtifactInput = {
  cardId: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
  templateFields: VocabularyTemplateField[];
  fieldValues: VocabularyFieldValue[];
};

type ArtifactContent = Omit<VocabularyArtifact, 'contentHash'>;
type ResolvedVocabularyTemplate = {
  wordField: VocabularyTemplateField;
  definitionField: VocabularyTemplateField;
  partOfSpeechField: VocabularyTemplateField | null;
  ipaField: VocabularyTemplateField | null;
  examplesField: VocabularyTemplateField | null;
};

const MAX_NORMALIZED_LEMMA_BYTES = 1_024;
const MAX_NORMALIZED_DEFINITION_BYTES = 2_048;

const OPTIONAL_FIELD_NAMES = {
  partOfSpeech: new Set([
    'pos',
    'type',
    'part of speech',
    'part-of-speech',
    'part_of_speech',
  ]),
  ipa: new Set(['ipa']),
  examples: new Set(['example', 'examples']),
};

const PART_OF_SPEECH_ALIASES: Record<string, string> = {
  noun: 'noun',
  'n.': 'noun',
  n: 'noun',
  verb: 'verb',
  'v.': 'verb',
  v: 'verb',
  adjective: 'adjective',
  'adj.': 'adjective',
  adj: 'adjective',
  adverb: 'adverb',
  'adv.': 'adverb',
  adv: 'adverb',
  pronoun: 'pronoun',
  'pron.': 'pronoun',
  pron: 'pronoun',
  preposition: 'preposition',
  'prep.': 'preposition',
  prep: 'preposition',
  conjunction: 'conjunction',
  'conj.': 'conjunction',
  conj: 'conjunction',
  interjection: 'interjection',
  'int.': 'interjection',
  int: 'interjection',
  intj: 'interjection',
  determiner: 'determiner',
  det: 'determiner',
  article: 'article',
  numeral: 'numeral',
  'phrasal verb': 'phrasal_verb',
  phrasal_verb: 'phrasal_verb',
  idiom: 'idiom',
  phrase: 'phrase',
};

function normalizedFieldName(name: string): string {
  return normalizeVocabularyDisplayText(name).toLocaleLowerCase('en');
}

function findSingleField(
  templateFields: VocabularyTemplateField[],
  acceptedNames: ReadonlySet<string>,
  fieldLabel: string,
  required: boolean,
): VocabularyTemplateField | null {
  const matches = templateFields.filter((field) =>
    acceptedNames.has(normalizedFieldName(field.name)),
  );

  if (matches.length === 0) {
    if (required) {
      throw new ValidationError(`Vocabulary template must include a ${fieldLabel} field`);
    }
    return null;
  }
  if (matches.length > 1) {
    throw new ValidationError(`Vocabulary template must define exactly one ${fieldLabel} field`);
  }
  return matches[0];
}

function resolveVocabularyTemplate(
  templateFields: VocabularyTemplateField[],
): ResolvedVocabularyTemplate {
  const wordField = findSingleField(
    templateFields,
    new Set(['word']),
    'word',
    true,
  );
  const definitionField = findSingleField(
    templateFields,
    new Set(['definition']),
    'definition',
    true,
  );
  if (!wordField || !definitionField) {
    throw new ValidationError('Vocabulary template is missing required fields');
  }

  return {
    wordField,
    definitionField,
    partOfSpeechField: findSingleField(
      templateFields,
      OPTIONAL_FIELD_NAMES.partOfSpeech,
      'part-of-speech',
      false,
    ),
    ipaField: findSingleField(
      templateFields,
      OPTIONAL_FIELD_NAMES.ipa,
      'IPA',
      false,
    ),
    examplesField: findSingleField(
      templateFields,
      OPTIONAL_FIELD_NAMES.examples,
      'examples',
      false,
    ),
  };
}

export function assertVocabularyTemplate(
  templateFields: VocabularyTemplateField[],
): void {
  resolveVocabularyTemplate(templateFields);
}

function fieldValueById(
  fieldValues: VocabularyFieldValue[],
  fieldId: string,
): unknown {
  const matches = fieldValues.filter((fieldValue) => fieldValue.templateFieldId === fieldId);
  if (matches.length > 1) {
    throw new ValidationError('Vocabulary artifact has duplicate field values');
  }
  return matches[0]?.value;
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = normalizeVocabularyDisplayText(value);
  return text || null;
}

function requiredTextValue(value: unknown, fieldLabel: string): string {
  const text = textValue(value);
  if (!text) {
    throw new ValidationError(`Vocabulary artifact requires a non-empty ${fieldLabel} value`);
  }
  return text;
}

function normalizePartOfSpeech(value: unknown): string {
  const text = textValue(value);
  if (!text) return 'unknown';
  return PART_OF_SPEECH_ALIASES[text.toLocaleLowerCase('en')] ?? 'unknown';
}

function normalizeExampleList(values: unknown[]): string[] {
  return values
    .map(textValue)
    .filter((value): value is string => value !== null);
}

function parseExamples(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeExampleList(value);
  if (typeof value !== 'string') return [];

  const displayValue = normalizeVocabularyDisplayText(value);
  if (!displayValue) return [];

  if (displayValue.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(displayValue);
      if (Array.isArray(parsed)) return normalizeExampleList(parsed);
    } catch {
      // Stored text can begin with '[' without representing a JSON array.
    }
  }

  return value
    .normalize('NFKC')
    .split(/\r?\n/u)
    .map(normalizeVocabularyDisplayText)
    .filter(Boolean);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const entries = Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(content: ArtifactContent): string {
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

function assertIndexedTextSize(
  value: string,
  label: 'word' | 'definition',
  maxBytes: number,
): void {
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new ValidationError(
      `Vocabulary artifact ${label} exceeds ${maxBytes} UTF-8 bytes`,
    );
  }
}

export function buildVocabularyArtifact(
  input: VocabularyArtifactInput,
): VocabularyArtifact {
  let sourceLanguageTag: string;
  let definitionLanguageTag: string;
  try {
    sourceLanguageTag = canonicalizeLanguageTag(input.sourceLanguageTag);
  } catch {
    throw new ValidationError('Invalid source language tag');
  }
  try {
    definitionLanguageTag = canonicalizeLanguageTag(input.definitionLanguageTag);
  } catch {
    throw new ValidationError('Invalid definition language tag');
  }

  const {
    wordField,
    definitionField,
    partOfSpeechField,
    ipaField,
    examplesField,
  } = resolveVocabularyTemplate(input.templateFields);

  const lemma = requiredTextValue(
    fieldValueById(input.fieldValues, wordField.id),
    'word',
  );
  const definition = requiredTextValue(
    fieldValueById(input.fieldValues, definitionField.id),
    'definition',
  );
  const normalizedLemma = normalizeVocabularyText(lemma, sourceLanguageTag);
  const normalizedDefinition = normalizeVocabularyText(
    definition,
    definitionLanguageTag,
  );
  assertIndexedTextSize(
    normalizedLemma,
    'word',
    MAX_NORMALIZED_LEMMA_BYTES,
  );
  assertIndexedTextSize(
    normalizedDefinition,
    'definition',
    MAX_NORMALIZED_DEFINITION_BYTES,
  );
  const content: ArtifactContent = {
    cardId: input.cardId,
    sourceLanguageTag,
    definitionLanguageTag,
    lemma,
    normalizedLemma,
    partOfSpeech: partOfSpeechField
      ? normalizePartOfSpeech(fieldValueById(input.fieldValues, partOfSpeechField.id))
      : 'unknown',
    definition,
    normalizedDefinition,
    ipa: ipaField ? textValue(fieldValueById(input.fieldValues, ipaField.id)) : null,
    examples: examplesField
      ? parseExamples(fieldValueById(input.fieldValues, examplesField.id))
      : [],
    representationVersion: 'v1',
  };

  return { ...content, contentHash: contentHash(content) };
}
