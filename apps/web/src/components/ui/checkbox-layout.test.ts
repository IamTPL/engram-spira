import { describe, expect, test } from 'bun:test';

import {
  getCheckboxLabelClass,
  getCheckboxRootClass,
} from './checkbox-layout';

describe('getCheckboxRootClass', () => {
  test('gives the visually hidden input a local containing block', () => {
    const classNames = new Set(getCheckboxRootClass().split(/\s+/));

    expect(classNames.has('relative')).toBe(true);
  });

  test('makes the associated label a 44px pointer target', () => {
    const classNames = new Set(getCheckboxLabelClass().split(/\s+/));

    expect(classNames.has('min-h-11')).toBe(true);
    expect(classNames.has('min-w-11')).toBe(true);
    expect(classNames.has('cursor-pointer')).toBe(true);
  });
});
