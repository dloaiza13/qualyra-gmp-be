import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  CapaListQueryDto,
  CompleteCapaEffectivenessReviewDto,
  CompleteCapaActionDto,
  CreateCapaDto,
  ScheduleCapaEffectivenessReviewDto,
} from './dto/capa-request.dto.js';
import type {
  CapaActionResponseDto,
  CapaDetailResponseDto,
  CapaEffectivenessReviewResponseDto,
  CapaSummaryResponseDto,
} from './dto/capa-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const deviationSummary = {
  id: true,
  code: true,
  title: true,
  severity: true,
} as const;
const capaSummaryInclude = {
  deviation: { select: deviationSummary },
  createdByUser: { select: userSummary },
  actions: {
    orderBy: [{ status: 'asc' as const }, { dueAt: 'asc' as const }],
    select: { status: true, dueAt: true },
  },
  effectivenessReview: {
    select: { status: true, decision: true, dueAt: true },
  },
} satisfies Prisma.CapaInclude;
const capaDetailInclude = {
  deviation: { select: deviationSummary },
  investigation: {
    select: {
      id: true,
      rootCause: true,
      capaRationale: true,
      recordHash: true,
    },
  },
  createdByUser: { select: userSummary },
  actions: {
    orderBy: [{ status: 'asc' as const }, { dueAt: 'asc' as const }],
    include: { assignedToUser: { select: userSummary } },
  },
  effectivenessReview: {
    include: {
      assignedToUser: { select: userSummary },
      scheduledByUser: { select: userSummary },
    },
  },
} satisfies Prisma.CapaInclude;

type CapaSummaryRecord = Prisma.CapaGetPayload<{
  include: typeof capaSummaryInclude;
}>;
type CapaDetailRecord = Prisma.CapaGetPayload<{
  include: typeof capaDetailInclude;
}>;

