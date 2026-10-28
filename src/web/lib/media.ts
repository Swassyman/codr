import { useEffect, useState } from 'react';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    mq.addEventListener('change', update);
    update();
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';
