import { describe, it, expect } from 'vitest';
import { parseArgs } from '../parse-args.js';

describe('parseArgs', () => {
  it('returns projectName from first positional arg', () => {
    const result = parseArgs(['node', 'create-junando-app', 'my-app']);
    expect(result.projectName).toBe('my-app');
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
    expect(result.unknownFlag).toBeUndefined();
  });

  it('returns undefined projectName when no args given', () => {
    const result = parseArgs(['node', 'create-junando-app']);
    expect(result.projectName).toBeUndefined();
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
  });

  it('returns help=true for --help flag', () => {
    const result = parseArgs(['node', 'create-junando-app', '--help']);
    expect(result.help).toBe(true);
    expect(result.projectName).toBeUndefined();
  });

  it('returns version=true for --version flag', () => {
    const result = parseArgs(['node', 'create-junando-app', '--version']);
    expect(result.version).toBe(true);
  });

  it('returns unknownFlag for unrecognized flags', () => {
    const result = parseArgs(['node', 'create-junando-app', 'my-app', '--foo']);
    expect(result.unknownFlag).toBe('--foo');
  });

  it('uses first positional arg when multiple positional args provided', () => {
    const result = parseArgs(['node', 'create-junando-app', 'first', 'second']);
    expect(result.projectName).toBe('first');
  });
});
