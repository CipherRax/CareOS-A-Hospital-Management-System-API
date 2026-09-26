import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import type { WindowQueryDto } from './dto/insights.dto';
import { RollupsService } from './rollups.service';
import { averageOf, rateOf } from './domain/rollup-cells';
import { resolveWindow, round2 } from './domain/window';

/**
 * Configurable composite patient-experience score (brief Phase 11 §7.12).
 * Components are measured against the recorded data; the composite is a
 * labelled estimate, not a clinical measure. Weights come from the org setting
 * `patientExperience.weights` (falls back to the defaults below).
 */
export const DEFAULT_EXPERIENCE_WEIGHTS = {
  waitingTime: 0.35,
  feedback: 0.3,
  appointmentReliability: 0.2,
  serviceCompletion: 0.15,
} as const;

export interface ExperienceWeights {
  waitingTime: number;
  feedback: number;
  appointmentReliability: number;
  serviceCompletion: number;
}

export function parseExperienceWeights(data: Prisma.JsonValue | null | undefined): ExperienceWeights {
  const raw = data as
    | { patientExperience?: { weights?: Partial<ExperienceWeights> | null } | null }
    | null
    | undefined;
  return {
    waitingTime: raw?.patientExperience?.weights?.waitingTime ?? DEFAULT_EXPERIENCE_WEIGHTS.waitingTime,
    feedback: raw?.patientExperience?.weights?.feedback ?? DEFAULT_EXPERIENCE_WEIGHTS.feedback,
    appointmentReliability:
      raw?.patientExperience?.weights?.appointmentReliability ?? DEFAULT_EXPERIENCE_WEIGHTS.appointmentReliability,
    serviceCompletion:
      raw?.patientExperience?.weights?.serviceCompletion ?? DEFAULT_EXPERIENCE_WEIGHTS.serviceCompletion,
  };
}

const clamp = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

@Injectable()
export class PatientExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly rollups: RollupsService,
  ) {}

  async score(query: WindowQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = resolveWindow(query.from, query.to, 30);

    const days = await this.rollups.readDays({
      organizationId,
      from,
      to,
      branchId: query.branchId,
      departmentId: query.departmentId,
    });

    const booked = days.reduce((a, d) => a + d.appointmentsBooked, 0);
    const noShow = days.reduce((a, d) => a + d.appointmentsNoShow, 0);
    const cancelled = days.reduce((a, d) => a + d.appointmentsCancelled, 0);
    const completed = days.reduce((a, d) => a + d.visitsCompleted, 0);
    const registered = days.reduce((a, d) => a + d.visitsRegistered, 0);
    const waitSamples = days.reduce((a, d) => a + d.waitSamples, 0);
    const waitMinutes = days.reduce((a, d) => a + Number(d.waitMinutes), 0);
    const ratingSum = days.reduce((a, d) => a + d.feedbackRatingSum, 0);
    const ratingSamples = days.reduce((a, d) => a + d.feedbackSubmitted, 0);

    const avgWait = averageOf(waitMinutes, waitSamples);
    const avgRating = averageOf(ratingSum, ratingSamples);

    // 100 base, minus a point per minute of average waiting time.
    const waitingTime = avgWait == null ? null : clamp(100 - avgWait);
    // rating scaled to 0..100 (rating scale is 1..5 in this system).
    const feedback = avgRating == null ? null : clamp((avgRating / 5) * 100);
    // reliable = not no-showed and not cancelled.
    const reliability = rateOf(booked - (noShow + cancelled), booked);
    const completion = registered > 0 ? round2((completed / registered) * 100) : null;

    const weights = parseExperienceWeights((await db.organizationSetting.findUnique({
      where: { organizationId },
    }))?.data);

    const present = [
      waitingTime,
      feedback,
      reliability,
      completion,
    ].filter((v): v is number => v != null);
    const weightKeys: (keyof ExperienceWeights)[] = ['waitingTime', 'feedback', 'appointmentReliability', 'serviceCompletion'];
    const components = [waitingTime, feedback, reliability, completion] as Array<number | null>;
    let weightedTotal = 0;
    let usedWeight = 0;
    for (let i = 0; i < components.length; i += 1) {
      const value = components[i];
      const key = weightKeys[i];
      if (key === undefined) continue;
      if (value == null) continue;
      const weight = Math.max(0, weights[key]);
      weightedTotal += weight * value;
      usedWeight += weight;
    }
    const composite =
      present.length === 0 || usedWeight <= 0 ? null : round2(weightedTotal / usedWeight);

    return {
      interpretation:
        'Composite estimate built from recorded measurements (waiting time, feedback rating, appointment reliability, service completion). Approximate, not a clinical measure.',
      weights,
      components: {
        waitingTime: { score: waitingTime, raw: { avgWaitingMinutes: avgWait } },
        feedback: { score: feedback, raw: { avgRating } },
        appointmentReliability: { score: reliability, raw: { bookings: booked, noShow, cancelled } },
        serviceCompletion: { score: completion, raw: { visitsCompleted: completed, visitsRegistered: registered } },
      },
      composite,
      period: { from: from.toISOString(), to: to.toISOString() },
    };
  }
}