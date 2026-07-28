import { describe, expect, test } from 'bun:test';

import {
  createGeminiProvider,
  GeminiProviderTimeoutError,
  type GeminiTransport,
  type GeminiTransportFactory,
} from '../../../src/modules/ai/gemini-provider';

const vector = (value = 0.1) => Array.from({ length: 768 }, () => value);

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(turns = 10) {
  for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

function providerFor(
  transport: GeminiTransport,
  overrides: Partial<Parameters<typeof createGeminiProvider>[0]> = {},
) {
  return createGeminiProvider({
    apiKey: 'test-key',
    generationModel: 'gemini-test',
    embeddingModel: 'gemini-embedding-2',
    requestTimeoutMs: 1_000,
    maxConcurrency: 2,
    transportFactory: () => transport,
    ...overrides,
  });
}

describe('Gemini provider', () => {
  test('does not acquire stream resources until iteration and settles usage when cancelled before start', async () => {
    let streamCalls = 0;
    let timerStarts = 0;
    let timerClears = 0;
    const provider = providerFor(
      {
        models: {
          generateContent: async () => ({ text: 'ordinary response' }),
          generateContentStream: async () => {
            streamCalls++;
            return (async function* () {
              yield { text: 'unused' };
            })();
          },
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      {
        maxConcurrency: 1,
        timers: {
          setTimeout() {
            timerStarts++;
            return { unref() {} };
          },
          clearTimeout() {
            timerClears++;
          },
        },
      },
    );

    const result = await provider.generateTextStream({ prompt: 'cards' });

    expect(streamCalls).toBe(0);
    expect(timerStarts).toBe(0);
    expect((await provider.generateText({ prompt: 'ordinary' })).value).toBe(
      'ordinary response',
    );

    const iterator = result.stream[Symbol.asyncIterator]();
    await iterator.return?.();

    expect(await result.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
    });
    expect(streamCalls).toBe(0);
    expect(timerStarts).toBe(1);
    expect(timerClears).toBe(1);
  });

  test('creates its transport lazily and preserves streamed text chunks', async () => {
    let factoryCalls = 0;
    const transport: GeminiTransport = {
      models: {
        generateContent: async () => ({ text: 'unused' }),
        generateContentStream: async () =>
          (async function* () {
            yield { text: '[{"front":"One",' };
            yield {
              text: '"back":"Two"}]',
              usageMetadata: {
                promptTokenCount: 7,
                candidatesTokenCount: 5,
              },
            };
          })(),
        embedContent: async () => ({ embeddings: [{ values: vector() }] }),
      },
    };
    const transportFactory: GeminiTransportFactory = () => {
      factoryCalls++;
      return transport;
    };
    const provider = providerFor(transport, { transportFactory });

    expect(factoryCalls).toBe(0);
    const result = await provider.generateTextStream({ prompt: 'cards' });
    const chunks: string[] = [];
    for await (const chunk of result.stream) chunks.push(chunk);

    expect(chunks).toEqual(['[{"front":"One",', '"back":"Two"}]']);
    expect(await result.usage).toEqual({ inputTokens: 7, outputTokens: 5 });
    expect(factoryCalls).toBe(1);
  });

  test('sends JSON Schema structured output at temperature zero and normalizes usage', async () => {
    let received: Record<string, unknown> | undefined;
    const schema = {
      type: 'object',
      properties: { related: { type: 'boolean' } },
      required: ['related'],
      additionalProperties: false,
    };
    const transport: GeminiTransport = {
      models: {
        generateContent: async (request) => {
          received = request;
          return {
            text: '{"related":true}',
            usageMetadata: {
              promptTokenCount: 11,
              candidatesTokenCount: 3,
            },
          };
        },
        generateContentStream: async () => (async function* () {})(),
        embedContent: async () => ({ embeddings: [{ values: vector() }] }),
      },
    };
    const provider = providerFor(transport);

    const result = await provider.generateStructured({
      prompt: 'classify',
      schema,
      parse(value) {
        if (
          value === null ||
          typeof value !== 'object' ||
          typeof (value as { related?: unknown }).related !== 'boolean'
        ) {
          throw new Error('invalid classification');
        }
        return value as { related: boolean };
      },
    });

    expect(result).toEqual({
      value: { related: true },
      usage: { inputTokens: 11, outputTokens: 3 },
    });
    expect(received).toMatchObject({
      model: 'gemini-test',
      contents: 'classify',
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    });
  });

  test('requests separate 768d semantic-similarity embeddings', async () => {
    let received: Record<string, unknown> | undefined;
    const transport: GeminiTransport = {
      models: {
        generateContent: async () => ({ text: 'unused' }),
        generateContentStream: async () => (async function* () {})(),
        embedContent: async (request) => {
          received = request;
          return {
            embeddings: [
              { values: vector(0.1) },
              { values: vector(0.2) },
            ],
            usageMetadata: { promptTokenCount: 13 },
          };
        },
      },
    };
    const provider = providerFor(transport);

    const result = await provider.embedTexts(['first', 'second']);

    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toHaveLength(768);
    expect(result.usage).toEqual({ inputTokens: 13, outputTokens: null });
    expect(received).toMatchObject({
      model: 'gemini-embedding-2',
      contents: [
        { role: 'user', parts: [{ text: 'first' }] },
        { role: 'user', parts: [{ text: 'second' }] },
      ],
      config: {
        outputDimensionality: 768,
        taskType: 'SEMANTIC_SIMILARITY',
      },
    });
  });

  test('rejects malformed, non-finite, and wrong-count embedding responses', async () => {
    const malformedVectors = [
      [{ values: vector().slice(1) }],
      [{ values: [...vector().slice(0, 767), Number.NaN] }],
      [{ values: vector() }, { values: vector() }],
    ];

    for (const embeddings of malformedVectors) {
      const provider = providerFor({
        models: {
          generateContent: async () => ({ text: 'unused' }),
          generateContentStream: async () => (async function* () {})(),
          embedContent: async () => ({ embeddings }),
        },
      });
      await expect(provider.embedTexts(['one'])).rejects.toThrow(
        'Invalid Gemini embedding response',
      );
    }
  });

  test('clears and unreferences a provider timeout after success', async () => {
    let unrefCalls = 0;
    let clearCalls = 0;
    const timerHandle = {
      unref() {
        unrefCalls++;
      },
    };
    const provider = providerFor(
      {
        models: {
          generateContent: async () => ({ text: 'ok' }),
          generateContentStream: async () => (async function* () {})(),
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      {
        timers: {
          setTimeout: () => timerHandle,
          clearTimeout(handle) {
            expect(handle).toBe(timerHandle);
            clearCalls++;
          },
        },
      },
    );

    await provider.generateText({ prompt: 'hello' });

    expect(unrefCalls).toBe(1);
    expect(clearCalls).toBe(1);
  });

  test('reports a provider timeout distinctly and clears its timer', async () => {
    let timeoutCallback: (() => void) | undefined;
    let clearCalls = 0;
    const provider = providerFor(
      {
        models: {
          generateContent: ({ config }) =>
            new Promise((_, reject) => {
              config?.abortSignal?.addEventListener(
                'abort',
                () => reject(config.abortSignal?.reason),
                { once: true },
              );
            }),
          generateContentStream: async () => (async function* () {})(),
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      {
        timers: {
          setTimeout(callback) {
            timeoutCallback = callback;
            return { unref() {} };
          },
          clearTimeout() {
            clearCalls++;
          },
        },
      },
    );

    const request = provider.generateText({ prompt: 'hang' });
    await Promise.resolve();
    timeoutCallback?.();

    await expect(request).rejects.toBeInstanceOf(GeminiProviderTimeoutError);
    expect(clearCalls).toBe(1);
  });

  test('times out while queued for the concurrency gate', async () => {
    const holderRelease = deferred();
    const timerCallbacks = new Map<number, () => void>();
    const prompts: unknown[] = [];
    const provider = providerFor(
      {
        models: {
          generateContent: async (request) => {
            prompts.push(request.contents);
            if (request.contents === 'holder') await holderRelease.promise;
            return { text: 'ok' };
          },
          generateContentStream: async () => (async function* () {})(),
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      {
        maxConcurrency: 1,
        timers: {
          setTimeout(callback, delayMs) {
            timerCallbacks.set(delayMs, callback);
            return { unref() {} };
          },
          clearTimeout() {},
        },
      },
    );

    const holder = provider.generateText({
      prompt: 'holder',
      timeoutMs: 1_000,
    });
    await flushMicrotasks();
    const queued = provider.generateText({
      prompt: 'queued',
      timeoutMs: 25,
    });

    try {
      await flushMicrotasks();
      expect(timerCallbacks.has(25)).toBe(true);
      timerCallbacks.get(25)?.();

      await expect(queued).rejects.toBeInstanceOf(
        GeminiProviderTimeoutError,
      );
      expect(prompts).toEqual(['holder']);
    } finally {
      holderRelease.resolve();
      await Promise.allSettled([holder, queued]);
    }
  });

  test('starts a streamed request timeout while its first iteration is queued', async () => {
    const holderRelease = deferred();
    const timerCallbacks = new Map<number, () => void>();
    let streamCalls = 0;
    const provider = providerFor(
      {
        models: {
          generateContent: async (request) => {
            if (request.contents === 'holder') await holderRelease.promise;
            return { text: 'ok' };
          },
          generateContentStream: async () => {
            streamCalls++;
            return (async function* () {
              yield { text: 'late' };
            })();
          },
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      {
        maxConcurrency: 1,
        timers: {
          setTimeout(callback, delayMs) {
            timerCallbacks.set(delayMs, callback);
            return { unref() {} };
          },
          clearTimeout() {},
        },
      },
    );

    const holder = provider.generateText({
      prompt: 'holder',
      timeoutMs: 1_000,
    });
    await flushMicrotasks();
    const result = await provider.generateTextStream({
      prompt: 'queued stream',
      timeoutMs: 25,
    });
    const iterator = result.stream[Symbol.asyncIterator]();
    const firstChunk = iterator.next();

    try {
      await flushMicrotasks();
      expect(timerCallbacks.has(25)).toBe(true);
      timerCallbacks.get(25)?.();

      await expect(firstChunk).rejects.toBeInstanceOf(
        GeminiProviderTimeoutError,
      );
      expect(await result.usage).toEqual({
        inputTokens: null,
        outputTokens: null,
      });
      expect(streamCalls).toBe(0);
    } finally {
      holderRelease.resolve();
      await Promise.allSettled([holder, firstChunk]);
    }
  });

  test('preserves a caller abort reason instead of reporting a timeout', async () => {
    const caller = new AbortController();
    const callerReason = new DOMException('cancelled by caller', 'AbortError');
    const provider = providerFor({
      models: {
        generateContent: ({ config }) =>
          new Promise((_, reject) => {
            config?.abortSignal?.addEventListener(
              'abort',
              () => reject(config.abortSignal?.reason),
              { once: true },
            );
          }),
        generateContentStream: async () => (async function* () {})(),
        embedContent: async () => ({ embeddings: [{ values: vector() }] }),
      },
    });

    const request = provider.generateText({
      prompt: 'hang',
      signal: caller.signal,
    });
    await Promise.resolve();
    caller.abort(callerReason);

    await expect(request).rejects.toBe(callerReason);
  });

  test('timeout releases a started but abandoned stream and settles usage', async () => {
    const timerCallbacks = new Map<number, () => void>();
    const clearedDelays: number[] = [];
    let ordinaryCalls = 0;
    const provider = providerFor(
      {
        models: {
          generateContent: async () => {
            ordinaryCalls++;
            return { text: 'after timeout' };
          },
          generateContentStream: async () =>
            (async function* () {
              yield {
                text: 'partial',
                usageMetadata: {
                  promptTokenCount: 4,
                  candidatesTokenCount: 1,
                },
              };
            })(),
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      {
        maxConcurrency: 1,
        timers: {
          setTimeout(callback, delayMs) {
            timerCallbacks.set(delayMs, callback);
            return { delayMs, unref() {} };
          },
          clearTimeout(handle) {
            clearedDelays.push((handle as { delayMs: number }).delayMs);
          },
        },
      },
    );

    const result = await provider.generateTextStream({
      prompt: 'stream',
      timeoutMs: 25,
    });
    const iterator = result.stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 'partial', done: false });

    let usageSettled = false;
    void result.usage.then(() => {
      usageSettled = true;
    });
    timerCallbacks.get(25)?.();
    const follower = provider.generateText({
      prompt: 'after',
      timeoutMs: 1_000,
    });

    try {
      await flushMicrotasks();
      expect(ordinaryCalls).toBe(1);
      expect(usageSettled).toBe(true);
      expect(await result.usage).toEqual({
        inputTokens: 4,
        outputTokens: 1,
      });
      expect(clearedDelays.filter((delay) => delay === 25)).toHaveLength(1);
      expect((await follower).value).toBe('after timeout');
    } finally {
      await iterator.return?.();
      await Promise.allSettled([follower]);
    }
  });

  test('caller abort releases a started but abandoned stream and preserves its reason', async () => {
    const caller = new AbortController();
    const callerReason = new DOMException('stream cancelled', 'AbortError');
    let clearCalls = 0;
    let ordinaryCalls = 0;
    const provider = providerFor(
      {
        models: {
          generateContent: async () => {
            ordinaryCalls++;
            return { text: 'after abort' };
          },
          generateContentStream: async () =>
            (async function* () {
              yield { text: 'partial' };
            })(),
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      {
        maxConcurrency: 1,
        timers: {
          setTimeout() {
            return { unref() {} };
          },
          clearTimeout() {
            clearCalls++;
          },
        },
      },
    );

    const result = await provider.generateTextStream({
      prompt: 'stream',
      signal: caller.signal,
    });
    const iterator = result.stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 'partial', done: false });

    let usageSettled = false;
    void result.usage.then(() => {
      usageSettled = true;
    });
    caller.abort(callerReason);
    const follower = provider.generateText({ prompt: 'after' });

    try {
      await flushMicrotasks();
      expect(ordinaryCalls).toBe(1);
      expect(usageSettled).toBe(true);
      expect(await result.usage).toEqual({
        inputTokens: null,
        outputTokens: null,
      });
      expect(clearCalls).toBeGreaterThanOrEqual(1);
      expect((await follower).value).toBe('after abort');
    } finally {
      await iterator.return?.();
      await Promise.allSettled([follower]);
    }
  });

  test('immediate abort after a gate grant releases the acquired stream slot', async () => {
    const caller = new AbortController();
    const callerReason = new DOMException('cancelled immediately', 'AbortError');
    const followerAbort = new AbortController();
    let streamCalls = 0;
    let ordinaryCalls = 0;
    const provider = providerFor(
      {
        models: {
          generateContent: async () => {
            ordinaryCalls++;
            return { text: 'slot released' };
          },
          generateContentStream: async () => {
            streamCalls++;
            return (async function* () {
              yield { text: 'unexpected' };
            })();
          },
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      { maxConcurrency: 1 },
    );

    const result = await provider.generateTextStream({
      prompt: 'stream',
      signal: caller.signal,
    });
    const firstChunk = result.stream[Symbol.asyncIterator]().next();
    caller.abort(callerReason);

    await expect(firstChunk).rejects.toBe(callerReason);
    const follower = provider.generateText({
      prompt: 'after',
      signal: followerAbort.signal,
    });
    try {
      await flushMicrotasks();
      expect(streamCalls).toBe(0);
      expect(ordinaryCalls).toBe(1);
      expect((await follower).value).toBe('slot released');
    } finally {
      followerAbort.abort();
      await Promise.allSettled([follower]);
    }
  });

  test('consumer break closes the source and releases the stream slot', async () => {
    let sourceClosed = false;
    let ordinaryCalls = 0;
    const provider = providerFor(
      {
        models: {
          generateContent: async () => {
            ordinaryCalls++;
            return { text: 'after break' };
          },
          generateContentStream: async () =>
            (async function* () {
              try {
                yield {
                  text: 'first',
                  usageMetadata: {
                    promptTokenCount: 2,
                    candidatesTokenCount: 1,
                  },
                };
                yield { text: 'second' };
              } finally {
                sourceClosed = true;
              }
            })(),
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      { maxConcurrency: 1 },
    );

    const result = await provider.generateTextStream({ prompt: 'stream' });
    for await (const chunk of result.stream) {
      expect(chunk).toBe('first');
      break;
    }

    expect(sourceClosed).toBe(true);
    expect(await result.usage).toEqual({
      inputTokens: 2,
      outputTokens: 1,
    });
    expect((await provider.generateText({ prompt: 'after' })).value).toBe(
      'after break',
    );
    expect(ordinaryCalls).toBe(1);
  });

  test('source errors release the stream slot and preserve partial usage', async () => {
    let ordinaryCalls = 0;
    const provider = providerFor(
      {
        models: {
          generateContent: async () => {
            ordinaryCalls++;
            return { text: 'after error' };
          },
          generateContentStream: async () =>
            (async function* () {
              yield {
                text: 'first',
                usageMetadata: {
                  promptTokenCount: 3,
                  candidatesTokenCount: 1,
                },
              };
              throw new Error('stream failed');
            })(),
          embedContent: async () => ({ embeddings: [{ values: vector() }] }),
        },
      },
      { maxConcurrency: 1 },
    );

    const result = await provider.generateTextStream({ prompt: 'stream' });
    const iterator = result.stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 'first', done: false });
    await expect(iterator.next()).rejects.toThrow('stream failed');

    expect(await result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 1,
    });
    expect((await provider.generateText({ prompt: 'after' })).value).toBe(
      'after error',
    );
    expect(ordinaryCalls).toBe(1);
  });

  test('bounds concurrent provider requests', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const provider = providerFor({
      models: {
        generateContent: async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => releases.push(resolve));
          active--;
          return { text: 'ok' };
        },
        generateContentStream: async () => (async function* () {})(),
        embedContent: async () => ({ embeddings: [{ values: vector() }] }),
      },
    });

    const requests = [
      provider.generateText({ prompt: 'one' }),
      provider.generateText({ prompt: 'two' }),
      provider.generateText({ prompt: 'three' }),
    ];
    await Promise.resolve();
    await Promise.resolve();

    expect(active).toBe(2);
    expect(maxActive).toBe(2);
    releases.shift()?.();
    for (let turn = 0; turn < 10 && releases.length < 2; turn++) {
      await Promise.resolve();
    }
    expect(active).toBe(2);
    releases.splice(0).forEach((release) => release());
    await Promise.all(requests);
    expect(maxActive).toBe(2);
  });
});
