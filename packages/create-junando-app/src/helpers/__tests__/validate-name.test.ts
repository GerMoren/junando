import { describe, it, expect } from 'vitest';
import { isValidProjectName } from '../validate-name.js';

describe('isValidProjectName', () => {
  it('accepts simple names', () => {
    expect(isValidProjectName('my-app')).toBe(true);
    expect(isValidProjectName('myapp')).toBe(true);
    expect(isValidProjectName('my_app')).toBe(true);
    expect(isValidProjectName('my.app')).toBe(true);
    expect(isValidProjectName('app123')).toBe(true);
    expect(isValidProjectName('123app')).toBe(true);
  });

  it('rejects names with path separators', () => {
    expect(isValidProjectName('/tmp/foo')).toBe(false);
    expect(isValidProjectName('foo/bar')).toBe(false);
    expect(isValidProjectName('./foo')).toBe(false);
  });

  it('rejects names starting with non-alphanumeric', () => {
    expect(isValidProjectName('-foo')).toBe(false);
    expect(isValidProjectName('.foo')).toBe(false);
    expect(isValidProjectName('_foo')).toBe(false);
  });

  it('rejects empty and whitespace', () => {
    expect(isValidProjectName('')).toBe(false);
    expect(isValidProjectName(' ')).toBe(false);
    expect(isValidProjectName('foo bar')).toBe(false);
  });
});
