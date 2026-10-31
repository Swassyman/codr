import { describe, expect, it } from 'vitest';
import { autocompleteEnabled, autocompletePolicy } from '../../src/shared/autocomplete';

describe('autocomplete rule resolution', () => {
  it('maps each contest rule to a policy', () => {
    expect(autocompletePolicy('off')).toEqual({ rule: 'off', forced: false });
    expect(autocompletePolicy('on')).toEqual({ rule: 'on', forced: true });
    expect(autocompletePolicy('user_choice')).toEqual({ rule: 'user_choice', forced: null });
  });

  it('treats practice (no contest rule) as the participant choosing', () => {
    expect(autocompletePolicy(null)).toEqual({ rule: 'user_choice', forced: null });
  });

  it('never lets a preference turn completion on when the rule is off, or off when it is on', () => {
    for (const preference of [true, false, null]) {
      expect(autocompleteEnabled(autocompletePolicy('off'), preference)).toBe(false);
      expect(autocompleteEnabled(autocompletePolicy('on'), preference)).toBe(true);
    }
  });

  it('follows the preference when the participant chooses, off by default', () => {
    const policy = autocompletePolicy('user_choice');
    expect(autocompleteEnabled(policy, true)).toBe(true);
    expect(autocompleteEnabled(policy, false)).toBe(false);
    expect(autocompleteEnabled(policy, null)).toBe(false);
    expect(autocompleteEnabled(autocompletePolicy(null), null)).toBe(false);
  });
});
