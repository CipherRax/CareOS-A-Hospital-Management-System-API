import { Lock } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * "This access is logged" notice.
 *
 * Required by the brief on sensitive views, and the reason is behavioural rather
 * than decorative: in a shared clinical workstation, the knowledge that a view is
 * recorded changes how a person behaves. A record officer reading an access log
 * knowing their own read is in it is a different situation from one who does not.
 *
 * Kept quiet on purpose — `text-secondary` on `surface-sunken`, a 1px rule, no
 * fill. An alert-styled banner on every sensitive screen becomes a banner people
 * stop reading, and this one only works while it is still noticed.
 *
 * The notice states what the system records. It does not promise a retention period
 * or a consequence; the API owns both, and a UI that invents them is a UI that
 * will be wrong.
 */

export interface AuditNoteProps {
  /** What is being accessed. Named, so the notice is specific rather than generic. */
  children: React.ReactNode;
  className?: string;
}

export function AuditNote({ children, className }: AuditNoteProps) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 border border-border bg-surface-sunken px-3 py-2 text-meta text-secondary',
        className,
      )}
    >
      <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-tertiary" strokeWidth={1.5} />
      <span>
        <span className="font-medium text-primary">Access is logged.</span> Viewing {children} is
        recorded against your account.
      </span>
    </p>
  );
}
