import { http, HttpResponse } from 'msw';

import {
  REPORT_EXPORTS,
  type RegistryReportExport,
  type RegistryReportFormat,
  type RegistryReportType,
} from '@/mocks/fixtures/report-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F10 report-export handlers.
 *
 * State is a deep clone of the fixture history, mutable for the length of the
 * mock session: requesting an export prepends a PENDING row that the list and the
 * detail read back, exactly as the service's asynchronous queue does. The guards
 * mirror the service — an unknown type or format is a 400, an unknown export is a
 * 404, and the download refuses a row that is not READY (409) or has expired
 * (410).
 */

type MutableReport = { -readonly [K in keyof RegistryReportExport]: RegistryReportExport[K] };

const REPORTS: RegistryReportExport[] = REPORT_EXPORTS.map((report) => ({ ...report }));
let reportSeq = 5;

const REPORT_TYPES: readonly RegistryReportType[] = [
  'PATIENT',
  'APPOINTMENT',
  'CLINICAL_OPERATIONS',
  'LABORATORY',
  'PHARMACY',
  'FINANCIAL',
  'INSURANCE',
  'OPERATIONS',
];
const REPORT_FORMATS: readonly RegistryReportFormat[] = ['JSON', 'CSV', 'PDF'];

const CONTENT_TYPES: Record<RegistryReportFormat, string> = {
  JSON: 'application/json',
  CSV: 'text/csv',
  PDF: 'application/pdf',
};

function findReport(id: string): MutableReport | undefined {
  return REPORTS.find((report) => report.id === id);
}

function notFound(message: string) {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', message), { status: 404 });
}

function validationError(message: string) {
  return HttpResponse.json(apiError('VALIDATION_ERROR', message), { status: 422 });
}

function conflict(message: string) {
  return HttpResponse.json(apiError('CONFLICT', message), { status: 409 });
}

function expired(message: string) {
  return HttpResponse.json(apiError('RESOURCE_EXPIRED', message), { status: 410 });
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function reportHandlers() {
  return [
    http.get('*/api/v1/reports/exports', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const reportType = url.searchParams.get('reportType');
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25') || 25));

      const filtered = REPORTS.filter((report) => !reportType || report.reportType === reportType).sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      );
      const start = (page - 1) * limit;
      return HttpResponse.json(apiPage(filtered.slice(start, start + limit), filtered.length, limit));
    }),

    http.post('*/api/v1/reports/export', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return validationError('bad json');
      }
      const reportType = stringField(body.reportType) as RegistryReportType | null;
      const format = stringField(body.format) as RegistryReportFormat | null;
      if (!reportType || !REPORT_TYPES.includes(reportType)) {
        return validationError('A known report type is required.');
      }
      if (!format || !REPORT_FORMATS.includes(format)) {
        return validationError('A known format is required.');
      }

      const createdAt = new Date().toISOString();
      const report: MutableReport = {
        id: `rep_example_${String(reportSeq).padStart(4, '0')}`,
        reportType,
        format,
        status: 'PENDING',
        contentType: CONTENT_TYPES[format],
        sizeBytes: null,
        summary: null,
        error: null,
        createdAt,
        completedAt: null,
        expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
      };
      REPORTS.unshift(report);
      reportSeq += 1;
      return HttpResponse.json(apiOk(report), { status: 202 });
    }),

    http.get('*/api/v1/reports/exports/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const report = findReport(String(params.id));
      if (!report) return notFound('Report export not found');
      return HttpResponse.json(apiOk(report));
    }),

    http.get('*/api/v1/reports/exports/:id/download', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const report = findReport(String(params.id));
      if (!report) return notFound('Report export not found');
      if (report.status !== 'READY') {
        return report.status === 'EXPIRED'
          ? expired('Report has expired (exports are available for 24 hours)')
          : conflict(`Report is ${report.status.toLowerCase()}, not downloadable`);
      }
      return new HttpResponse('summary,row\n"total",12\n', {
        status: 200,
        headers: {
          'content-type': report.contentType ?? 'application/octet-stream',
          'content-disposition': `attachment; filename="${report.reportType.toLowerCase()}-${report.id}.csv"`,
        },
      });
    }),
  ];
}
