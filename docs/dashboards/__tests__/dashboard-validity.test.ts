import { describe, it, expect } from 'vitest';
import dashboard from '../junando-slis.json';

describe('junando-slis.json dashboard validity', () => {
  it('has the correct uid', () => {
    expect((dashboard as any).uid).toBe('junando-slis');
  });

  it('has the correct title', () => {
    expect((dashboard as any).title).toBe('Junando SLIs');
  });

  it('has exactly 4 panels', () => {
    expect((dashboard as any).panels).toHaveLength(4);
  });

  it('every panel uses datasource uid prometheus-local', () => {
    const panels: any[] = (dashboard as any).panels;
    for (const panel of panels) {
      expect(panel.datasource?.uid).toBe('prometheus-local');
    }
  });

  it('has correct refresh interval', () => {
    expect((dashboard as any).refresh).toBe('30s');
  });
});
