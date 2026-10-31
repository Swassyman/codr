import { useCallback, useEffect, useSyncExternalStore } from 'react';

// Fullscreen for the solve pages. The whole document goes fullscreen rather
// than the workspace element: dialogs (time up, leaving a view-once question)
// and toasts render in portals on <body>, which an element in fullscreen
// would hide. The workspace already fills the viewport, so nothing else
// differs. Leaving a solve page leaves fullscreen; switching questions doesn't.

const subscribe = (listener: () => void) => {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
};
const isFullscreen = () => document.fullscreenElement != null;

export function useFullscreen() {
  // Follows fullscreenchange, so leaving with Esc (or the browser's own UI) updates the toggle.
  const active = useSyncExternalStore(subscribe, isFullscreen, () => false);
  const supported = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  const toggle = useCallback(() => {
    // Rejections (no user gesture, blocked by a permissions policy) leave the state as it was.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
  }, []);
  return { active, supported, toggle };
}

/** For solve pages: leave fullscreen when the page goes away (not when the question changes). */
export function useLeaveFullscreenOnUnmount() {
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );
}
