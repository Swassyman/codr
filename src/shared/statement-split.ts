import type { Sample } from './types';

/**
 * Splits a plain-text problem statement into the structured question form,
 * by recognising headings on their own line (Codeforces, AtCoder, CodeChef,
 * HackerRank and dataset styles). Used by the importer and by the
 * "paste a statement" helper; the author always reviews the result.
 */
export interface SplitStatement {
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string[];
  samples: Sample[];
  notes: string;
}

type Kind = 'input' | 'output' | 'constraints' | 'examples' | 'sampleIn' | 'sampleOut' | 'notes';

function headingKind(line: string): { kind: Kind } | null {
  const t = line
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/[:.]$/, '')
    .trim()
    .toLowerCase();
  if (!t || t.length > 40) return null;
  if (/^(input|input format|input specification|the input)$/.test(t)) return { kind: 'input' };
  if (/^(output|output format|output specification|the output)$/.test(t)) return { kind: 'output' };
  if (/^(constraints?|limits)$/.test(t)) return { kind: 'constraints' };
  if (/^(examples?|samples?|sample tests?|example tests?)$/.test(t)) return { kind: 'examples' };
  if (/^(sample|example) input\s*\d*$/.test(t)) return { kind: 'sampleIn' };
  if (/^(sample|example) output\s*\d*$/.test(t)) return { kind: 'sampleOut' };
  if (/^(notes?|explanations?|hint|hints)( for (the )?(sample|example)s?)?$/.test(t)) return { kind: 'notes' };
  return null;
}

const tidy = (s: string) =>
  s
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\n/, '')
    .trimEnd();

/** Example blocks keep inner spacing but lose surrounding blank lines; end with one newline. */
const block = (lines: string[]) => {
  const text = lines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return text ? `${text}\n` : '';
};

export function splitStatement(raw: string): SplitStatement {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const result: SplitStatement = { statement: '', inputFormat: '', outputFormat: '', constraints: [], samples: [], notes: '' };
  const parts: { kind: Kind | 'statement'; lines: string[] }[] = [{ kind: 'statement', lines: [] }];
  let inExamples = false;

  for (const line of lines) {
    const h = headingKind(line);
    if (h) {
      let kind = h.kind;
      // Inside an Examples section, bare "Input"/"Output" headings mark sample parts.
      if (inExamples && kind === 'input') kind = 'sampleIn';
      else if (inExamples && kind === 'output') kind = 'sampleOut';
      if (kind === 'examples') inExamples = true;
      else if (kind === 'notes' || kind === 'constraints') inExamples = false;
      else if (kind === 'sampleIn' || kind === 'sampleOut') inExamples = true;
      parts.push({ kind, lines: [] });
      continue;
    }
    parts.at(-1)!.lines.push(line);
  }

  let pendingInput: string | null = null;
  for (const part of parts) {
    const text = tidy(part.lines.join('\n'));
    switch (part.kind) {
      case 'statement':
        result.statement = text;
        break;
      case 'input':
        result.inputFormat = result.inputFormat ? `${result.inputFormat}\n\n${text}` : text;
        break;
      case 'output':
        result.outputFormat = result.outputFormat ? `${result.outputFormat}\n\n${text}` : text;
        break;
      case 'constraints':
        result.constraints.push(
          ...part.lines
            .map((l) => l.replace(/^\s*([-*•·]|\d+[.)])\s+/, '').trim())
            .filter(Boolean),
        );
        break;
      case 'examples':
        if (text) result.notes = result.notes ? `${result.notes}\n\n${text}` : text;
        break;
      case 'sampleIn':
        if (pendingInput != null) result.samples.push({ input: pendingInput, output: '' });
        pendingInput = block(part.lines);
        break;
      case 'sampleOut':
        result.samples.push({ input: pendingInput ?? '', output: block(part.lines) });
        pendingInput = null;
        break;
      case 'notes':
        result.notes = result.notes ? `${result.notes}\n\n${text}` : text;
        break;
    }
  }
  if (pendingInput != null) result.samples.push({ input: pendingInput, output: '' });
  return result;
}
