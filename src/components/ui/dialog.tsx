'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { buttonVariants } from './button';

/**
 * Dialog.
 *
 * Destructive confirmations get `tone="danger"` on the confirm button, because
 * "Confirm" on its own is not an adequate label for something that cannot be
 * undone. Callers should pass an explicit verb.
 *
 * Overlay uses a border and a scrim rather than a large blur; the brief bans
 * glassmorphism, and a heavy backdrop blur is expensive on the low-end hardware
 * common in clinical settings.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(0_0_0/0.45)]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
          'rounded-lg border border-border bg-surface-raised shadow-overlay',
          'max-h-[calc(100dvh-2rem)] overflow-y-auto',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          // Named for screen readers: an unlabelled X is announced as "button".
          aria-label="Close dialog"
          className={cn(
            'absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md',
            'text-tertiary transition-colors hover:bg-surface-hover hover:text-primary',
          )}
        >
          <X aria-hidden="true" className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-b border-border px-5 py-4 pr-12', className)}>
      <DialogPrimitive.Title className="text-heading-sm font-semibold text-primary">
        {title}
      </DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="mt-1 text-body text-secondary">
          {description}
        </DialogPrimitive.Description>
      ) : null}
    </div>
  );
}

export function DialogBody({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Confirmation dialog with the right default emphasis. `confirmLabel` is
 * required rather than defaulted so a destructive action can never ship reading
 * just "OK".
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={title} />
        <DialogBody>
          <p className="text-body text-secondary">{description}</p>
        </DialogBody>
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: 'secondary' })}>
            {cancelLabel}
          </DialogClose>
          <button type="button" disabled={pending} className={buttonVariants({ variant: tone })}>
            {pending ? 'Working' : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
