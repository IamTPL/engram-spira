import { GoogleGenAI } from '@google/genai';

import { ENV } from '../../config/env';
import { ValidationError } from '../../shared/errors';

const EMBEDDING_DIMENSIONS = 768;
const DEFAULT_MAX_CONCURRENCY = 2;

export type GeminiUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type GeminiTransportUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export type GeminiTransportRequest = {
  model: string;
  contents: unknown;
  config?: {
    abortSignal?: AbortSignal;
    outputDimensionality?: number;
    taskType?: string;
    responseJsonSchema?: unknown;
    responseMimeType?: string;
    temperature?: number;
  };
};

export type GeminiTransportResponse = {
  text?: string;
  embeddings?: Array<{ values?: number[] }>;
  embedding?: { values?: number[] };
  usageMetadata?: GeminiTransportUsage;
};

export type GeminiTransport = {
  models: {
    generateContent(
      request: GeminiTransportRequest,
    ): Promise<GeminiTransportResponse>;
    generateContentStream(
      request: GeminiTransportRequest,
    ): Promise<AsyncIterable<GeminiTransportResponse>>;
    embedContent(
      request: GeminiTransportRequest,
    ): Promise<GeminiTransportResponse>;
  };
};

export type GeminiTransportFactory = (apiKey: string) => GeminiTransport;

type TimerHandle = {
  unref?: () => void;
};

type ProviderTimers = {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: unknown): void;
};

export type GeminiProviderOptions = {
  apiKey: string;
  generationModel: string;
  embeddingModel: string;
  requestTimeoutMs: number;
  maxConcurrency: number;
  transportFactory?: GeminiTransportFactory;
  timers?: ProviderTimers;
};

