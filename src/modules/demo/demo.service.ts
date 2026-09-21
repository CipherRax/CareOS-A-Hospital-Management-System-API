import { Injectable } from '@nestjs/common';
import { newId } from '../../common/lib/uuidv7';
import { TxRunner, type TxContext } from '../../database/tx';
import { EventTypes } from '../../events/catalog';

@Injectable()
export class DemoService {
  constructor(private readonly txRunner: TxRunner) {}

  /**
   * DEMO-ONLY use-case that exercises the transactional outbox + audit paths:
   * business rows and the outbox event commit in one transaction.
   */
  async emitProbe(
    label: string,
  ): Promise<{ ok: true; auditId: string; eventId: string; eventType: 'CareOS.Probe' }> {
    const auditId = newId();

    const eventId = await this.txRunner.run(async (ctx: TxContext) => {
      await ctx.db.auditLog.create({
        data: {
          id: auditId,
          organizationId: ctx.organizationId,
          action: 'demo.probe',
          resource: 'demo',
          reason: label,
        },
      });
      return ctx.emit({
        type: EventTypes.Probe,
        aggregateType: 'demo',
        aggregateId: auditId,
        payload: { probe: label },
      });
    });

    return { ok: true, auditId, eventId, eventType: 'CareOS.Probe' };
  }
}
