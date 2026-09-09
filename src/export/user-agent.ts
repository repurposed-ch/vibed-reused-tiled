export type ArClientProfile = 'ios' | 'android' | 'other';

/** Detect preferred AR / export profile from the current user agent. */
export function detectClientArProfile(
  ua = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
): ArClientProfile {
  const lower = ua.toLowerCase();
  const isIpadOsDesktopUa =
    lower.includes('macintosh') && maxTouchPoints > 1;
  if (/iphone|ipad|ipod/.test(lower) || isIpadOsDesktopUa) return 'ios';
  if (lower.includes('android')) return 'android';
  return 'other';
}

/** Scene Viewer intent for Android AR (HTTPS GLB URL preferred; blob may be limited). */
export function androidSceneViewerUrl(glbUrl: string, title = 'Tiling'): string {
  const params = new URLSearchParams({
    file: glbUrl,
    mode: 'ar_preferred',
    title,
  });
  return `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(glbUrl)};end;`;
}
