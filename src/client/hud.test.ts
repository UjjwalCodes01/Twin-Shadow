import { describe, expect, it } from 'vitest';
import { submitText } from './hud';

describe('submitText', () => {
  it('is plain until the sculpture is solved', () => {
    expect(submitText(false, false, 0)).toBe('Submit');
    expect(submitText(false, false, 12)).toBe('Submit');
  });

  it('adds the block count once solved, without the word, so it stays on one line', () => {
    expect(submitText(true, false, 6)).toBe('Submit 6');
    expect(submitText(true, false, 24)).toBe('Submit 24');
    expect(submitText(true, false, 24).length).toBeLessThanOrEqual(10);
  });

  it('says so while the request is in flight', () => {
    expect(submitText(true, true, 24)).toBe('Submitting…');
  });
});
