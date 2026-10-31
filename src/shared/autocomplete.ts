import type { AutocompleteRule } from './types';

// Editor autocompletion is decided by the server: a contest's rule either
// forces it off or on, or leaves it to the participant. Practice has no rule
// and behaves like user_choice. The client only applies what it is sent.

export interface AutocompletePolicy {
  rule: AutocompleteRule;
  /** The rule's decision; null when the participant chooses. */
  forced: boolean | null;
}

/** The policy for a contest's rule, or for practice (no rule). */
export function autocompletePolicy(rule: AutocompleteRule | null): AutocompletePolicy {
  const effective = rule ?? 'user_choice';
  return { rule: effective, forced: effective === 'off' ? false : effective === 'on' ? true : null };
}

/** Whether completion is on: a forcing rule always wins; otherwise the participant's choice, off by default. */
export function autocompleteEnabled(policy: AutocompletePolicy, preference: boolean | null): boolean {
  return policy.forced ?? preference ?? false;
}
