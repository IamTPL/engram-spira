import {
  GeminiProviderTimeoutError,
  getGeminiProvider,
} from '../ai/gemini-provider';
import { ValidationError } from '../../shared/errors';
import {
  buildSenseExpansionArtifact,
  buildSenseExpansionSuggestionFingerprint,
  generateSenseExpansionSuggestions,
  MAX_SENSE_EXPANSION_SUGGESTIONS,
  parseSenseExpansionArtifact,
  parseSenseExpansionSnapshot,
  parseSenseExpansionSuggestions,
  type GeneratedSenseExpansion,
  type PersistedSenseExpansionSuggestion,
  type SenseExpansionPersistenceFence,
  type SenseExpansionPersistenceResult,
  type SenseExpansionSource,
} from './kg-expansion.service';
import { createPostgresSenseExpansionRepository } from './kg-expansion.repository';
import { createGeminiLexicalProvider } from './gemini-lexical-provider';
import { isRetryableVerifierProviderError } from './kg-verifier';
import {
  KG_EXPANSION_PROMPT_VERSION,
  KG_REPRESENTATION_VERSION,
  KG_TAXONOMY_VERSION,
} from './kg-versions';
import type {
  KgRunStage,
  KgStageExecutionContext,
  KgStageExecutionResult,
  KgStageExecutor,
} from './kg-worker';

const TOTAL_STAGES = 3;
const MAX_WORKER_ATTEMPTS = 5;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type SenseExpansionExecutorDependencies = {
  generationModel: string;
  embeddingModel: string;
  loadOwnedSense(
    userId: string,
    senseId: string,
  ): Promise<SenseExpansionSource | null>;
  generateSuggestions(
    focus: ReturnType<typeof buildSenseExpansionArtifact>,
    signal?: AbortSignal,
  ): Promise<GeneratedSenseExpansion>;
  persistSuggestions(
    fence: SenseExpansionPersistenceFence,
    suggestions: PersistedSenseExpansionSuggestion[],
  ): Promise<SenseExpansionPersistenceResult>;
};

type FrozenExpansionSuggestions = {
  version: 'sense-expansion-suggestions-v1';
  items: PersistedSenseExpansionSuggestion[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: string[],
  label: string,
): void {
  const expectedKeys = new Set(expected);
  const keys = Object.keys(value);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => !expectedKeys.has(key))
  ) {
    throw new ValidationError(`Invalid frozen expansion ${label}`);
  }
}

function buildFrozenSuggestions(
  items: PersistedSenseExpansionSuggestion[],
): FrozenExpansionSuggestions {
  if (items.length > MAX_SENSE_EXPANSION_SUGGESTIONS) {
    throw new ValidationError('Too many frozen expansion suggestions');
  }
  return {
    version: 'sense-expansion-suggestions-v1',
    items,
  };
}

