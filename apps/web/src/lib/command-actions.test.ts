import { describe, expect, test } from 'bun:test';
import {
  commandActionIds,
  createCommandActionRunner,
} from './command-actions';
import type { CommandActionContext } from '@/components/app-shell/types';

const context: CommandActionContext = {
  route: '/',
  currentUserId: 'user-1',
};

describe('command actions', () => {
  test('exports the initial command action ids', () => {
    expect(commandActionIds).toEqual([
      'navigate.home',
      'navigate.study',
      'navigate.library',
      'navigate.create',
      'navigate.insights',
      'study.startQueue',
      'folder.create',
      'deck.create',
      'deck.delete.confirm',
      'deck.delete',
      'card.createManual',
      'create.openAiPaste',
      'create.importCsv',
      'insight.studyAtRisk',
      'settings.open',
    ]);
  });

  test('builds canonical study routes for navigation and queue actions', async () => {
    const runner = createCommandActionRunner();

    await expect(
      runner.run(
        {
          id: 'navigate.study',
          label: 'Study deck',
          params: { mode: 'deck', deckId: 'deck-1' },
        },
        context,
      ),
    ).resolves.toEqual({
      status: 'success',
      navigateTo: '/study?mode=deck&deckId=deck-1',
    });

    await expect(
      runner.run(
        {
          id: 'study.startQueue',
          label: 'Study at risk',
          params: { mode: 'at-risk', deckId: 'deck-1' },
        },
        context,
      ),
    ).resolves.toEqual({
      status: 'success',
      navigateTo: '/study?mode=at-risk&deckId=deck-1',
      invalidate: ['study-queue', 'command-center'],
    });
  });

  test('maps deck.create templateId to the existing cardTemplateId payload', async () => {
    const calls: unknown[] = [];
    const client = {
      decks: {
        'by-folder': ({ folderId }: { folderId: string }) => ({
          post: async (body: unknown) => {
            calls.push({ folderId, body });
            return { data: { id: 'deck-1' }, error: null };
          },
        }),
      },
    };
    const runner = createCommandActionRunner({ client: client as any });

    await expect(
      runner.run(
        {
          id: 'deck.create',
          label: 'Create deck',
          params: {
            folderId: 'folder-1',
            name: ' Biology ',
            templateId: 'template-1',
          },
        },
        context,
      ),
    ).resolves.toEqual({
      status: 'success',
      message: 'Deck created',
      navigateTo: '/deck/deck-1',
      invalidate: ['library-explorer', 'command-center'],
    });
    expect(calls).toEqual([
      {
        folderId: 'folder-1',
        body: { name: 'Biology', cardTemplateId: 'template-1' },
      },
    ]);
  });

  test('creates a folder in the class carried by the action params', async () => {
    const calls: unknown[] = [];
    const client = {
      folders: {
        'by-class': ({ classId }: { classId: string }) => ({
          post: async (body: unknown) => {
            calls.push({ classId, body });
            return { data: { id: 'folder-1' }, error: null };
          },
        }),
      },
    };
    const runner = createCommandActionRunner({ client: client as any });

    await expect(
      runner.run(
        {
          id: 'folder.create',
          label: 'Create folder',
          params: { classId: 'class-1', name: ' Family ' },
        },
        context,
      ),
    ).resolves.toEqual({
      status: 'success',
      message: 'Folder created',
      navigateTo: '/folder/folder-1',
      invalidate: ['library-explorer', 'command-center'],
    });
    expect(calls).toEqual([
      { classId: 'class-1', body: { name: 'Family' } },
    ]);
  });

  test('falls back to the selected class when folder.create omits classId', async () => {
    const calls: unknown[] = [];
    const client = {
      folders: {
        'by-class': ({ classId }: { classId: string }) => ({
          post: async (body: unknown) => {
            calls.push({ classId, body });
            return { data: { id: 'folder-2' }, error: null };
          },
        }),
      },
    };
    const runner = createCommandActionRunner({ client: client as any });

    await expect(
      runner.run(
        { id: 'folder.create', label: 'Create folder', params: { name: 'Family' } },
        { ...context, selectedClassId: 'class-9' },
      ),
    ).resolves.toEqual({
      status: 'success',
      message: 'Folder created',
      navigateTo: '/folder/folder-2',
      invalidate: ['library-explorer', 'command-center'],
    });
    expect(calls).toEqual([{ classId: 'class-9', body: { name: 'Family' } }]);
  });

  test('rejects folder.create without a resolvable class', async () => {
    const runner = createCommandActionRunner();

    await expect(
      runner.run(
        { id: 'folder.create', label: 'Create folder', params: { name: 'Family' } },
        context,
      ),
    ).resolves.toEqual({
      status: 'error',
      message: 'classId is required',
      fieldErrors: { classId: 'Required' },
    });
  });

  test('returns validation errors before running invalid actions', async () => {
    const runner = createCommandActionRunner();

    await expect(
      runner.run(
        {
          id: 'deck.create',
          label: 'Create deck',
          params: { folderId: 'folder-1', templateId: 'template-1' },
        },
        context,
      ),
    ).resolves.toEqual({
      status: 'error',
      message: 'name is required',
      fieldErrors: { name: 'Required' },
    });
  });

  test('returns confirmation result for destructive deck deletion', async () => {
    const runner = createCommandActionRunner();

    await expect(
      runner.run(
        {
          id: 'deck.delete.confirm',
          label: 'Delete deck',
          params: { deckId: 'deck-1' },
        },
        context,
      ),
    ).resolves.toEqual({
      status: 'confirm',
      title: 'Delete deck?',
      description: 'This removes the deck and its cards.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirmAction: {
        id: 'deck.delete',
        label: 'Delete deck',
        params: { deckId: 'deck-1' },
      },
    });
  });
});
