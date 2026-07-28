import type { VerifierStructuredProvider } from './kg-verifier';
import {
  buildSenseExpansionPrompt,
  parseSenseExpansionSuggestions,
  SENSE_EXPANSION_SCHEMA,
} from './kg-expansion.service';
import type { LexicalProvider } from './kg-lexical-provider';

export function createGeminiLexicalProvider(
  provider: VerifierStructuredProvider,
): LexicalProvider {
  return {
    async expandSense(request) {
      const result = await provider.generateStructured({
        prompt: buildSenseExpansionPrompt(request.focus),
        schema: SENSE_EXPANSION_SCHEMA,
        signal: request.signal,
        parse(value) {
          return parseSenseExpansionSuggestions(value, request.focus);
        },
      });
      return {
        suggestions: result.value,
        usage: result.usage,
      };
    },
  };
}
