import { cookies } from 'next/headers';

import {
  DEFAULT_DENSITY,
  DEFAULT_THEME_PREFERENCE,
  DENSITY_COOKIE,
  THEME_COOKIE,
  isDensity,
  isThemePreference,
  type Density,
  type ThemePreference,
} from './preferences';

export interface ThemePreferenceState {
  readonly theme: ThemePreference;
  readonly density: Density;
}

/**
 * Reads the visitor's preferences from cookies. Server-only: `cookies()` cannot
 * be called during a static render, which is why every consumer is dynamic.
 *
 * Unrecognised values fall back to the default rather than throwing. A stale
 * cookie written by an older build should degrade to the default, not take the
 * product down.
 */
export async function getThemePreference(): Promise<ThemePreferenceState> {
  const store = await cookies();

  const themeCookie = store.get(THEME_COOKIE)?.value;
  const densityCookie = store.get(DENSITY_COOKIE)?.value;

  return {
    theme: isThemePreference(themeCookie) ? themeCookie : DEFAULT_THEME_PREFERENCE,
    density: isDensity(densityCookie) ? densityCookie : DEFAULT_DENSITY,
  };
}
