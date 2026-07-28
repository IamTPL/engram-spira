import type { VocabularyArtifact } from './vocabulary-artifact';
import type { GeneratedSenseExpansion } from './kg-expansion.service';

export type LexicalExpansionRequest = {
  focus: VocabularyArtifact;
  maxSuggestions: number;
  signal?: AbortSignal;
};

export interface LexicalProvider {
  expandSense(
    request: LexicalExpansionRequest,
  ): Promise<GeneratedSenseExpansion>;
}