function parseFrozenSuggestions(
  value: unknown,
  context: {
    userId: string;
    sourceArtifact: ReturnType<typeof buildSenseExpansionArtifact>;
    generationModel: string;
    representationVersion: string;
    promptVersion: string;
    taxonomyVersion: string;
  },
): PersistedSenseExpansionSuggestion[] {
  if (!isRecord(value)) {
    throw new ValidationError('Invalid frozen expansion suggestions');
  }
  assertExactKeys(value, ['version', 'items'], 'suggestion snapshot');
  if (
    value.version !== 'sense-expansion-suggestions-v1' ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_SENSE_EXPANSION_SUGGESTIONS
  ) {
    throw new ValidationError('Invalid frozen expansion suggestions');
  }
  const fingerprints = new Set<string>();
  return value.items.map((item) => {
    if (!isRecord(item)) {
      throw new ValidationError('Invalid frozen expansion suggestion');
    }
    assertExactKeys(
      item,
      [
        'targetArtifact',
        'relationType',
        'direction',
        'confidenceBand',
        'reason',
        'evidence',
        'fingerprint',
      ],
      'suggestion',
    );
    const targetArtifact = parseSenseExpansionArtifact(item.targetArtifact);
    if (!isRecord(item.evidence)) {
      throw new ValidationError('Invalid frozen expansion evidence');
    }
    const [parsed] = parseSenseExpansionSuggestions(
      [
        {
          target: {
            sourceLanguageTag: targetArtifact.sourceLanguageTag,
            definitionLanguageTag: targetArtifact.definitionLanguageTag,
            lemma: targetArtifact.lemma,
            partOfSpeech: targetArtifact.partOfSpeech,
            definition: targetArtifact.definition,
            ipa: targetArtifact.ipa,
            examples: targetArtifact.examples,
          },
          relationType: item.relationType,
          direction: item.direction,
          confidenceBand: item.confidenceBand,
          reason: item.reason,
          evidence: item.evidence,
        },
      ],
      context.sourceArtifact,
    );
    if (
      !parsed ||
      parsed.targetArtifact.cardId !== targetArtifact.cardId ||
      parsed.targetArtifact.contentHash !== targetArtifact.contentHash ||
      typeof item.fingerprint !== 'string' ||
      !SHA256_PATTERN.test(item.fingerprint)
    ) {
      throw new ValidationError(
        'Invalid frozen expansion suggestion provenance',
      );
    }
    const expectedFingerprint = buildSenseExpansionSuggestionFingerprint({
      userId: context.userId,
      sourceArtifact: context.sourceArtifact,
      suggestion: parsed,
      generationModel: context.generationModel,
      representationVersion: context.representationVersion,
      promptVersion: context.promptVersion,
      taxonomyVersion: context.taxonomyVersion,
    });
    if (
      item.fingerprint !== expectedFingerprint ||
      fingerprints.has(item.fingerprint)
    ) {
      throw new ValidationError(
        'Invalid frozen expansion suggestion fingerprint',
      );
    }
    fingerprints.add(item.fingerprint);
    return {
      ...parsed,
      fingerprint: item.fingerprint,
    };
  });
}

