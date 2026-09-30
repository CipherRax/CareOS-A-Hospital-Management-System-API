import { ReportExportConsumer } from '../../../src/modules/insights/report-export.consumer';
import { EventTypes } from '../../../src/events/catalog';
import { MissingGlyphError, PdfRenderError } from '../../../src/jobs/pdf/pdf-errors';
import type {
  OutboxConsumerContext,
} from '../../../src/events/outbox-consumer/outbox-consumer.types';

const ORG = '01a0f091-ad65-7000-816e-c52688b71240';

function ctx(over: { payload?: unknown; aggregateId?: string } = {}): OutboxConsumerContext {
  return {
    row: {
      id: 'ev-1',
      organizationId: ORG,
      type: EventTypes.ExportRequested,
      version: 1,
      aggregateType: 'ReportExport',
      aggregateId: over.aggregateId ?? 'exp-1',
      actorId: null,
      correlationId: null,
      occurredAt: new Date('2026-09-30T12:00:00.000Z'),
      attemptCount: 0,
      payload: over.payload ?? { exportId: 'exp-1' },
    },
    db: {} as never,
    organizationId: ORG,
  } as OutboxConsumerContext;
}

function makeConsumer() {
  const reports = {
    generate: jest.fn().mockResolvedValue(undefined),
    failGeneration: jest.fn().mockResolvedValue(undefined),
  };
  return { consumer: new ReportExportConsumer(reports as never), reports };
}

describe('ReportExportConsumer', () => {
  it('subscribes only to the export-requested event', () => {
    const { consumer } = makeConsumer();
    expect(consumer.name).toBe('report-export');
    expect(consumer.eventTypes).toEqual([EventTypes.ExportRequested]);
  });

  it('generates the export named in the payload, in the event organization', async () => {
    const { consumer, reports } = makeConsumer();
    await consumer.handle(ctx());
    expect(reports.generate).toHaveBeenCalledWith('exp-1', ORG);
    expect(reports.failGeneration).not.toHaveBeenCalled();
  });

  it('falls back to the aggregate id when the payload is empty', async () => {
    const { consumer, reports } = makeConsumer();
    await consumer.handle(ctx({ payload: {}, aggregateId: 'exp-aggregate' }));
    expect(reports.generate).toHaveBeenCalledWith('exp-aggregate', ORG);
  });

  it('acks a payload with no id at all instead of retrying forever', async () => {
    // Not retryable: there is no export to render, and a throw would make the
    // dispatcher retry the same unactionable event until it goes dead.
    const { consumer, reports } = makeConsumer();
    await expect(
      consumer.handle(ctx({ payload: {}, aggregateId: '' })),
    ).resolves.toBeUndefined();
    expect(reports.generate).not.toHaveBeenCalled();
    expect(reports.failGeneration).not.toHaveBeenCalled();
  });

  it('records a missing-glyph failure with the code points, not the text', async () => {
    const { consumer, reports } = makeConsumer();
    reports.generate.mockRejectedValueOnce(new MissingGlyphError([0x4e2d], 'a table cell'));
    await consumer.handle(ctx());
    // The offending string is patient data; the code point is the whole point.
    expect(reports.failGeneration).toHaveBeenCalledWith(
      'exp-1',
      ORG,
      'font cannot render U+4E2D (a table cell)',
    );
    // The character itself is patient data; the code point is the whole point.
    expect(reports.failGeneration.mock.calls[0]?.[2]).not.toContain('\u4e2d');
  });

  it('records a render failure message', async () => {
    const { consumer, reports } = makeConsumer();
    reports.generate.mockRejectedValueOnce(new PdfRenderError('page geometry overflow'));
    await consumer.handle(ctx());
    expect(reports.failGeneration).toHaveBeenCalledWith(
      'exp-1',
      ORG,
      'render failed: page geometry overflow',
    );
  });

  it('reduces an unknown error to its class name, so no library message leaks', async () => {
    // Prisma and the S3 SDK both quote values into their messages; those can
    // carry report content, and this string lands in a column operators read.
    const { consumer, reports } = makeClientWithPrismaishError();
    await consumer.handle(ctx());
    const message = reports.failGeneration.mock.calls[0]?.[2] as string;
    expect(message).toBe('generation failed (PrismaClientKnownRequestError)');
    expect(message).not.toContain('patients');
  });

  it('does not throw when the failure cannot be recorded either', async () => {
    // Re-raising here would put the event back on the retry ladder with no row
    // state to show for it; a logged miss is the honest end of that path.
    const { consumer, reports } = makeConsumer();
    reports.generate.mockRejectedValueOnce(new PdfRenderError('boom'));
    reports.failGeneration.mockRejectedValueOnce(new Error('db down'));
    await expect(consumer.handle(ctx())).resolves.toBeUndefined();
  });
});

function makeClientWithPrismaishError() {
  const reports = {
    generate: jest.fn().mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed on patients.email'), {
        name: 'PrismaClientKnownRequestError',
      }),
    ),
    failGeneration: jest.fn().mockResolvedValue(undefined),
  };
  return { consumer: new ReportExportConsumer(reports as never), reports };
}
