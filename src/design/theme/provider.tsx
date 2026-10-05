'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  DENSITIES,
  DENSITY_COOKIE,
  THEME_COOKIE,
  THEME_PREFERENCES,
  type Density,
  type ResolvedTheme,
  type ThemePreference,
} from './preferences';

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly density: Density;
  readonly setPreference: (next: ThemePreference) => void;
  readonly setDensity: (next: Density) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return prefersDark() ? 'dark' : 'light';
  return preference;
}

function persist(name: string, value: string) {
  // SameSite=Lax and a one-year max-age. A display preference is not sensitive
  // and should not cost a server round-trip on every visit.
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeProvider({
  initialPreference,
  initialDensity,
  children,
}: {
  initialPreference: ThemePreference;
  initialDensity: Density;
  children: ReactNode;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [density, setDensityState] = useState<Density>(initialDensity);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(initialPreference));

  // Keep the server-rendered attribute correct after hydration, and follow the OS
  // live when the preference is `system`. Density needs no equivalent: the server
  // always knows it exactly, so it is right in the first paint.
  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(mq.matches ? 'dark' : 'light');
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  const setPreference = useCallback((next: ThemePreference) => {
    if (!(THEME_PREFERENCES as readonly string[]).includes(next)) return;
    setPreferenceState(next);
    setResolved(resolve(next));
    persist(THEME_COOKIE, next);
    document.documentElement.setAttribute('data-theme-pref', next);
  }, []);

  const setDensity = useCallback((next: Density) => {
    if (!(DENSITIES as readonly string[]).includes(next)) return;
    setDensityState(next);
    persist(DENSITY_COOKIE, next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, density, setPreference, setDensity }),
    [preference, resolved, density, setPreference, setDensity],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/**
 * Reads theme and density. Throws outside a provider rather than returning a
 * silent default: a component rendering with the wrong density is a layout bug
 * that is very hard to spot in review.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

export type { Density, ResolvedTheme, ThemePreference };
