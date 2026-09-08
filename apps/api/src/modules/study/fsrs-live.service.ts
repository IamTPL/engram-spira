import {
  canonicalUuid,
  normalizeLiveReviewCommands,
  type NormalizedLiveReviewCommand,
  type ReviewEventInput,
  type ReviewEventResult,
} from './fsrs-live.domain';

export interface FsrsLiveReviewBatchResult {
  results: ReviewEventResult[];
  applied: number;
  duplicates: number;
}

export interface FsrsLiveReviewBatchRepositoryInput {
  userId: string;
  commands: NormalizedLiveReviewCommand[];
  timezoneOffsetMinutes: number;
}

export interface FsrsParameterRevisionResult {
  id: string;
  revision: number;
  status: 'active' | 'created' | 'reactivated';
  paramsHash: string;
}

export interface FsrsLiveRepository {
  applyReviewBatch(
    input: FsrsLiveReviewBatchRepositoryInput,
  ): Promise<FsrsLiveReviewBatchResult>;
  resetCards(userId: string, cardIds: readonly string[]): Promise<number>;
  resetDeck(userId: string, deckId: string): Promise<number>;
  rotateParameters(
    userId: string,
    parameters: unknown,
  ): Promise<FsrsParameterRevisionResult>;
}

export function createFsrsLiveService(
  repository: FsrsLiveRepository,
  clock: () => Date = () => new Date(),
) {
  async function reviewBatch(
    userId: string,
    events: readonly ReviewEventInput[],
    timezoneOffsetMinutes = 0,
  ): Promise<FsrsLiveReviewBatchResult> {
    const receivedAt = clock();
    const commands = normalizeLiveReviewCommands(events, receivedAt);
    return repository.applyReviewBatch({
      userId,
      commands,
      timezoneOffsetMinutes,
    });
  }

  return {
    reviewBatch,
    async reviewCard(
      userId: string,
      event: ReviewEventInput,
      timezoneOffsetMinutes = 0,
    ): Promise<ReviewEventResult> {
      const batch = await reviewBatch(
        userId,
        [event],
        timezoneOffsetMinutes,
      );
      return batch.results[0]!;
    },
    async resetCard(userId: string, cardId: string) {
      const canonicalUserId = canonicalUuid(userId, 'User id');
      const canonicalCardId = canonicalUuid(cardId, 'Card id');
      return repository.resetCards(canonicalUserId, [canonicalCardId]);
    },
    async resetDeck(userId: string, deckId: string) {
      const canonicalUserId = canonicalUuid(userId, 'User id');
      const canonicalDeckId = canonicalUuid(deckId, 'Deck id');
      return repository.resetDeck(canonicalUserId, canonicalDeckId);
    },
    async rotateParameters(userId: string, parameters: unknown) {
      const canonicalUserId = canonicalUuid(userId, 'User id');
      return repository.rotateParameters(canonicalUserId, parameters);
    },
  };
}
