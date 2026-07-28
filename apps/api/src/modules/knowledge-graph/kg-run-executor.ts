import { createDeckKnowledgeGraphExecutor } from './kg-deck-executor';
import { createSenseExpansionExecutor } from './kg-expansion-executor';
import type {
  KgStageExecutionResult,
  KgStageExecutor,
} from './kg-worker';

export type KnowledgeGraphExecutorDependencies = {
  deck: KgStageExecutor;
  expansion: KgStageExecutor;
};

function defaultDependencies(): KnowledgeGraphExecutorDependencies {
  return {
    deck: createDeckKnowledgeGraphExecutor(),
    expansion: createSenseExpansionExecutor(),
  };
}

export function createKnowledgeGraphExecutor(
  dependencies: KnowledgeGraphExecutorDependencies = defaultDependencies(),
): KgStageExecutor {
  return (context): Promise<KgStageExecutionResult> =>
    context.run.runType === 'deck_index'
      ? dependencies.deck(context)
      : dependencies.expansion(context);
}
