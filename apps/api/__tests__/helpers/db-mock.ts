/**
 * Reusable mock for the Drizzle `db` module.
 *
 * Uses absolute path resolution to intercept DB imports from any location.
 *
 * Usage in test files:
 *   import { resetMocks, setMockReturn, setMockReturnSequence } from '../helpers/db-mock';
 *   beforeEach(() => resetMocks());
 *   setMockReturn([{ id: '1', name: 'Test' }]);
 */
import { mock } from 'bun:test';
import { resolve } from 'path';

// Chainable query builder mock
function createChainMock(returnValue: any[] = []) {
  const chain: any = {
    _returnValue: returnValue,
    select: mock(() => chain),
    from: mock(() => chain),
    where: mock(() => chain),
    innerJoin: mock(() => chain),
    leftJoin: mock(() => chain),
    groupBy: mock(() => chain),
    orderBy: mock(() => chain),
    limit: mock(() => Promise.resolve(chain._returnValue)),
    insert: mock(() => chain),
    values: mock(() => chain),
    returning: mock(() => Promise.resolve(chain._returnValue)),
    onConflictDoUpdate: mock(() => chain),
    update: mock(() => chain),
    set: mock(() => chain),
    delete: mock(() => chain),
    execute: mock(() => Promise.resolve(chain._returnValue)),
    transaction: mock((fn: Function) => fn(chain)),
  };

  // When awaited directly (no terminal .limit()/.returning()), resolve to returnValue
  chain.then = (resolve: Function) => resolve(chain._returnValue);

  return chain;
}

export let mockDbChain = createChainMock();

// Resolve the absolute path of the DB module
const DB_ABS_PATH = resolve(import.meta.dir, '../../src/db/index.ts');

function mockModuleDb() {
  const dbExport = { db: mockDbChain, pgClient: {} };
  
  // Mock with the absolute path
  mock.module(DB_ABS_PATH, () => dbExport);
  
  // Also mock common relative paths used by source files
  // (Bun resolves these relative to the importing file)
  mock.module('../../db', () => dbExport);
  mock.module('../../db/index', () => dbExport);
}

export function resetMocks() {
  mockDbChain = createChainMock();
  mockModuleDb();
}

export function setMockReturn(data: any[]) {
  mockDbChain._returnValue = data;
  return mockDbChain;
}

// Multiple sequential return values for tests that call db multiple times
let returnQueue: any[][] = [];
let callIndex = 0;

export function setMockReturnSequence(sequence: any[][]) {
  returnQueue = [...sequence];
  callIndex = 0;
  const getNext = () => {
    const result = returnQueue[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(result);
  };
  mockDbChain.limit = mock(() => getNext());
  mockDbChain.returning = mock(() => getNext());
  mockDbChain.execute = mock(() => getNext());
  mockDbChain.then = (resolve: Function) => {
    const result = returnQueue[callIndex] ?? [];
    callIndex++;
    return resolve(result);
  };
}

// Initialize on import
mockModuleDb();
