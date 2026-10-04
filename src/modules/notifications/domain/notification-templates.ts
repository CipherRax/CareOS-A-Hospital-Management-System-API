import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

export const BUILT_IN_TEMPLATES: Record<
  string,
  {
    subjectTemplate: string;
    bodyTemplate: string;
    allowlistedVariables: string[];
  }
> = {
  'appointment.booked': {
    subjectTemplate: 'A new appointment was booked',
    bodyTemplate: 'An appointment was booked. Reference: [appointmentId].',
    allowlistedVariables: ['appointmentId'],
  },
  'task.assigned': {
    subjectTemplate: 'A task was assigned',
    bodyTemplate: 'A task status changed. Reference: [taskId].',
    allowlistedVariables: ['taskId'],
  },
  'lab.result.released': {
    subjectTemplate: 'A lab result was released',
    bodyTemplate: 'A lab result was released. Reference: [labResultId].',
    allowlistedVariables: ['labResultId'],
  },
  'coding.reference_updated': {
    subjectTemplate: 'A clinical coding reference was updated',
    bodyTemplate:
      'A coding reference set was imported. Codes added: [inserted] of [total]. Reference: [codingSystemId].',
    allowlistedVariables: ['codingSystemId', 'inserted', 'total'],
  },
  // Emergency intake (brief §6.15). These pages a human; they are deliberately
  // reference-only — no caller name, phone number, location, or description is
  // ever interpolated into a notification body. Staff open the request to see
  // caller detail. Keeping PHI out of the body also keeps it out of SMS/email
  // payloads on off-system channels.
  'emergency.request_received': {
    subjectTemplate: 'New emergency help request [referenceNumber]',
    bodyTemplate:
      'A new emergency help request was received at [branchName]. Reference: [referenceNumber]. Open the emergency inbox for details.',
    allowlistedVariables: ['referenceNumber', 'branchName'],
  },
  'emergency.escalation': {
    subjectTemplate: 'Emergency request [referenceNumber] escalated to level [level]',
    bodyTemplate:
      'Emergency request [referenceNumber] at [branchName] reached escalation level [level] with no responder confirmed. Open the emergency inbox.',
    allowlistedVariables: ['referenceNumber', 'branchName', 'level'],
  },
  'emergency.final_escalation': {
    subjectTemplate: 'Emergency request [referenceNumber] reached final escalation',
    bodyTemplate:
      'Emergency request [referenceNumber] at [branchName] reached its final escalation level and no responder has confirmed. This is the last automated step — act now in the emergency inbox.',
    allowlistedVariables: ['referenceNumber', 'branchName'],
  },
  'emergency.request_unreachable': {
    subjectTemplate: 'Emergency request [referenceNumber] could not reach the caller',
    bodyTemplate:
      'A callback attempt for emergency request [referenceNumber] at [branchName] did not reach the caller. The request is flagged as unreachable.',
    allowlistedVariables: ['referenceNumber', 'branchName'],
  },
  // Display devices (brief §5.16). A screen that stops checking in leaves a
  // waiting room looking at a board that silently stopped updating. Only the
  // device's own name and its branch are interpolated — the queue board is
  // patient-facing data and never travels in a notification body.
  'display.device_stale': {
    subjectTemplate: 'Display "[deviceName]" at [branchName] has stopped checking in',
    bodyTemplate:
      'Display "[deviceName]" at [branchName] has not checked in for [minutes] minutes while still marked active. Waiting-room visitors may be seeing an out-of-date board. Check the device and the display device list.',
    allowlistedVariables: ['deviceName', 'branchName', 'minutes'],
  },
};

export function renderTemplate(
  template: {
    subjectTemplate: string;
    bodyTemplate: string;
    allowlistedVariables: string[];
  },
  variables: Record<string, unknown>,
): { subject: string; body: string } {
  const allowlist = new Set(template.allowlistedVariables);
  const forbidden = Object.keys(variables).filter((key) => !allowlist.has(key));
  if (forbidden.length > 0) {
    throw new AppError({
      code: ErrorCodes.NOTIFICATION_TEMPLATE_FORBIDDEN,
      message: 'Notification variables are not allowlisted by this template.',
      silent: true,
    });
  }

  const substitute = (source: string): string => {
    let rendered = source;
    for (const key of allowlist) {
      const value = variables[key];
      if (value !== undefined) {
        rendered = rendered.replaceAll(`[${key}]`, String(value));
      }
    }
    return rendered;
  };

  return {
    subject: substitute(template.subjectTemplate),
    body: substitute(template.bodyTemplate),
  };
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){7,15}\d/gu;
const NATIONAL_ID_PATTERN =
  /\b(?:national\s+(?:id|identity)(?:\s*(?:number|no\.?))?\s*[:=#-]?\s*[A-Z0-9-]{5,}|\d{3}-\d{2}-\d{4})\b/giu;
const PASSWORD_PATTERN = /\b(?:password|passwd|pwd)\s*(?:is|=|:)\s*[^\s,;]+/giu;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

export function ensureNeutralBody(subject: string, body: string): string[] {
  const text = `${subject}\n${body}`
    .replace(UUID_PATTERN, ' id ');
  const suspicious = new Set<string>();
  for (const pattern of [
    EMAIL_PATTERN,
    PHONE_PATTERN,
    NATIONAL_ID_PATTERN,
    PASSWORD_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      suspicious.add(match[0]);
    }
  }
  return [...suspicious];
}
