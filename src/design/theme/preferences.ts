/**
 * Theme and density preferences.
 *
 * Both live in cookies rather than localStorage for one reason: the server needs
 * to read them. `cookies()` is available in a Server Component, so `<html>` can
 * carry the correct `data-theme` and `data-density` in the SSR response and the
 * correct theme is present in the very first paint. localStorage cannot be read
 * on the server, which means either a flash of the wrong theme or a blocking
 * script on every page.
 *
 * `system` is the one value the server cannot resolve, because it depends on the
 * visitor's OS. The server emits `data-theme="light"` as the deterministic
 * baseline and `THEME_BOOTSTRAP_SCRIPT` corrects it before paint; see
 * docs/decisions.md ADR-001.
 */

export const THEME_COOKIE = 'careos-theme';
export const DENSITY_COOKIE = 'careos-density';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

/** The concrete theme actually applied to the document. */
export type ResolvedTheme = 'light' | 'dark';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
export const DEFAULT_DENSITY: Density = 'comfortable';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function isDensity(value: unknown): value is Density {
  return typeof value === 'string' && (DENSITIES as readonly string[]).includes(value);
}

/**
 * Runs before paint to resolve `system` and to pick up a preference that changed
 * in another tab. Deliberately tiny and dependency-free: it is inlined into the
 * document head, so it cannot wait for the bundle.
 *
 * Density is deliberately absent here — the server always knows it exactly, so
 * there is nothing to correct.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{
var d=document.documentElement,c=d.getAttribute('data-theme-pref')||'system';
var m=window.matchMedia('(prefers-color-scheme: dark)');
var r=c==='system'?(m.matches?'dark':'light'):c;
if(d.getAttribute('data-theme')!==r){d.setAttribute('data-theme',r);}
m.addEventListener('change',function(){if(c==='system'){d.setAttribute('data-theme',m.matches?'dark':'light');}});
}catch(e){}})();`;