export type GeminiTextRequest = {
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type GeminiStructuredRequest<T> = GeminiTextRequest & {
  schema: unknown;
  parse(value: unknown): T;
};

export type GeminiResult<T> = {
  value: T;
  usage: GeminiUsage;
};

export type GeminiStreamResult = {
  stream: AsyncIterable<string>;
  usage: Promise<GeminiUsage>;
};

export type GeminiProvider = {
  readonly generationModel: string;
  readonly embeddingModel: string;
  generateText(request: GeminiTextRequest): Promise<GeminiResult<string>>;
  generateTextStream(request: GeminiTextRequest): Promise<GeminiStreamResult>;
  generateStructured<T>(
    request: GeminiStructuredRequest<T>,
  ): Promise<GeminiResult<T>>;
  embedTexts(
    inputs: string[],
    signal?: AbortSignal,
  ): Promise<GeminiResult<number[][]>>;
};

export class GeminiProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Gemini request timed out after ${timeoutMs}ms`);
    this.name = 'GeminiProviderTimeoutError';
  }
}

type GateWaiter = {
  resolve(release: () => void): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

class ProviderConcurrencyGate {
  private active = 0;
  private readonly waiters: GateWaiter[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new ValidationError('Gemini concurrency must be a positive integer');
    }
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(this.releaseOnce());
    }

    return new Promise((resolve, reject) => {
      const waiter: GateWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(abortReason(signal));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.startNext();
    };
  }

  private startNext(): void {
    while (this.waiters.length > 0 && this.active < this.limit) {
      const waiter = this.waiters.shift()!;
      if (waiter.onAbort && waiter.signal) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      this.active++;
      waiter.resolve(this.releaseOnce());
    }
  }
}

type RequestContext = {
  signal: AbortSignal;
  dispose(): void;
  normalizeError(error: unknown): unknown;
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function createRequestContext(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
  timers: ProviderTimers,
): RequestContext {
  const controller = new AbortController();
  let abortedBy: 'caller' | 'timeout' | null = null;
  const timeoutError = new GeminiProviderTimeoutError(timeoutMs);
  const onCallerAbort = () => {
    if (abortedBy) return;
    abortedBy = 'caller';
    controller.abort(callerSignal ? abortReason(callerSignal) : undefined);
  };

  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  if (callerSignal?.aborted) onCallerAbort();

  const timer = controller.signal.aborted
    ? null
    : timers.setTimeout(() => {
        if (abortedBy) return;
        abortedBy = 'timeout';
        controller.abort(timeoutError);
      }, timeoutMs);
  timer?.unref?.();

  return {
    signal: controller.signal,
    dispose() {
      if (timer) timers.clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
    normalizeError(error) {
      if (abortedBy === 'timeout') return timeoutError;
      if (abortedBy === 'caller' && callerSignal) return abortReason(callerSignal);
      return error;
    },
  };
}

function normalizeUsage(
  metadata: GeminiTransportUsage | undefined,
): GeminiUsage {
  const inputTokens = metadata?.promptTokenCount;
  const outputTokens = metadata?.candidatesTokenCount;
  return {
    inputTokens:
      typeof inputTokens === 'number' && Number.isFinite(inputTokens)
        ? inputTokens
        : null,
    outputTokens:
      typeof outputTokens === 'number' && Number.isFinite(outputTokens)
        ? outputTokens
        : null,
  };
}

export function assertValidEmbeddingVector(
  value: unknown,
): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length !== EMBEDDING_DIMENSIONS ||
    !value.every(
      (item) => typeof item === 'number' && Number.isFinite(item),
    )
  ) {
    throw new ValidationError(
      `Invalid Gemini embedding response: expected ${EMBEDDING_DIMENSIONS} finite values`,
    );
  }
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || norm <= 1e-12) {
    throw new ValidationError(
      'Invalid Gemini embedding response: expected a finite non-zero norm',
    );
  }
}

function defaultTransportFactory(apiKey: string): GeminiTransport {
  return new GoogleGenAI({ apiKey }) as unknown as GeminiTransport;
}

const defaultTimers: ProviderTimers = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function createGeminiProvider(
  options: GeminiProviderOptions,
): GeminiProvider {
  const gate = new ProviderConcurrencyGate(options.maxConcurrency);
  const timers = options.timers ?? defaultTimers;
  let transport: GeminiTransport | null = null;

  function getTransport(): GeminiTransport {
    if (!options.apiKey) {
      throw new ValidationError('GEMINI_API_KEY is not configured');
    }
    transport ??= (options.transportFactory ?? defaultTransportFactory)(
      options.apiKey,
    );
    return transport;
  }

  async function runRequest<T>(
    signal: AbortSignal | undefined,
    timeoutMs: number,
    operation: (transport: GeminiTransport, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const context = createRequestContext(signal, timeoutMs, timers);
    let release: (() => void) | undefined;
    try {
      release = await gate.acquire(context.signal);
      return await operation(getTransport(), context.signal);
    } catch (error) {
      throw context.normalizeError(error);
    } finally {
      context.dispose();
      release?.();
    }
  }

  return {
    generationModel: options.generationModel,
    embeddingModel: options.embeddingModel,

    async generateText(request) {
      return runRequest(
        request.signal,
        request.timeoutMs ?? options.requestTimeoutMs,
        async (client, signal) => {
          const response = await client.models.generateContent({
            model: options.generationModel,
            contents: request.prompt,
            config: { abortSignal: signal },
          });
          if (typeof response.text !== 'string') {
            throw new ValidationError('Invalid Gemini text response');
          }
          return {
            value: response.text,
            usage: normalizeUsage(response.usageMetadata),
          };
        },
      );
    },

    async generateTextStream(request) {
      let resolveUsage!: (usage: GeminiUsage) => void;
      const usage = new Promise<GeminiUsage>((resolve) => {
        resolveUsage = resolve;
      });
      let usageSettled = false;
      let latestUsage: GeminiUsage = {
        inputTokens: null,
        outputTokens: null,
      };
      let context: RequestContext | undefined;
      let release: (() => void) | undefined;
      let removeAbortListener: (() => void) | undefined;
      let sourceIterator: AsyncIterator<GeminiTransportResponse> | undefined;
      let sourceDone = false;
      let sourceClose: Promise<void> | undefined;
      let terminalError: unknown;
      let finalized = false;

      const settleUsage = () => {
        if (usageSettled) return;
        usageSettled = true;
        resolveUsage(latestUsage);
      };
      const closeSource = () => {
        if (sourceDone || !sourceIterator?.return) {
          return Promise.resolve();
        }
        sourceClose ??= Promise.resolve(sourceIterator.return()).then(
          () => undefined,
          () => undefined,
        );
        return sourceClose;
      };
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        removeAbortListener?.();
        context?.dispose();
        release?.();
        release = undefined;
        settleUsage();
      };
      const onAbort = () => {
        if (!context) return;
        terminalError = context.normalizeError(abortReason(context.signal));
        finalize();
        void closeSource();
      };

      const generator = (async function* () {
        try {
          context = createRequestContext(
            request.signal,
            request.timeoutMs ?? options.requestTimeoutMs,
            timers,
          );
          context.signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () =>
            context?.signal.removeEventListener('abort', onAbort);
          if (context.signal.aborted) {
            onAbort();
            throw terminalError;
          }

          const acquiredRelease = await gate.acquire(context.signal);
          if (finalized || context.signal.aborted) {
            acquiredRelease();
            throw (
              terminalError ??
              context.normalizeError(abortReason(context.signal))
            );
          }
          release = acquiredRelease;
          const responseStream =
            await getTransport().models.generateContentStream({
              model: options.generationModel,
              contents: request.prompt,
              config: { abortSignal: context.signal },
            });
          sourceIterator = responseStream[Symbol.asyncIterator]();

          while (true) {
            if (terminalError !== undefined) throw terminalError;
            const result = await sourceIterator.next();
            if (result.done) {
              sourceDone = true;
              break;
            }
            const chunk = result.value;
            if (chunk.usageMetadata) {
              latestUsage = normalizeUsage(chunk.usageMetadata);
            }
            if (chunk.text !== undefined) {
              if (typeof chunk.text !== 'string') {
                throw new ValidationError('Invalid Gemini stream response');
              }
              yield chunk.text;
              if (terminalError !== undefined) throw terminalError;
            }
          }
        } catch (error) {
          throw context?.normalizeError(error) ?? error;
        } finally {
          if (context?.signal.aborted) {
            void closeSource();
          } else {
            await closeSource();
          }
          finalize();
        }
      })();

      let iteratorStarted = false;
      const iterator: AsyncIterator<string> = {
        next() {
          iteratorStarted = true;
          return generator.next();
        },
        async return(value?: unknown) {
          if (!iteratorStarted) settleUsage();
          return generator.return(value as never);
        },
        async throw(error?: unknown) {
          if (!iteratorStarted) settleUsage();
          return generator.throw(error);
        },
      };
      const stream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };

      return { stream, usage };
    },

    async generateStructured(request) {
      return runRequest(
        request.signal,
        request.timeoutMs ?? options.requestTimeoutMs,
        async (client, signal) => {
          const response = await client.models.generateContent({
            model: options.generationModel,
            contents: request.prompt,
            config: {
              abortSignal: signal,
              temperature: 0,
              responseMimeType: 'application/json',
              responseJsonSchema: request.schema,
            },
          });
          if (typeof response.text !== 'string') {
            throw new ValidationError('Invalid Gemini structured response');
          }
          try {
            const parsed: unknown = JSON.parse(response.text);
            return {
              value: request.parse(parsed),
              usage: normalizeUsage(response.usageMetadata),
            };
          } catch (error) {
            if (error instanceof ValidationError) throw error;
            throw new ValidationError(
              `Invalid Gemini structured response: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        },
      );
    },

    async embedTexts(inputs, signal) {
      if (inputs.length === 0) {
        return {
          value: [],
          usage: { inputTokens: null, outputTokens: null },
        };
      }
      return runRequest(
        signal,
        options.requestTimeoutMs,
        async (client, requestSignal) => {
          const response = await client.models.embedContent({
            model: options.embeddingModel,
            contents: inputs.map((text) => ({
              role: 'user',
              parts: [{ text }],
            })),
            config: {
              abortSignal: requestSignal,
              outputDimensionality: EMBEDDING_DIMENSIONS,
              taskType: 'SEMANTIC_SIMILARITY',
            },
          });
          const embeddings =
            response.embeddings ??
            (response.embedding ? [response.embedding] : undefined);
          if (!embeddings || embeddings.length !== inputs.length) {
            throw new ValidationError(
              'Invalid Gemini embedding response: embedding count mismatch',
            );
          }
          const values = embeddings.map((embedding) => {
            assertValidEmbeddingVector(embedding.values);
            return embedding.values;
          });
          return {
            value: values,
            usage: normalizeUsage(response.usageMetadata),
          };
        },
      );
    },
  };
}

let defaultProvider: GeminiProvider | null = null;

export function getGeminiProvider(): GeminiProvider {
  defaultProvider ??= createGeminiProvider({
    apiKey: ENV.GEMINI_API_KEY,
    generationModel: ENV.GEMINI_MODEL,
    embeddingModel: ENV.GEMINI_EMBEDDING_MODEL,
    requestTimeoutMs: ENV.GEMINI_REQUEST_TIMEOUT_MS,
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  });
  return defaultProvider;
}
