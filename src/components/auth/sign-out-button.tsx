'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Staff sign-out.
 *
 * Rendered in the session header. The browser cannot know the refresh token
 * (HttpOnly), so this only asks the proxy to end the session; the proxy fills in
 * the secret from the cookie, clears both session cookies on a 204, and the
 * next `/auth/me` reads as signed out.
 *
 * The mutation is intentionally not awaiting the router round-trip: a logout
 * that is slow to finish should still start emptying the screen promptly.
 */
export function SignOutButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);

  const signOut = useMutation({
    mutationFn: async () => {
      const result = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({}),
      });
      // The proxy clears the cookies only on an upstream 2xx; anything else
      // leaves the session intact, so the UI must not pretend otherwise.
      if (!result.ok && result.status !== 204) {
        throw new Error(`logout ${result.status}`);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      router.refresh();
    },
    onError: () => setFailed(true),
  });

  return (
    <Button
      variant={failed ? 'danger' : 'tertiary'}
      size="sm"
      disabled={signOut.isPending}
      onClick={() => signOut.mutate()}
    >
      {failed ? t('signOutFailed') : t('signOut')}
    </Button>
  );
}
