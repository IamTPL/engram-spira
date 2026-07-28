import {
  evaluateKnowledgeGraphQuality,
  parseKnowledgeGraphEvaluationDataset,
} from '../modules/knowledge-graph/kg-evaluation';

const datasetPath = Bun.argv[2];

if (!datasetPath) {
  console.error(
    'Usage: bun run kg:evaluate -- <human-labelled-evaluation.json>',
  );
  process.exitCode = 2;
} else {
  try {
    const input = await Bun.file(datasetPath).json();
    const dataset = parseKnowledgeGraphEvaluationDataset(input);
    const result = evaluateKnowledgeGraphQuality(
      dataset.labels,
      dataset.predictions,
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof Error
        ? `Knowledge graph evaluation failed: ${error.message}`
        : 'Knowledge graph evaluation failed',
    );
    process.exitCode = 2;
  }
}
