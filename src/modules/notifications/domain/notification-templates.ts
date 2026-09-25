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
