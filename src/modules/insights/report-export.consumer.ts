import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '../../events/catalog';
import type {
  OutboxConsumer,
  OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { MissingGlyphError, PdfRenderError } from '../../jobs/pdf/pdf-errors';
import { AppError } from '../../common/errors/app-error';
import { ReportsService } from './reports.service';

/**
 * The `Reports.ExportRequested` payload this consumer relies on. Declared
 * loosely on purpose: the payload arrives as already-serialised JSON from the
 * outbox and every field is re-checked at runtime below.
 */
interface ExportRequestedPayload {
  exportId?: unknown;
}

/**
 * `Reports.ExportRequested` side-effect (patch P11, ADR-049).
 *
 * `POST /reports/export` used to build the report, render it, and persist it
 * before responding, so a wide report over a long window was bounded only by
 * the request's own timeout and a slow render looked like a failed request. The
 * request now records the work and returns; this consumer does the rest.
 *
 * Design points worth stating, because they are the ones a reviewer will probe:
 *
 *  - **Failures are recorded, not thrown.** A report that cannot be rendered
 *    (a glyph the font lacks, a storage outage) is a terminal state for that
 *    export. Re-raising would make the outbox retry the same impossible render
 *    on a tight loop, and the row would sit in PENDING with no operator-visible
 *    reason. `FAILED` plus a reason a human can act on is the honest outcome.
 *    Throwing stays reserved for a payload with no export id at all, which is
 *    not retryable either and is logged and acked.
 *  - **The recorded window is authoritative.** `resolveWindow` fills defaults
 *    relative to now, so a consumer that recomputed it minutes later would
 *    produce a different report than the one that was asked for. The row already
 *    carries the resolved window; this never re-resolves it.
 *  - **No content crosses this boundary.** The event carries the export id only.
 *    The window, branch, and department stay on the row, where RLS scopes them.
 *  - **Idempotent.** The outbox is at-least-once, so a duplicate delivery finds
 *    a row that is no longer PENDING and returns without re-rendering.
 */
@Injectable()
export class ReportExportConsumer implements OutboxConsumer {
  readonly name = 'report-export';
  readonly eventTypes: ReadonlyArray<string> = [EventTypes.ExportRequested];

  private readonly logger = new Logger(ReportExportConsumer.name);

  constructor(private readonly reports: ReportsService) {}

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const payload = (ctx.row.payload ?? {}) as ExportRequestedPayload;
    const exportId =
      typeof payload.exportId === 'string' ? payload.exportId : ctx.row.aggregateId;
    if (!exportId) {
      // Unactionable payload: retrying cannot make it valid, so ack and log.
      this.logger.warn(`export request ${ctx.row.id} carried no exportId; generation skipped`);
      return;
    }

    try {
      await this.reports.generate(exportId, ctx.organizationId);
    } catch (err) {
      // The row's message is operator-facing, so it names the cause and never
      // the report contents. The full error — with its stack and its cause
      // chain — goes to the log instead, because a sanitized one-line reason is
      // the right thing to *store* and the wrong thing to *diagnose* with.
      const message = describe(err);
      this.logger.warn(
        `report export ${exportId} failed: ${message}; cause: ${errorChain(err)}`,
      );
      await this.reports
        .failGeneration(exportId, ctx.organizationId, message)
        .catch((recordErr) => {
          this.logger.error(
            `could not record failure for report export ${exportId}: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
          );
        });
    }
  }
}

/**
 * Turns a render/storage failure into a short, PHI-free reason.
 *
 * A missing glyph is reported as hex code points and *not* re-using
 * `MissingGlyphError.message`, which helpfully quotes the character itself. One
 * character from a patient's name is still patient data, and this string lands
 * in a column an operator reads.
 *
 * An unknown error is deliberately reduced to its class name. The default
 * `String(err)` would put whatever an upstream library decided to include in
 * its message into that column, and a Prisma or S3 message can quote a value.
 */
/**
 * Flattens an error and its `cause` chain for the log. Server-side only: unlike
 * `describe`, this can quote upstream text, so it must never reach the row.
 */
function errorChain(err: unknown): string {
  const parts: string[] = [];
  for (let cur: unknown = err, depth = 0; cur && depth < 5; depth += 1) {
    parts.push(cur instanceof Error ? `${cur.name}: ${cur.message}` : String(cur));
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(' <- ');
}

function describe(err: unknown): string {
  if (err instanceof MissingGlyphError) {
    const hex = err.codePoints
      .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`)
      .join(', ');
    return `font cannot render ${hex} (${err.context})`;
  }
  if (err instanceof PdfRenderError) {
    return `render failed: ${err.message}`;
  }
  if (err instanceof AppError) {
    // The code is an enumerated constant, not user or report text, so it is
    // safe to show and is the only part an operator can act on. The message is
    // deliberately dropped: AppError messages may wrap an upstream cause.
    return `generation failed (${err.code})`;
  }
  if (err instanceof Error) {
    return `generation failed (${err.name})`;
  }
  return 'generation failed';
}
