import { useMemo, useState } from 'react';
import { splitStatement } from '../../../../shared/statement-split';
import { AutoTextarea } from '../../../components/form-bits';
import { Button, Dialog } from '../../../components/ui';
import type { QuestionForm } from './QuestionEditorPage';

/**
 * Paste a whole statement copied from a problem page; it is split into the
 * form's fields (statement, input, output, constraints, examples, notes).
 */
export function PasteStatementDialog({ onApply, onClose }: { onApply: (patch: Partial<QuestionForm>) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const split = useMemo(() => splitStatement(text), [text]);
  const found = [
    split.statement && 'statement',
    split.inputFormat && 'input',
    split.outputFormat && 'output',
    split.constraints.length && `${split.constraints.length} constraint${split.constraints.length === 1 ? '' : 's'}`,
    split.samples.length && `${split.samples.length} example${split.samples.length === 1 ? '' : 's'}`,
    split.notes && 'notes',
  ].filter(Boolean) as string[];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Paste a statement" description="Copy the whole problem from its page. Headings like Input, Output, Constraints, Examples and Note are recognised." wide>
      <AutoTextarea aria-label="Statement text" minRows={12} maxRows={24} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Problem text…\n\nInput\n…\n\nOutput\n…\n\nExamples\nInput\n…\nOutput\n…'} />
      <p className="mt-2 text-sm text-ink-2">{text.trim() ? (found.length ? `Found: ${found.join(', ')}.` : 'No sections recognised; everything goes into the statement.') : 'Nothing pasted yet.'}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!text.trim()}
          onClick={() => {
            onApply({
              statement: split.statement,
              inputFormat: split.inputFormat,
              outputFormat: split.outputFormat,
              constraints: split.constraints,
              samples: split.samples.map((s) => ({ ...s, explanation: '' })),
              notes: split.notes,
            });
            onClose();
          }}
        >
          Fill the form
        </Button>
      </div>
    </Dialog>
  );
}
