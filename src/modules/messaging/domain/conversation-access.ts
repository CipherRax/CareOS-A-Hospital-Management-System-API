import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

export interface ConversationParticipantAccess {
  userId: string;
}

export interface ConversationAccessInput {
  actorUserId: string | null | undefined;
  actorPatientId?: string | null;
  participants: readonly ConversationParticipantAccess[];
  patientId?: string | null;
}

export function canAccessConversation(input: ConversationAccessInput): boolean {
  if (!input.actorUserId) return false;
  if (
    !input.participants.some((participant) => participant.userId === input.actorUserId)
  ) {
    return false;
  }
  if (input.actorPatientId == null) return true;
  return input.patientId != null && input.patientId === input.actorPatientId;
}

export function assertCanRead(input: ConversationAccessInput): void {
  if (canAccessConversation(input)) return;
  throw new AppError({
    code: ErrorCodes.CONVERSATION_ACCESS_DENIED,
    message: 'You are not a participant in this conversation.',
    silent: true,
  });
}
