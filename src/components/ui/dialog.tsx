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
        // Radix hides the rest of the document with `aria-hidden`, but never sets
        // `aria-modal` itself. That attribute is the standard signal that tells
        // assistive technology the content behind is inert, and without it a modal
        // is announced as an ordinary dialog. Set explicitly.
        aria-modal="true"
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
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Required. A confirmation dialog that cannot be confirmed is a dead end, and one
   * that exists only to look right in a design system will be copied into a
   * destructive path with nothing wired to it.
   */
  onConfirm: () => void;
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
        {/* The description goes through the header so Radix wires it as
            `aria-describedby`. Rendered as a plain paragraph in the body it looked
            correct and was announced as an empty dialog — so "this cannot be undone"
            reached nobody who was not looking at the screen. */}
        <DialogHeader title={title} description={description} />
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: 'secondary' })}>
            {cancelLabel}
          </DialogClose>
          <DialogClose asChild>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className={buttonVariants({ variant: tone })}
            >
              {pending ? 'Working' : confirmLabel}
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
