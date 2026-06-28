import type {
  AggregateResponse,
  AggregateSectionMeta,
  AggregateSectionMap,
} from './experience.types';

export function okSection(): AggregateSectionMeta {
  return { status: 'ok' };
}

export function emptySection(): AggregateSectionMeta {
  return { status: 'empty' };
}

export function errorSection(
  message: string,
  retryable: boolean,
): AggregateSectionMeta {
  return { status: 'error', message, retryable };
}

export function aggregateResponse<TData, TSections extends AggregateSectionMap>(
  data: TData,
  sections: TSections,
): AggregateResponse<TData, TSections> {
  return {
    data,
    meta: {
      generatedAt: new Date().toISOString(),
      sections,
    },
  };
}

type RequiredSectionOptions<TData> = {
  required: true;
  load: () => Promise<TData>;
  empty?: (data: TData) => boolean;
};

type OptionalSectionOptions<TData> = {
  required?: false;
  load: () => Promise<TData>;
  fallback: TData;
  empty?: (data: TData) => boolean;
  retryable?: boolean;
};

export async function resolveSection<TData>(
  options: RequiredSectionOptions<TData> | OptionalSectionOptions<TData>,
): Promise<{ data: TData; meta: AggregateSectionMeta }> {
  try {
    const data = await options.load();
    return {
      data,
      meta: options.empty?.(data) ? emptySection() : okSection(),
    };
  } catch (error) {
    if (options.required) throw error;

    return {
      data: options.fallback,
      meta: errorSection(errorMessage(error), options.retryable ?? true),
    };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
