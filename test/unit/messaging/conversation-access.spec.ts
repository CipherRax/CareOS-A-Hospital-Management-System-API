import { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { ConversationsService } from '../../../src/modules/messaging/conversations.service';
import {
  assertCanRead,
  canAccessConversation,
} from '../../../src/modules/messaging/domain/conversation-access';

describe('conversation access', () => {
  const participants = [{ userId: 'user-1' }, { userId: 'user-2' }];

  it('allows a staff participant', () => {
    expect(
      canAccessConversation({
        actorUserId: 'user-1',
        actorPatientId: null,
        participants,
        patientId: 'patient-1',
      }),
    ).toBe(true);
  });

  it('denies a user outside the conversation', () => {
    expect(
      canAccessConversation({
        actorUserId: 'user-3',
        actorPatientId: null,
        participants,
        patientId: 'patient-1',
      }),
    ).toBe(false);
  });

  it('allows a patient participant only for the matching patient context', () => {
    expect(
      canAccessConversation({
        actorUserId: 'user-1',
        actorPatientId: 'patient-1',
        participants,
        patientId: 'patient-1',
      }),
    ).toBe(true);
  });

  it('denies a patient participant scoped to another patient', () => {
    expect(
      canAccessConversation({
        actorUserId: 'user-1',
        actorPatientId: 'patient-2',
        participants,
        patientId: 'patient-1',
      }),
    ).toBe(false);
  });

  it('throws CONVERSATION_ACCESS_DENIED for a non-participant', () => {
    try {
      assertCanRead({
        actorUserId: 'user-3',
        participants,
        patientId: 'patient-1',
      });
      throw new Error('expected access to be denied');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCodes.CONVERSATION_ACCESS_DENIED);
    }
  });

  it('throws CONVERSATION_ACCESS_DENIED for a patient mismatch', () => {
    try {
      assertCanRead({
        actorUserId: 'user-1',
        actorPatientId: 'patient-2',
        participants,
        patientId: 'patient-1',
      });
      throw new Error('expected access to be denied');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCodes.CONVERSATION_ACCESS_DENIED);
    }
  });

  it('does not expose message update or delete operations', () => {
    const methods = Object.getOwnPropertyNames(ConversationsService.prototype);
    expect(methods).not.toContain('updateMessage');
    expect(methods).not.toContain('deleteMessage');
  });
});
