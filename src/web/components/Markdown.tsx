import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from '../lib/cn';

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [[rehypeKatex, { throwOnError: false, strict: false }]] as never;

/**
 * Markdown with $inline$ and $$display$$ KaTeX math. Raw HTML in the source is
 * not rendered (react-markdown escapes it), so statements cannot inject markup.
 */
export const Markdown = memo(function Markdown({ text, className, inline }: { text: string; className?: string; inline?: boolean }) {
  if (inline) {
    return (
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={{ p: ({ children }) => <>{children}</> }}>
        {text}
      </ReactMarkdown>
    );
  }
  return (
    <div className={cn('statement', className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
