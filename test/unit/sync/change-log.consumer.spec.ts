import { ChangeLogProjectionConsumer } from '../../../src/events/consumers/change-log.consumer';
import { EventTypes } from '../../../src/events/catalog';

function ctx(type: string, payload: Record<string, unknown>, aggregateId = 'agg-1') {
  const upsert = jest.fn().mockResolvedValue({});
  return {
    row: {
      id: 'ob-1',
      organizationId: 'org-1',
      type,
      aggregateId,
      version: 3,
      actorId: 'user-1',
      occurredAt: new Date('2026-01-02T03:04:05.000Z'),
      payload,
    },
    organizationId: 'org-1',
    db: { changeLog: { upsert } },
    upsert,
  };
}

describe('ChangeLogProjectionConsumer', () => {
  it('projects a patient event with the patient id from the payload', async () => {
    const { consumer } = { consumer: new ChangeLogProjectionConsumer() };
    const context = ctx(EventTypes.PatientRegistered, {
      patientId: 'pat-9',
      patientNumber: 'PAT-1',
    });
    await consumer.handle(context as never);
    expect(context.upsert).toHaveBeenCalledTimes(1);
    const arg = context.upsert.mock.calls[0][0];
    expect(arg.create.resourceType).toBe('patient');
    expect(arg.create.resourceId).toBe('pat-9');
    expect(arg.create.requiredPermission).toBe('patients.read');
    expect(arg.create.sourceEventId).toBe('ob-1');
    expect(arg.create.version).toBe(3);
  });

  it('projects an appointment event under the appointment resource', async () => {
    const consumer = new ChangeLogProjectionConsumer();
    const context = ctx(EventTypes.AppointmentBooked, {
      appointmentId: 'apt-3',
      status: 'BOOKED',
    });
    await consumer.handle(context as never);
    const arg = context.upsert.mock.calls[0][0];
    expect(arg.create.resourceType).toBe('appointment');
    expect(arg.create.resourceId).toBe('apt-3');
    expect(arg.create.requiredPermission).toBe('appointments.read');
  });

  it('falls back to the aggregate id when the payload omits the id key', async () => {
    const consumer = new ChangeLogProjectionConsumer();
    const context = ctx(EventTypes.VisitStatusChanged, { status: 'WAITING' }, 'visit-7');
    await consumer.handle(context as never);
    expect(context.upsert.mock.calls[0][0].create.resourceId).toBe('visit-7');
  });

  it('ignores events that are not syncable', async () => {
    const consumer = new ChangeLogProjectionConsumer();
    const context = ctx(EventTypes.Probe, { anything: true });
    await consumer.handle(context as never);
    expect(context.upsert).not.toHaveBeenCalled();
  });

  it('subscribes only to syncable events', () => {
    const consumer = new ChangeLogProjectionConsumer();
    expect(consumer.eventTypes).toContain(EventTypes.PatientRegistered);
    expect(consumer.eventTypes).not.toContain(EventTypes.Probe);
  });
});