function numericStat(
  stats: Record<string, unknown>,
  key: string,
): number {
  const value = stats[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function nullableTokenStat(
  stats: Record<string, unknown>,
  key: string,
): number | null {
  const value = stats[key];
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function addTokenUsage(
  current: number | null,
  increment: number | null,
): number | null {
  return current === null || increment === null ? null : current + increment;
}

function progress(completed: number) {
  return { completed, total: TOTAL_STAGES };
}

function terminalStats(stats: Record<string, unknown>) {
  return {
    indexedSenses: Math.max(1, numericStat(stats, 'indexedSenses')),
    verified: numericStat(stats, 'verified'),
    suggestions: numericStat(stats, 'suggestions'),
    verifierRequests: numericStat(stats, 'verifierRequests'),
    expansionRequests: numericStat(stats, 'expansionRequests'),
    inputTokens: nullableTokenStat(stats, 'inputTokens'),
    outputTokens: nullableTokenStat(stats, 'outputTokens'),
    schemaInvalid: numericStat(stats, 'schemaInvalid'),
    timeouts: numericStat(stats, 'timeouts'),
    providerErrors: numericStat(stats, 'providerErrors'),
  };
}

function staleResult(
  context: KgStageExecutionContext,
  completed: number,
): KgStageExecutionResult {
  return {
    outcome: 'stale',
    progress: progress(completed),
    statsPatch: terminalStats(context.run.stats),
  };
}

async function assertWorkerOwnership(
  context: KgStageExecutionContext,
): Promise<void> {
  if (context.signal.aborted) {
    throw context.signal.reason ?? new Error('Sense expansion run aborted');
  }
  if (!(await context.heartbeat())) {
    throw context.signal.reason ?? new Error('Sense expansion run superseded');
  }
}

async function advance(
  context: KgStageExecutionContext,
  stage: KgRunStage,
  completed: number,
  statsPatch: Record<string, unknown>,
  progressPatch: Record<string, unknown> = {},
): Promise<void> {
  if (
    !(await context.advanceStage(
      stage,
      { ...progress(completed), ...progressPatch },
      statsPatch,
    ))
  ) {
    throw context.signal.reason ?? new Error('Sense expansion run superseded');
  }
}

function defaultDependencies(): SenseExpansionExecutorDependencies {
  const provider = getGeminiProvider();
  const lexicalProvider = createGeminiLexicalProvider(provider);
  const repository = createPostgresSenseExpansionRepository();
  return {
    generationModel: provider.generationModel,
    embeddingModel: provider.embeddingModel,
    loadOwnedSense: (userId, senseId) =>
      repository.loadOwnedSense(userId, senseId),
    generateSuggestions: (focus, signal) =>
      generateSenseExpansionSuggestions(focus, lexicalProvider, signal),
    persistSuggestions: (fence, suggestions) =>
      repository.persistSuggestions(fence, suggestions),
  };
}

export function createSenseExpansionExecutor(
  dependencies: SenseExpansionExecutorDependencies = defaultDependencies(),
): KgStageExecutor {
  return async (context) => {
    const run = context.run;
    if (
      run.runType !== 'sense_expansion' ||
      run.focusSenseId === null ||
      run.deckId !== null
    ) {
      throw new ValidationError('Invalid sense expansion run target');
    }
    if (
      run.representationVersion !== KG_REPRESENTATION_VERSION ||
      run.promptVersion !== KG_EXPANSION_PROMPT_VERSION ||
      run.taxonomyVersion !== KG_TAXONOMY_VERSION
    ) {
      return staleResult(context, numericStat(run.progress, 'completed'));
    }
    const snapshot = parseSenseExpansionSnapshot(run.snapshot);
    if (
      snapshot.generationModel !== dependencies.generationModel ||
      run.embeddingModel !== dependencies.embeddingModel
    ) {
      return staleResult(context, numericStat(run.progress, 'completed'));
    }

    let stage = run.stage;
    let focus = snapshot.focus;

    const loadCurrentFocus = async () => {
      await assertWorkerOwnership(context);
      const current = await dependencies.loadOwnedSense(
        run.userId,
        run.focusSenseId!,
      );
      if (current === null) return null;
      try {
        return buildSenseExpansionArtifact(current);
      } catch (error) {
        if (error instanceof ValidationError) return null;
        throw error;
      }
    };

    while (true) {
      if (stage === 'snapshot') {
        const current = await loadCurrentFocus();
        if (
          current === null ||
          current.cardId !== run.focusSenseId ||
          current.contentHash !== snapshot.focus.contentHash
        ) {
          return staleResult(context, 0);
        }
        focus = current;
        await advance(context, 'verification', 1, {
          indexedSenses: 1,
        });
        stage = 'verification';
        continue;
      }

      if (stage === 'verification') {
        const current = await loadCurrentFocus();
        if (
          current === null ||
          current.contentHash !== snapshot.focus.contentHash
        ) {
          return staleResult(context, 1);
        }
        focus = current;
        let generated: GeneratedSenseExpansion;
        try {
          generated = await dependencies.generateSuggestions(
            focus,
            context.signal,
          );
        } catch (error) {
          if (context.signal.aborted) {
            throw context.signal.reason ?? error;
          }
          const schemaInvalid = error instanceof ValidationError ? 1 : 0;
          const timeouts =
            error instanceof GeminiProviderTimeoutError ? 1 : 0;
          const providerErrors =
            schemaInvalid === 0 && timeouts === 0 ? 1 : 0;
          const statsPatch = {
            indexedSenses: 1,
            verified: 0,
            suggestions: 0,
            verifierRequests:
              numericStat(run.stats, 'verifierRequests') + 1,
            expansionRequests:
              numericStat(run.stats, 'expansionRequests') + 1,
            inputTokens: nullableTokenStat(run.stats, 'inputTokens'),
            outputTokens: nullableTokenStat(run.stats, 'outputTokens'),
            schemaInvalid:
              numericStat(run.stats, 'schemaInvalid') + schemaInvalid,
            timeouts: numericStat(run.stats, 'timeouts') + timeouts,
            providerErrors:
              numericStat(run.stats, 'providerErrors') + providerErrors,
          };
          const attemptLimit = Math.min(
            MAX_WORKER_ATTEMPTS,
            Math.max(1, run.maxAttempts),
          );
          if (
            isRetryableVerifierProviderError(error) &&
            run.attemptCount < attemptLimit
          ) {
            await advance(context, 'verification', 1, statsPatch);
            Object.assign(run.stats, statsPatch);
            throw error;
          }
          return {
            outcome: 'partial',
            progress: progress(2),
            statsPatch,
          };
        }
        await assertWorkerOwnership(context);
        const records = generated.suggestions.map((suggestion) => ({
          ...suggestion,
          fingerprint: buildSenseExpansionSuggestionFingerprint({
            userId: run.userId,
            sourceArtifact: focus,
            suggestion,
            generationModel: snapshot.generationModel,
            representationVersion: run.representationVersion,
            promptVersion: run.promptVersion,
            taxonomyVersion: run.taxonomyVersion,
          }),
        }));
        const frozen = buildFrozenSuggestions(records);
        const statsPatch = {
          indexedSenses: 1,
          verified: records.length,
          suggestions: 0,
          verifierRequests:
            numericStat(run.stats, 'verifierRequests') + 1,
          expansionRequests:
            numericStat(run.stats, 'expansionRequests') + 1,
          inputTokens: addTokenUsage(
            nullableTokenStat(run.stats, 'inputTokens'),
            generated.usage.inputTokens,
          ),
          outputTokens: addTokenUsage(
            nullableTokenStat(run.stats, 'outputTokens'),
            generated.usage.outputTokens,
          ),
          schemaInvalid: numericStat(run.stats, 'schemaInvalid'),
          timeouts: numericStat(run.stats, 'timeouts'),
          providerErrors: numericStat(run.stats, 'providerErrors'),
        };
        await advance(context, 'persistence', 2, statsPatch, {
          expansionSuggestions: frozen,
        });
        Object.assign(run.stats, statsPatch);
        run.progress.expansionSuggestions = frozen;
        stage = 'persistence';
        continue;
      }

      if (stage === 'persistence') {
        const current = await loadCurrentFocus();
        if (
          current === null ||
          current.contentHash !== snapshot.focus.contentHash
        ) {
          return staleResult(context, 2);
        }
        focus = current;
        const records = parseFrozenSuggestions(
          run.progress.expansionSuggestions,
          {
            userId: run.userId,
            sourceArtifact: focus,
            generationModel: snapshot.generationModel,
            representationVersion: run.representationVersion,
            promptVersion: run.promptVersion,
            taxonomyVersion: run.taxonomyVersion,
          },
        );
        await assertWorkerOwnership(context);
        const persisted = await dependencies.persistSuggestions(
          {
            runId: run.id,
            userId: run.userId,
            focusSenseId: run.focusSenseId,
            workerId: context.workerId,
            expectedFocus: focus,
          },
          records,
        );
        if (persisted.outcome === 'stale') {
          return staleResult(context, 2);
        }
        if (persisted.outcome === 'superseded') {
          throw (
            context.signal.reason ??
            new Error('Sense expansion persistence lease was superseded')
          );
        }
        Object.assign(run.stats, {
          suggestions: persisted.pending,
        });
        return {
          outcome: 'completed',
          progress: progress(TOTAL_STAGES),
          statsPatch: terminalStats(run.stats),
        };
      }

      throw new ValidationError(
        `Invalid sense expansion stage: ${stage}`,
      );
    }
  };
}
