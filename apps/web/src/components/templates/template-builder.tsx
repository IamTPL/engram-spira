import { type Component, Show, For, Index, createSignal, createMemo } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api, getApiError } from '@/api/client';
import { queryClient } from '@/lib/query-client';
import { currentUser } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/stores/toast.store';
import {
  Layers,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Loader2,
  Lock,
} from 'lucide-solid';

interface TemplateField {
  name: string;
  fieldType: string;
  side: 'front' | 'back';
  isRequired: boolean;
}

interface UserTemplate {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  fields: { id: string; name: string; fieldType: string; side: string; sortOrder: number; isRequired: boolean }[];
}

const FIELD_TYPES = ['text', 'richtext', 'image', 'audio', 'json_array'] as const;

const TemplateBuilder: Component = () => {
  const [showForm, setShowForm] = createSignal(false);
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [fields, setFields] = createSignal<TemplateField[]>([
    { name: 'Front', fieldType: 'text', side: 'front', isRequired: true },
    { name: 'Back', fieldType: 'text', side: 'back', isRequired: true },
  ]);
  const [saving, setSaving] = createSignal(false);
  const [expanded, setExpanded] = createSignal(true);

  const templatesQuery = createQuery(() => ({
    queryKey: ['card-templates'],
    queryFn: async () => {
      const { data } = await (api['card-templates'] as any).get();
      return (Array.isArray(data) ? data : []) as UserTemplate[];
    },
    enabled: !!currentUser()?.id,
    staleTime: 60_000,
  }));

  const templates = () => templatesQuery.data ?? [];
  const userTemplates = createMemo(() => templates().filter((t) => !t.isSystem));
  const systemTemplates = createMemo(() => templates().filter((t) => t.isSystem));

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { name: '', fieldType: 'text', side: 'back', isRequired: false },
    ]);
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const updateField = (index: number, key: keyof TemplateField, value: string | boolean) => {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)),
    );
  };

  const hasFront = createMemo(() => fields().some((f) => f.side === 'front'));
  const hasBack = createMemo(() => fields().some((f) => f.side === 'back'));
  const canSave = createMemo(() => name().trim() && hasFront() && hasBack() && fields().every((f) => f.name.trim()));

  const handleSave = async () => {
    if (!canSave()) return;
    setSaving(true);
    try {
      const { error } = await (api['card-templates'] as any).post({
        name: name().trim(),
        description: description().trim(),
        fields: fields().map((f, i) => ({
          name: f.name.trim(),
          fieldType: f.fieldType,
          side: f.side,
          sortOrder: i,
          isRequired: f.isRequired,
        })),
      });
      if (error) throw new Error(getApiError(error));
      toast.success('Template created!');
      queryClient.invalidateQueries({ queryKey: ['card-templates'] });
      resetForm();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    try {
      const { error } = await (api['card-templates'] as any)[templateId].delete();
      if (error) throw new Error(getApiError(error));
      toast.success('Template deleted');
      queryClient.invalidateQueries({ queryKey: ['card-templates'] });
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete template');
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setName('');
    setDescription('');
    setFields([
      { name: 'Front', fieldType: 'text', side: 'front', isRequired: true },
      { name: 'Back', fieldType: 'text', side: 'back', isRequired: true },
    ]);
  };

  return (
    <div class="rounded-xl border bg-card">
      {/* Header */}
      <button
        class="flex items-center justify-between w-full px-5 py-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div class="flex items-center gap-2">
          <Layers class="h-4 w-4 text-muted-foreground" />
          <h3 class="text-sm font-semibold">Card Templates</h3>
          <Badge variant="muted" class="text-[10px]">
            {templates().length}
          </Badge>
        </div>
        <Show when={expanded()} fallback={<ChevronDown class="h-4 w-4 text-muted-foreground" />}>
          <ChevronUp class="h-4 w-4 text-muted-foreground" />
        </Show>
      </button>

      <Show when={expanded()}>
        <div class="px-5 pb-5 space-y-4 border-t pt-4">
          {/* Existing templates */}
          <div class="space-y-2">
            <For each={systemTemplates()}>
              {(tmpl) => (
                <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 text-sm">
                  <div class="flex items-center gap-2">
                    <Lock class="h-3 w-3 text-muted-foreground" />
                    <span class="font-medium">{tmpl.name}</span>
                    <Badge variant="muted" class="text-[10px]">System</Badge>
                  </div>
                  <span class="text-xs text-muted-foreground">
                    {tmpl.fields?.length ?? 0} fields
                  </span>
                </div>
              )}
            </For>
            <For each={userTemplates()}>
              {(tmpl) => (
                <div class="flex items-center justify-between px-3 py-2 rounded-lg border text-sm">
                  <div class="flex items-center gap-2">
                    <Layers class="h-3 w-3 text-palette-5" />
                    <span class="font-medium">{tmpl.name}</span>
                    <Badge variant="outline" class="text-[10px]">Custom</Badge>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-muted-foreground">
                      {tmpl.fields?.length ?? 0} fields
                    </span>
                    <button
                      class="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => handleDelete(tmpl.id)}
                      title="Delete template"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* Create new template */}
          <Show
            when={showForm()}
            fallback={
              <Button variant="outline" size="sm" onClick={() => setShowForm(true)} class="w-full">
                <Plus class="h-3.5 w-3.5 mr-1.5" />
                New Template
              </Button>
            }
          >
            <div class="rounded-lg border p-4 space-y-3">
              <Input
                placeholder="Template name"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class="h-9"
              />
              <Input
                placeholder="Description (optional)"
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                class="h-9"
              />

              {/* Fields */}
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium text-muted-foreground">Fields</span>
                  <Button variant="ghost" size="sm" onClick={addField} class="h-7 text-xs">
                    <Plus class="h-3 w-3 mr-1" /> Add Field
                  </Button>
                </div>
                <Index each={fields()}>
                  {(field, index) => (
                    <div class="flex items-center gap-2">
                      <GripVertical class="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                      <Input
                        placeholder="Field name"
                        value={field().name}
                        onInput={(e) => updateField(index, 'name', e.currentTarget.value)}
                        class="h-8 text-xs flex-1"
                      />
                      <select
                        class="h-8 rounded-md border bg-transparent px-2 text-xs"
                        value={field().fieldType}
                        onChange={(e) => updateField(index, 'fieldType', e.currentTarget.value)}
                      >
                        <For each={FIELD_TYPES}>
                          {(type) => <option value={type}>{type}</option>}
                        </For>
                      </select>
                      <select
                        class="h-8 rounded-md border bg-transparent px-2 text-xs w-20"
                        value={field().side}
                        onChange={(e) => updateField(index, 'side', e.currentTarget.value)}
                      >
                        <option value="front">Front</option>
                        <option value="back">Back</option>
                      </select>
                      <Show when={fields().length > 2}>
                        <button
                          class="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          onClick={() => removeField(index)}
                        >
                          <Trash2 class="h-3.5 w-3.5" />
                        </button>
                      </Show>
                    </div>
                  )}
                </Index>
              </div>

              {/* Validation hints */}
              <Show when={!hasFront() || !hasBack()}>
                <p class="text-xs text-destructive">
                  Template must have at least one front and one back field
                </p>
              </Show>

              {/* Actions */}
              <div class="flex items-center gap-2 justify-end pt-2">
                <Button variant="ghost" size="sm" onClick={resetForm}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={!canSave() || saving()} loading={saving()}>
                  Create Template
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default TemplateBuilder;
