import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { AdminJobsService } from './admin-jobs.service';
import { isAdminQueueName } from './domain/admin-queues';
import { ListJobsQueryDto, QueueJobActionDto } from './dto/admin-jobs.dto';

/**
 * Admin inspection of failed background work (brief §5.9).
 *
 * A listing shows the name of the job, why it failed, how many attempts it
 * took, when it failed, and a reference to what it was working on. The
 * payload is not returned: a failed job's payload is ids-only by construction,
 * but those ids are still patient identifiers, and this screen is not where
 * they should accumulate.
 */
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly jobs: AdminJobsService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List failed background jobs (outbox dead letters and failed queue jobs)',
    operationId: 'adminJobsList',
    permissions: [PERMISSION_GROUPS.adminJobs.manage],
    errors: [{ status: 400, description: 'Unknown source or status filter' }],
  })
  list(@Query() query: ListJobsQueryDto) {
    return this.jobs.list(query);
  }

  @Post('outbox/:id/requeue')
  @ApiEndpoint({
    summary: 'Requeue a dead outbox event',
    description:
      'The event goes back to PENDING with its attempt counter reset, so the next drain dispatches it again. Safe by construction: every consumer is idempotent on the source event id.',
    operationId: 'adminJobsOutboxRequeue',
    permissions: [PERMISSION_GROUPS.adminJobs.manage],
    errors: [
      { status: 404, description: 'Job not found' },
      { status: 409, description: 'The job is not dead or failed' },
    ],
  })
  requeueOutbox(@Param('id') id: string) {
    return this.jobs.requeueOutboxEvent(id);
  }

  @Post('outbox/:id/discard')
  @ApiEndpoint({
    summary: 'Discard a dead outbox event',
    description:
      'The row is kept and marked DISCARDED rather than deleted: the fact that an event could not be delivered stays on the record.',
    operationId: 'adminJobsOutboxDiscard',
    permissions: [PERMISSION_GROUPS.adminJobs.manage],
    errors: [
      { status: 404, description: 'Job not found' },
      { status: 409, description: 'The job is not dead or failed' },
    ],
  })
  discardOutbox(@Param('id') id: string) {
    return this.jobs.discardOutboxEvent(id);
  }

  @Post('queue/:queue/requeue')
  @ApiEndpoint({
    summary: 'Requeue a failed queue job',
    operationId: 'adminJobsQueueRequeue',
    permissions: [PERMISSION_GROUPS.adminJobs.manage],
    errors: [
      { status: 400, description: 'Unknown queue' },
      { status: 404, description: 'Job not found' },
    ],
  })
  requeueQueue(@Param('queue') queue: string, @Body() body: QueueJobActionDto) {
    this.assertQueue(queue);
    return this.jobs.requeueQueueJob(queue, body.jobId);
  }

  @Post('queue/:queue/discard')
  @ApiEndpoint({
    summary: 'Discard a failed queue job',
    operationId: 'adminJobsQueueDiscard',
    permissions: [PERMISSION_GROUPS.adminJobs.manage],
    errors: [
      { status: 400, description: 'Unknown queue' },
      { status: 404, description: 'Job not found' },
    ],
  })
  discardQueue(@Param('queue') queue: string, @Body() body: QueueJobActionDto) {
    this.assertQueue(queue);
    return this.jobs.discardQueueJob(queue, body.jobId);
  }

  private assertQueue(queue: string): void {
    if (!isAdminQueueName(queue)) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unknown queue: ${queue}`,
      });
    }
  }
}
