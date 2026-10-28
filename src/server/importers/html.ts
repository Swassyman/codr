// A small HTML-to-markdown converter for well-structured statement pages.
// It handles the tags problem sites actually use and drops everything else;
// the author reviews the result in the form before publishing.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', le: '≤', ge: '≥', times: '×', middot: '·' };

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ''));

export function htmlToMarkdown(html: string, baseUrl: string) {
  let s = html;
  // Math first, so its contents are not touched by the other rules.
  s = s.replace(/<span class="math math-display">([\s\S]*?)<\/span>/g, (_, m: string) => `\n\n$$${stripTags(m).trim()}$$\n\n`);
  s = s.replace(/<span class="math math-inline">([\s\S]*?)<\/span>/g, (_, m: string) => `$${stripTags(m).trim()}$`);
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_, m: string) => `\n\n\`\`\`\n${stripTags(m).replace(/\n$/, '')}\n\`\`\`\n\n`);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/g, (_, m: string) => `\`${stripTags(m)}\``);
  s = s.replace(/<(b|strong)>([\s\S]*?)<\/\1>/g, '**$2**');
  s = s.replace(/<(i|em)>([\s\S]*?)<\/\1>/g, '*$2*');
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, text: string) => `[${stripTags(text)}](${new URL(decodeEntities(href), baseUrl).toString()})`);
  s = s.replace(/<img [^>]*alt="([^"]*)"[^>]*>/g, (_, alt: string) => `*(image${alt ? `: ${alt}` : ''} omitted)*`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_, m: string) => `\n- ${m.trim()}`);
  s = s.replace(/<\/?(ul|ol)[^>]*>/g, '\n');
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, '\n\n$1\n\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
