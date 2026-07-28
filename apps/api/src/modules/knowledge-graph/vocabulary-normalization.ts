import { ValidationError } from '../../shared/errors';

const WHITESPACE = /\s+/gu;

export function canonicalizeLanguageTag(languageTag: string): string {
  try {
    const [canonical] = Intl.getCanonicalLocales(languageTag);
    if (!canonical) throw new RangeError('Language tag is empty');
    return canonical;
  } catch {
    throw new ValidationError('Invalid language tag');
  }
}

export function normalizeVocabularyText(value: string, languageTag: string): string {
  const canonicalLanguageTag = canonicalizeLanguageTag(languageTag);
  return value
    .normalize('NFKC')
    .replace(WHITESPACE, ' ')
    .trim()
    .toLocaleLowerCase(canonicalLanguageTag);
}

export function normalizeVocabularyDisplayText(value: string): string {
  return value.normalize('NFKC').replace(WHITESPACE, ' ').trim();
}
