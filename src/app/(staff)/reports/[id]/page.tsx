import { notFound } from 'next/navigation';

import { ReportWorkspaceScreen } from '@/components/reports/report-workspace';

/**
 * /reports/[id] — report export detail (F10 analytics & reports).
 *
 * `id` is the API's report-export id (a UUID in a real deployment; EXAMPLE-scoped
 * in the mock registry). A clearly malformed id fails closed with `notFound()`,
 * the same precedent as the other workspaces.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function ReportExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <ReportWorkspaceScreen reportId={id} />;
}
