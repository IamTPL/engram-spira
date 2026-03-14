export interface TemplateField {
  id: string;
  name: string;
  fieldType: string;
  side: string;
  sortOrder: number;
  isRequired: boolean;
  config: { placeholder?: string; maxItems?: number } | null;
}

export interface CardField {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  side: string;
  value: unknown;
}

export interface CardItem {
  id: string;
  sortOrder: number;
  fields: CardField[];
}

export interface AiPreviewCard {
  front: string;
  back: string;
  ipa?: string;
  wordType?: string;
  examples?: string;
}
