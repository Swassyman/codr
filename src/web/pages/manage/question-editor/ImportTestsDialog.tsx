import { useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync } from 'fflate';
import { FileArchive } from 'lucide-react';
import { pairTestFiles, parsePastedTests, type ImportedTest } from '../../../../shared/test-import';
import { cn } from '../../../lib/cn';
import { AutoTextarea } from '../../../components/form-bits';
import { Button, Checkbox, Dialog, ErrorNote, Tab, TabList, TabPanel, Tabs } from '../../../components/ui';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

async function readZip(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let total = 0;
  const entries = unzipSync(bytes, {
    filter: (f) => {
      total += f.originalSize;
      return total <= MAX_ARCHIVE_BYTES;
    },
  });
  if (total > MAX_ARCHIVE_BYTES) throw new Error('The archive unpacks to more than 256 MB. Split it into smaller archives.');
  const decoder = new TextDecoder();
  return pairTestFiles(Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, decoder.decode(data)])));
}

function Preview({ tests }: { tests: ImportedTest[] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-raised text-left text-xs text-ink-3">
          <tr>
            <th className="px-3 py-1.5 font-medium">#</th>
            <th className="px-3 py-1.5 font-medium">From</th>
            <th className="px-3 py-1.5 text-right font-medium">Input</th>
            <th className="px-3 py-1.5 text-right font-medium">Output</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t, i) => (
            <tr key={t.key + i} className="border-t border-line">
              <td className="px-3 py-1.5 tabular-nums text-ink-3">{i + 1}</td>
              <td className="px-3 py-1.5 font-mono text-xs">{t.key}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{t.input.length.toLocaleString()} chars</td>
              <td className={cn('px-3 py-1.5 text-right tabular-nums', !t.output && 'text-ink-3')}>{t.output ? `${t.output.length.toLocaleString()} chars` : 'empty'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportTestsDialog({
  initialFile,
  onClose,
  onImport,
}: {
  initialFile?: File;
  onClose: () => void;
  onImport: (tests: ImportedTest[], hidden: boolean) => Promise<void>;
}) {
  const [tab, setTab] = useState(initialFile ? 'zip' : 'zip');
  const [zip, setZip] = useState<{ name: string; tests: ImportedTest[]; unmatched: string[] } | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pastedTests = useMemo(() => parsePastedTests(pasted), [pasted]);

  const load = async (file: File) => {
    setZipError(null);
    setZip(null);
    if (!/\.zip$/i.test(file.name)) {
      setZipError('Choose a .zip file with input/output pairs such as 1.in and 1.out.');
      return;
    }
    try {
      const result = await readZip(file);
      setZip({ name: file.name, ...result });
      if (result.tests.length === 0) setZipError('No input/output pairs were found. Name files like 1.in and 1.out (or .ans).');
    } catch (err) {
      setZipError(err instanceof Error ? err.message : 'Could not read the archive.');
    }
  };

  useEffect(() => {
    if (initialFile) void load(initialFile);
  }, [initialFile]);

  const candidates = tab === 'zip' ? (zip?.tests ?? []) : pastedTests;
  const submit = async () => {
    setBusy(true);
    try {
      await onImport(candidates, hidden);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add several tests" wide>
      <Tabs value={tab} onValueChange={setTab}>
        <TabList className="mb-4">
          <Tab value="zip">Zip archive</Tab>
          <Tab value="paste">Paste text</Tab>
        </TabList>
        <TabPanel value="zip" className="flex flex-col gap-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) void load(file);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-6 py-8 text-center',
              dragOver && 'border-accent bg-accent-soft',
            )}
          >
            <FileArchive className="size-6 text-ink-3" />
            <p className="text-sm">
              Drop a .zip here or{' '}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => fileRef.current?.click()}>
                choose a file
              </button>
            </p>
            <p className="text-xs text-ink-3">Pairs are matched by name: 1.in with 1.out or 1.ans, input/01.txt with output/01.txt, 01 with 01.a.</p>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void load(file);
                e.target.value = '';
              }}
            />
          </div>
          {zipError && <ErrorNote>{zipError}</ErrorNote>}
          {zip && zip.tests.length > 0 && (
            <>
              <p className="text-sm text-ink-2">
                Found {zip.tests.length} pair{zip.tests.length === 1 ? '' : 's'} in <span className="font-mono">{zip.name}</span>.
              </p>
              <Preview tests={zip.tests} />
            </>
          )}
          {zip && zip.unmatched.length > 0 && (
            <p className="text-xs text-ink-3">
              Skipped {zip.unmatched.length} file{zip.unmatched.length === 1 ? '' : 's'} without a partner: {zip.unmatched.slice(0, 8).join(', ')}
              {zip.unmatched.length > 8 ? '…' : ''}
            </p>
          )}
        </TabPanel>
        <TabPanel value="paste" className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            Separate tests with a line of <code className="rounded bg-raised px-1 font-mono">===</code> and each input from its output with a line of{' '}
            <code className="rounded bg-raised px-1 font-mono">---</code>. Leave the output out to generate it later.
          </p>
          <AutoTextarea
            mono
            aria-label="Tests to paste"
            minRows={10}
            maxRows={22}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={'3\n1 2 3\n---\n6\n===\n2\n10 -4\n---\n6'}
          />
          {pastedTests.length > 0 && <Preview tests={pastedTests} />}
        </TabPanel>
      </Tabs>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Checkbox checked={hidden} onCheckedChange={setHidden} label="Mark imported tests as hidden" />
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={candidates.length === 0} loading={busy} onClick={() => void submit()}>
            Add {candidates.length || ''} test{candidates.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
