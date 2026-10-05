'use client';

import { Toaster as SonnerToaster } from 'sonner';

import { useTheme } from '@/design/theme/provider';

/**
 * Toaster.
 *
 * Themed from the same tokens as everything else. Error toasts persist until
 * dismissed: a transient error in a clinical workflow is how a user misses that
 * an action did not save.
 *
 * `richColors` is deliberately off. It would tint the toast with its own
 * palette instead of our semantic tokens, and sonner's own critical red is not
 * one of the tokens asserted in `CONTRAST_CHECKS`.
 */
export function Toaster() {
  const { resolved } = useTheme();

  return (
    <SonnerToaster
      theme={resolved}
      position="bottom-right"
      closeButton
      // Errors and warnings stay until acted on.
      duration={6000}
      toastOptions={{
        classNames: {
          toast:
            'rounded-lg border border-border bg-surface-raised text-primary shadow-overlay font-sans',
          title: 'text-body font-medium',
          description: 'text-caption text-secondary',
          closeButton:
            'border border-control rounded-md text-secondary hover:bg-surface-hover hover:text-primary',
        },
      }}
    />
  );
}
