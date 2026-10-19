import { notFound } from 'next/navigation';

import { FeedbackWorkspaceScreen } from '@/components/staff/feedback-workspace';

/**
 * /quality/feedback/[id] — one feedback record and its single write, a response
 * (brief Phase 10).
 *
 * `id` is the API's feedback id (a UUID in a real deployment; EXAMPLE-scoped in
 * the mock registry). A clearly malformed id fails closed with `notFound()`, the
 * same precedent as the billing, laboratory, pharmacy and patient master pages.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <FeedbackWorkspaceScreen id={id} />;
}
