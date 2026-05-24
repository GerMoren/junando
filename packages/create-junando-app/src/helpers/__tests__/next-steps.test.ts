import { describe, it, expect } from 'vitest';
import { buildNextStepsMessage } from '../next-steps.js';

describe('buildNextStepsMessage', () => {
  it('contains the project name', () => {
    const msg = buildNextStepsMessage('my-cool-app');
    expect(msg).toContain('my-cool-app');
  });

  it('contains cd <projectName>', () => {
    const msg = buildNextStepsMessage('my-cool-app');
    expect(msg).toContain('cd my-cool-app');
  });

  it('contains pnpm dev', () => {
    const msg = buildNextStepsMessage('my-cool-app');
    expect(msg).toContain('pnpm dev');
  });
});