@Injectable()
export class CapasService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  list(
    principal: AuthenticatedPrincipal,
    query: CapaListQueryDto,
  ): Promise<CapaSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const capas = await transaction.capa.findMany({
          where: {
            tenantId: principal.tenantId,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { title: { contains: search, mode: 'insensitive' } },
                    {
                      deviation: {
                        is: {
                          OR: [
                            { code: { contains: search, mode: 'insensitive' } },
                            {
                              title: { contains: search, mode: 'insensitive' },
                            },
                          ],
                        },
                      },
                    },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: { createdAt: 'desc' },
          include: capaSummaryInclude,
        });
        const now = new Date();
        return capas.map((capa) => mapSummary(capa, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    capaId: string,
  ): Promise<CapaDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(await readCapa(transaction, principal.tenantId, capaId)),
    );
  }

  async create(
    principal: AuthenticatedPrincipal,
    input: CreateCapaDto,
    request: RequestMetadata,
  ): Promise<CapaDetailResponseDto> {
    try {
      return await this.tenantUnitOfWork.execute(
        principal.tenantId,
        async (transaction) => {
          const now = new Date();
          const actions = input.actions.map((action) => ({
            ...action,
            dueAt: new Date(action.dueAt),
          }));
          if (actions.some(({ dueAt }) => dueAt.getTime() <= now.getTime())) {
            throw capaInvalid(
              'Every CAPA action due date must be in the future.',
            );
          }

          const deviation = await transaction.deviation.findFirst({
            where: {
              id: input.deviationId,
              tenantId: principal.tenantId,
              status: 'INVESTIGATION_COMPLETED',
            },
            include: {
              investigation: {
                select: { id: true, requiresCapa: true, recordHash: true },
              },
              capa: { select: { id: true } },
            },
          });
          if (!deviation?.investigation?.requiresCapa) {
            throw capaInvalid(
              'A CAPA requires a completed investigation that determined CAPA is required.',
            );
          }
          if (deviation.capa) throw capaConflict();

          const assigneeIds = [
            ...new Set(actions.map(({ assignedToUserId }) => assignedToUserId)),
          ];
          const assignees = await transaction.user.findMany({
            where: {
              id: { in: assigneeIds },
              tenantId: principal.tenantId,
              status: 'ACTIVE',
              userRoles: {
                some: {
                  role: {
                    rolePermissions: {
                      some: { permission: { code: 'capas.execute' } },
                    },
                  },
                },
              },
            },
            select: { id: true },
          });
          if (assignees.length !== assigneeIds.length) {
            throw capaInvalid(
              'Every assignee must be active and permitted to execute CAPA actions.',
            );
          }

          const year = now.getUTCFullYear();
          const sequence = await transaction.capaSequence.upsert({
            where: {
              tenantId_year: { tenantId: principal.tenantId, year },
            },
            create: { tenantId: principal.tenantId, year, lastNumber: 1 },
            update: { lastNumber: { increment: 1 } },
            select: { lastNumber: true },
          });
          const code = `CAPA-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
          const capa = await transaction.capa.create({
            data: {
              tenantId: principal.tenantId,
              deviationId: deviation.id,
              investigationId: deviation.investigation.id,
              code,
              title: input.title,
              objective: input.objective,
              createdByUserId: principal.userId,
              actions: {
                create: actions.map((action) => ({
                  type: action.type,
                  title: action.title,
                  description: action.description,
                  assignedToUserId: action.assignedToUserId,
                  dueAt: action.dueAt,
                })),
              },
            },
            include: capaDetailInclude,
          });
          const locked = await transaction.capa.updateMany({
            where: {
              id: capa.id,
              tenantId: principal.tenantId,
              lockedAt: null,
            },
            data: { lockedAt: new Date() },
          });
          if (locked.count !== 1) throw capaConflict();

          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'CAPA_PLAN_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              capaId: capa.id,
              code,
              deviationId: deviation.id,
              investigationId: deviation.investigation.id,
              investigationRecordHash: deviation.investigation.recordHash,
              actionIds: capa.actions.map(({ id }) => id),
              assigneeUserIds: assigneeIds,
            },
          });
          return mapDetail(
            await readCapa(transaction, principal.tenantId, capa.id),
            now,
          );
        },
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) throw capaConflict();
      throw error;
    }
  }

  async completeAction(
    principal: AuthenticatedPrincipal,
    capaId: string,
    actionId: string,
    input: CompleteCapaActionDto,
    request: RequestMetadata,
  ): Promise<CapaDetailResponseDto> {
    const signer = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      (transaction) =>
        transaction.user.findFirst({
          where: {
            id: principal.userId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
          },
          select: { passwordHash: true },
        }),
    );
    const passwordMatches = signer
      ? await this.passwordHasher
          .verify(signer.passwordHash, input.password)
          .catch(() => false)
      : false;
    if (!passwordMatches) {
      await this.tenantUnitOfWork.execute(principal.tenantId, (transaction) =>
        appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'CAPA_ACTION_REAUTHENTICATION_FAILED',
          outcome: 'FAILURE',
          request,
          metadata: { capaId, actionId },
        }),
      );
      throw reauthenticationFailed();
    }

    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const capa = await readCapa(transaction, principal.tenantId, capaId);
        const action = capa.actions.find(({ id }) => id === actionId);
        if (!action) throw capaNotFound();
        if (action.assignedToUserId !== principal.userId) {
          throw capaActionForbidden();
        }
        if (action.status !== 'OPEN') throw capaConflict();

        const currentSigner = await transaction.user.findFirst({
          where: {
            id: principal.userId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
          },
          select: { passwordHash: true },
        });
        const session = await transaction.session.findFirst({
          where: {
            id: principal.sessionId,
            tenantId: principal.tenantId,
            userId: principal.userId,
            status: 'ACTIVE',
            expiresAt: { gt: now },
          },
          select: { id: true },
        });
        if (
          !currentSigner ||
          currentSigner.passwordHash !== signer?.passwordHash ||
          !session
        ) {
          throw reauthenticationFailed();
        }

        const recordHash = hashRecord({
          schemaVersion: 1,
          capaId: capa.id,
          capaCode: capa.code,
          capaTitle: capa.title,
          capaObjective: capa.objective,
          deviationId: capa.deviationId,
          deviationCode: capa.deviation.code,
          investigationId: capa.investigationId,
          investigationRecordHash: capa.investigation.recordHash,
          actionId: action.id,
          actionType: action.type,
          actionTitle: action.title,
          actionDescription: action.description,
          assignedToUserId: action.assignedToUserId,
          dueAt: action.dueAt.toISOString(),
          planCreatedAt: capa.createdAt.toISOString(),
          completedByUserId: principal.userId,
          sessionId: principal.sessionId,
          meaning: 'ACTION_COMPLETION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          attestationAccepted: true,
          completionComment: input.comment,
          completedAt: now.toISOString(),
        });

        const completed = await transaction.capaAction.updateMany({
          where: {
            id: action.id,
            tenantId: principal.tenantId,
            capaId: capa.id,
            assignedToUserId: principal.userId,
            status: 'OPEN',
          },
          data: {
            status: 'COMPLETED',
            completionSessionId: principal.sessionId,
            meaning: 'ACTION_COMPLETION',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            completionComment: input.comment,
            completedAt: now,
            recordHash,
          },
        });
        if (completed.count !== 1) throw capaConflict();

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          eventType: 'CAPA_ACTION_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            capaId: capa.id,
            code: capa.code,
            actionId: action.id,
            actionType: action.type,
            meaning: 'ACTION_COMPLETION',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            recordHash,
          },
        });
        return mapDetail(
          await readCapa(transaction, principal.tenantId, capa.id),
          now,
        );
      },
    );
  }

  async scheduleEffectivenessReview(
    principal: AuthenticatedPrincipal,
    capaId: string,
    input: ScheduleCapaEffectivenessReviewDto,
    request: RequestMetadata,
  ): Promise<CapaDetailResponseDto> {
    try {
      return await this.tenantUnitOfWork.execute(
        principal.tenantId,
        async (transaction) => {
          const now = new Date();
          const dueAt = new Date(input.dueAt);
          if (dueAt.getTime() <= now.getTime()) {
            throw capaInvalid(
              'The effectiveness review due date must be in the future.',
            );
          }

          const capa = await readCapa(transaction, principal.tenantId, capaId);
          if (
            capa.effectivenessReview ||
            capa.actions.some(({ status }) => status !== 'COMPLETED')
          ) {
            throw capaConflict();
          }
          if (
            capa.actions.some(
              ({ assignedToUserId }) =>
                assignedToUserId === input.assignedToUserId,
            )
          ) {
            throw capaInvalid(
              'The effectiveness reviewer must be independent from CAPA action execution.',
            );
          }

          const reviewer = await transaction.user.findFirst({
            where: {
              id: input.assignedToUserId,
              tenantId: principal.tenantId,
              status: 'ACTIVE',
              userRoles: {
                some: {
                  role: {
                    rolePermissions: {
                      some: {
                        permission: { code: 'capas.verify_effectiveness' },
                      },
                    },
                  },
                },
              },
            },
            select: { id: true },
          });
          if (!reviewer) {
            throw capaInvalid(
              'The effectiveness reviewer must be active and permitted to verify CAPA effectiveness.',
            );
          }

          const review = await transaction.capaEffectivenessReview.create({
            data: {
              tenantId: principal.tenantId,
              capaId: capa.id,
              criterion: input.criterion,
              assignedToUserId: reviewer.id,
              scheduledByUserId: principal.userId,
              dueAt,
            },
            select: { id: true },
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            subjectUserId: reviewer.id,
            eventType: 'CAPA_EFFECTIVENESS_REVIEW_SCHEDULED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              capaId: capa.id,
              code: capa.code,
              effectivenessReviewId: review.id,
              assignedToUserId: reviewer.id,
              dueAt: dueAt.toISOString(),
            },
          });
          return mapDetail(
            await readCapa(transaction, principal.tenantId, capa.id),
            now,
          );
        },
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) throw capaConflict();
      throw error;
    }
  }

  async completeEffectivenessReview(
    principal: AuthenticatedPrincipal,
    capaId: string,
    input: CompleteCapaEffectivenessReviewDto,
    request: RequestMetadata,
  ): Promise<CapaDetailResponseDto> {
    const signer = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      (transaction) =>
        transaction.user.findFirst({
          where: {
            id: principal.userId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
          },
          select: { passwordHash: true },
        }),
    );
    const passwordMatches = signer
      ? await this.passwordHasher
          .verify(signer.passwordHash, input.password)
          .catch(() => false)
      : false;
    if (!passwordMatches) {
      await this.tenantUnitOfWork.execute(principal.tenantId, (transaction) =>
        appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'CAPA_EFFECTIVENESS_REAUTHENTICATION_FAILED',
          outcome: 'FAILURE',
          request,
          metadata: { capaId },
        }),
      );
      throw reauthenticationFailed();
    }

    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const capa = await readCapa(transaction, principal.tenantId, capaId);
        const review = capa.effectivenessReview;
        if (!review || review.status !== 'SCHEDULED') throw capaConflict();
        if (review.assignedToUserId !== principal.userId) {
          throw capaEffectivenessForbidden();
        }
        if (capa.actions.some(({ status }) => status !== 'COMPLETED')) {
          throw capaConflict();
        }

        const currentSigner = await transaction.user.findFirst({
          where: {
            id: principal.userId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
          },
          select: { passwordHash: true },
        });
        const session = await transaction.session.findFirst({
          where: {
            id: principal.sessionId,
            tenantId: principal.tenantId,
            userId: principal.userId,
            status: 'ACTIVE',
            expiresAt: { gt: now },
          },
          select: { id: true },
        });
        if (
          !currentSigner ||
          currentSigner.passwordHash !== signer?.passwordHash ||
          !session
        ) {
          throw reauthenticationFailed();
        }

        const actionEvidence = [...capa.actions]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(({ id, recordHash }) => ({ id, recordHash }));
        const recordHash = hashRecord({
          schemaVersion: 1,
          effectivenessReviewId: review.id,
          capaId: capa.id,
          capaCode: capa.code,
          deviationId: capa.deviationId,
          deviationCode: capa.deviation.code,
          investigationId: capa.investigationId,
          investigationRecordHash: capa.investigation.recordHash,
          actionEvidence,
          criterion: review.criterion,
          dueAt: review.dueAt.toISOString(),
          assignedToUserId: review.assignedToUserId,
          scheduledByUserId: review.scheduledByUserId,
          scheduledAt: review.createdAt.toISOString(),
          decision: input.decision,
          evidence: input.evidence,
          completedByUserId: principal.userId,
          sessionId: principal.sessionId,
          meaning: 'EFFECTIVENESS_VERIFICATION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          attestationAccepted: true,
          completedAt: now.toISOString(),
        });

        const completed = await transaction.capaEffectivenessReview.updateMany({
          where: {
            id: review.id,
            tenantId: principal.tenantId,
            capaId: capa.id,
            assignedToUserId: principal.userId,
            status: 'SCHEDULED',
          },
          data: {
            status: 'COMPLETED',
            decision: input.decision,
            evidence: input.evidence,
            completionSessionId: principal.sessionId,
            meaning: 'EFFECTIVENESS_VERIFICATION',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            completedAt: now,
            recordHash,
          },
        });
        if (completed.count !== 1) throw capaConflict();

        let deviationClosed = false;
        if (input.decision === 'EFFECTIVE') {
          const closure = await transaction.deviation.updateMany({
            where: {
              id: capa.deviationId,
              tenantId: principal.tenantId,
              status: 'INVESTIGATION_COMPLETED',
            },
            data: { status: 'CLOSED' },
          });
          if (closure.count !== 1) throw capaConflict();
          deviationClosed = true;
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          eventType: 'CAPA_EFFECTIVENESS_REVIEW_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            capaId: capa.id,
            code: capa.code,
            effectivenessReviewId: review.id,
            decision: input.decision,
            deviationId: capa.deviationId,
            deviationClosed,
            meaning: 'EFFECTIVENESS_VERIFICATION',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            recordHash,
          },
        });
        return mapDetail(
          await readCapa(transaction, principal.tenantId, capa.id),
          now,
        );
      },
    );
  }
}

async function readCapa(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  capaId: string,
): Promise<CapaDetailRecord> {
  const capa = await transaction.capa.findFirst({
    where: { id: capaId, tenantId },
    include: capaDetailInclude,
  });
  if (!capa) throw capaNotFound();
  return capa;
}

function mapSummary(
  capa: CapaSummaryRecord | CapaDetailRecord,
  now = new Date(),
): CapaSummaryResponseDto {
  const completedActionCount = capa.actions.filter(
    ({ status }) => status === 'COMPLETED',
  ).length;
  const openActions = capa.actions.filter(({ status }) => status === 'OPEN');
  const nextDueAt = openActions.reduce<Date | null>(
    (earliest, action) =>
      !earliest || action.dueAt.getTime() < earliest.getTime()
        ? action.dueAt
        : earliest,
    null,
  );
  const review = capa.effectivenessReview;
  return {
    id: capa.id,
    code: capa.code,
    title: capa.title,
    status: aggregateStatus(
      completedActionCount,
      capa.actions.length,
      review?.status ?? null,
      review?.decision ?? null,
    ),
    dueState:
      openActions.length > 0
        ? aggregateDueState(openActions, now)
        : review?.status === 'SCHEDULED'
          ? actionDueState('OPEN', review.dueAt, now)
          : 'COMPLETED',
    deviation: capa.deviation,
    createdBy: capa.createdByUser,
    actionCount: capa.actions.length,
    completedActionCount,
    nextDueAt:
      nextDueAt?.toISOString() ??
      (review?.status === 'SCHEDULED' ? review.dueAt.toISOString() : null),
    effectivenessDueAt: review?.dueAt.toISOString() ?? null,
    effectivenessDecision: review?.decision ?? null,
    createdAt: capa.createdAt.toISOString(),
  };
}

function mapDetail(
  capa: CapaDetailRecord,
  now = new Date(),
): CapaDetailResponseDto {
  return {
    ...mapSummary(capa, now),
    objective: capa.objective,
    investigationId: capa.investigation.id,
    rootCause: capa.investigation.rootCause,
    capaRationale: capa.investigation.capaRationale,
    investigationRecordHash: capa.investigation.recordHash,
    actions: capa.actions.map((action) => mapAction(action, now)),
    effectivenessReview: capa.effectivenessReview
      ? mapEffectivenessReview(capa.effectivenessReview, now)
      : null,
  };
}

function mapEffectivenessReview(
  review: NonNullable<CapaDetailRecord['effectivenessReview']>,
  now: Date,
): CapaEffectivenessReviewResponseDto {
  return {
    id: review.id,
    criterion: review.criterion,
    assignedTo: review.assignedToUser,
    scheduledBy: review.scheduledByUser,
    dueAt: review.dueAt.toISOString(),
    status: review.status,
    dueState: actionDueState(
      review.status === 'COMPLETED' ? 'COMPLETED' : 'OPEN',
      review.dueAt,
      now,
    ),
    decision: review.decision,
    evidence: review.evidence,
    meaning: review.meaning,
    authenticationMethod: review.authenticationMethod,
    completedAt: review.completedAt?.toISOString() ?? null,
    recordHash: review.recordHash,
    createdAt: review.createdAt.toISOString(),
  };
}

function mapAction(
  action: CapaDetailRecord['actions'][number],
  now: Date,
): CapaActionResponseDto {
  return {
    id: action.id,
    type: action.type,
    title: action.title,
    description: action.description,
    assignedTo: action.assignedToUser,
    dueAt: action.dueAt.toISOString(),
    status: action.status,
    dueState: actionDueState(action.status, action.dueAt, now),
    meaning: action.meaning,
    authenticationMethod: action.authenticationMethod,
    completionComment: action.completionComment,
    completedAt: action.completedAt?.toISOString() ?? null,
    recordHash: action.recordHash,
    createdAt: action.createdAt.toISOString(),
  };
}

function aggregateDueState(
  openActions: { dueAt: Date }[],
  now: Date,
): 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' {
  if (openActions.length === 0) return 'COMPLETED';
  return openActions.reduce<'ON_TRACK' | 'DUE_SOON' | 'OVERDUE'>(
    (state, action) => {
      const current = actionDueState('OPEN', action.dueAt, now);
      if (current === 'OVERDUE' || state === 'OVERDUE') return 'OVERDUE';
      if (current === 'DUE_SOON' || state === 'DUE_SOON') return 'DUE_SOON';
      return 'ON_TRACK';
    },
    'ON_TRACK',
  );
}

function aggregateStatus(
  completedActionCount: number,
  actionCount: number,
  reviewStatus: 'SCHEDULED' | 'COMPLETED' | null,
  decision: 'EFFECTIVE' | 'INEFFECTIVE' | null,
):
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'IMPLEMENTATION_COMPLETED'
  | 'EFFECTIVENESS_REVIEW'
  | 'CLOSED_EFFECTIVE'
  | 'INEFFECTIVE' {
  if (completedActionCount < actionCount) {
    return completedActionCount > 0 ? 'IN_PROGRESS' : 'OPEN';
  }
  if (!reviewStatus) return 'IMPLEMENTATION_COMPLETED';
  if (reviewStatus === 'SCHEDULED') return 'EFFECTIVENESS_REVIEW';
  return decision === 'EFFECTIVE' ? 'CLOSED_EFFECTIVE' : 'INEFFECTIVE';
}

function actionDueState(
  status: 'OPEN' | 'COMPLETED',
  dueAt: Date,
  now: Date,
): 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  const dueSoonThreshold = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  return dueAt.getTime() <= dueSoonThreshold ? 'DUE_SOON' : 'ON_TRACK';
}

function capaNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.CapaNotFound,
    'The CAPA plan or action was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function capaInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.CapaInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function capaConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.CapaConflict,
    'The CAPA plan or action changed. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function capaActionForbidden(): ApplicationError {
  return new ApplicationError(
    ErrorCode.CapaActionForbidden,
    'Only the assigned user can complete this CAPA action.',
    HttpStatus.FORBIDDEN,
  );
}

function capaEffectivenessForbidden(): ApplicationError {
  return new ApplicationError(
    ErrorCode.CapaEffectivenessForbidden,
    'Only the assigned independent reviewer can complete this effectiveness review.',
    HttpStatus.FORBIDDEN,
  );
}

function reauthenticationFailed(): ApplicationError {
  return new ApplicationError(
    ErrorCode.ReauthenticationFailed,
    'Reauthentication failed.',
    HttpStatus.FORBIDDEN,
  );
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002',
  );
}
