import type { ContestLobbyDTO } from '../../../shared/api';
import { formatWhen } from '../../lib/format';
import { timingSentence } from '../../lib/contest';

/** Plain-language rules, generated from the contest's settings. */
export function ContestRules({ contest, now }: { contest: ContestLobbyDTO; now: number }) {
  const rules: { key: string; text: string; emphasis?: boolean }[] = [
    { key: 'timing', text: timingSentence(contest, formatWhen(contest.endsAt, now)) },
  ];
  if (contest.viewOnce) {
    rules.push({ key: 'view-once', emphasis: true, text: 'You can open each question once. Moving on to another question locks the one you leave, even after a refresh or on another device. Submit before you move on.' });
  }
  if (contest.sequential) rules.push({ key: 'sequential', text: 'Questions open in order: you cannot skip ahead.' });
  if (contest.maxSubmissionsPerQuestion) rules.push({ key: 'subs', text: `You can submit each question up to ${contest.maxSubmissionsPerQuestion} times.` });
  if (contest.maxRunsPerMinute) rules.push({ key: 'runs', text: `You can run your code up to ${contest.maxRunsPerMinute} times a minute.` });
  rules.push({
    key: 'scoring',
    text:
      contest.scoring === 'all_or_nothing'
        ? 'A question scores only when every test passes.'
        : 'You earn partial points for the tests you pass.',
  });
  if (contest.penaltyMinutes != null) {
    rules.push({ key: 'penalty', text: `Ties are broken by time taken, plus ${contest.penaltyMinutes} minutes for each rejected attempt before your best one.` });
  }
  rules.push({
    key: 'reveal',
    text:
      contest.revealHidden === 'after'
        ? 'Results on hidden tests, and your score, are shown after the contest ends for you.'
        : contest.verdictDetail === 'summary'
          ? 'After each submission you see how many tests passed.'
          : 'After each submission you see the result of every test.',
  });
  if (contest.recordIntegrity) {
    rules.push({ key: 'integrity', emphasis: true, text: 'This contest records when you switch away from its tab and when you paste into the editor. The organizer can see these records.' });
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {rules.map((r) => (
        <li key={r.key} className="flex gap-3 text-[15px] leading-relaxed">
          <span aria-hidden className={r.emphasis ? 'mt-2.5 size-1.5 shrink-0 rounded-full bg-accent' : 'mt-2.5 size-1.5 shrink-0 rounded-full bg-line-strong'} />
          <span className={r.emphasis ? 'text-ink' : 'text-ink-2'}>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
