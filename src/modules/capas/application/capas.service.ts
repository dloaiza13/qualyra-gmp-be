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
  ApproveCapaActionExtensionDto,
  CapaListQueryDto,
  CompleteCapaEffectivenessReviewDto,
  CompleteCapaActionDto,
  CreateCapaDto,
  CreateCapaFollowUpCycleDto,
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
    select: {
      status: true,
      dueAt: true,
      followUpCycle: { select: { cycleNumber: true } },
      extensions: {
        orderBy: [{ approvedAt: 'desc' as const }, { id: 'desc' as const }],
        take: 1,
        select: { newDueAt: true },
      },
    },
  },
  effectivenessReviews: {
    orderBy: { cycleNumber: 'desc' as const },
    select: { cycleNumber: true, status: true, decision: true, dueAt: true },
  },
  followUpCycles: { select: { cycleNumber: true } },
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
    include: {
      assignedToUser: { select: userSummary },
      followUpCycle: { select: { cycleNumber: true } },
      extensions: {
        orderBy: [{ approvedAt: 'asc' as const }, { id: 'asc' as const }],
        include: { approvedByUser: { select: userSummary } },
      },
      evidenceReferences: { orderBy: { createdAt: 'asc' as const } },
    },
  },
  effectivenessReviews: {
    orderBy: { cycleNumber: 'asc' as const },
    include: {
      assignedToUser: { select: userSummary },
      scheduledByUser: { select: userSummary },
    },
  },
  followUpCycles: {
    orderBy: { cycleNumber: 'asc' as const },
    include: { createdByUser: { select: userSummary } },
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

  async createFollowUpCycle(
    principal: AuthenticatedPrincipal,
    capaId: string,
    input: CreateCapaFollowUpCycleDto,
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
              'Every follow-up action due date must be in the future.',
            );
          }

          const capa = await readCapa(transaction, principal.tenantId, capaId);
          const sourceReview = capa.effectivenessReviews.at(-1);
          if (
            !sourceReview ||
            sourceReview.status !== 'COMPLETED' ||
            sourceReview.decision !== 'INEFFECTIVE' ||
            capa.followUpCycles.some(
              ({ sourceEffectivenessReviewId }) =>
                sourceEffectivenessReviewId === sourceReview.id,
            )
          ) {
            throw capaConflict();
          }

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

          const cycleNumber = sourceReview.cycleNumber + 1;
          const cycle = await transaction.capaFollowUpCycle.create({
            data: {
              tenantId: principal.tenantId,
              capaId: capa.id,
              sourceEffectivenessReviewId: sourceReview.id,
              cycleNumber,
              rationale: input.rationale,
              createdByUserId: principal.userId,
              createdAt: now,
            },
            select: { id: true },
          });
          await transaction.capaAction.createMany({
            data: actions.map((action) => ({
              tenantId: principal.tenantId,
              capaId: capa.id,
              followUpCycleId: cycle.id,
              type: action.type,
              title: action.title,
              description: action.description,
              assignedToUserId: action.assignedToUserId,
              dueAt: action.dueAt,
            })),
          });
          const locked = await transaction.capaFollowUpCycle.updateMany({
            where: {
              id: cycle.id,
              tenantId: principal.tenantId,
              lockedAt: null,
            },
            data: { lockedAt: now },
          });
          if (locked.count !== 1) throw capaConflict();

          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'CAPA_FOLLOW_UP_CYCLE_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              capaId: capa.id,
              code: capa.code,
              cycleId: cycle.id,
              cycleNumber,
              sourceEffectivenessReviewId: sourceReview.id,
              assigneeUserIds: assigneeIds,
              actionCount: actions.length,
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

  async approveActionExtension(
    principal: AuthenticatedPrincipal,
    capaId: string,
    actionId: string,
    input: ApproveCapaActionExtensionDto,
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
          eventType: 'CAPA_ACTION_EXTENSION_REAUTHENTICATION_FAILED',
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
        const newDueAt = new Date(input.newDueAt);
        await transaction.$queryRaw`
          SELECT "id"
          FROM "capa_actions"
          WHERE "tenant_id" = ${principal.tenantId}::uuid
            AND "capa_id" = ${capaId}::uuid
            AND "id" = ${actionId}::uuid
          FOR UPDATE
        `;
        const capa = await readCapa(transaction, principal.tenantId, capaId);
        const action = capa.actions.find(({ id }) => id === actionId);
        if (!action) throw capaNotFound();
        if (action.status !== 'OPEN') throw capaConflict();
        if (action.assignedToUserId === principal.userId) {
          throw capaInvalid(
            'The extension approver must be independent from the action assignee.',
          );
        }
        const previousDueAt = effectiveActionDueAt(action);
        if (
          newDueAt.getTime() <= now.getTime() ||
          newDueAt.getTime() <= previousDueAt.getTime()
        ) {
          throw capaInvalid(
            'The approved extension date must be later than the current due date and in the future.',
          );
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

        const recordHash = hashRecord({
          schemaVersion: 1,
          capaId: capa.id,
          capaCode: capa.code,
          actionId: action.id,
          actionTitle: action.title,
          assignedToUserId: action.assignedToUserId,
          previousDueAt: previousDueAt.toISOString(),
          newDueAt: newDueAt.toISOString(),
          reason: input.reason,
          approvedByUserId: principal.userId,
          sessionId: principal.sessionId,
          meaning: 'ACTION_EXTENSION_APPROVAL',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          attestationAccepted: true,
          approvedAt: now.toISOString(),
        });
        const extension = await transaction.capaActionExtension.create({
          data: {
            tenantId: principal.tenantId,
            capaId: capa.id,
            actionId: action.id,
            previousDueAt,
            newDueAt,
            reason: input.reason,
            approvedByUserId: principal.userId,
            approvalSessionId: principal.sessionId,
            meaning: 'ACTION_EXTENSION_APPROVAL',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            approvedAt: now,
            recordHash,
          },
          select: { id: true },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: action.assignedToUserId,
          eventType: 'CAPA_ACTION_EXTENSION_APPROVED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            capaId: capa.id,
            actionId: action.id,
            extensionId: extension.id,
            previousDueAt: previousDueAt.toISOString(),
            newDueAt: newDueAt.toISOString(),
            meaning: 'ACTION_EXTENSION_APPROVAL',
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
        await transaction.$queryRaw`
          SELECT "id"
          FROM "capa_actions"
          WHERE "tenant_id" = ${principal.tenantId}::uuid
            AND "capa_id" = ${capaId}::uuid
            AND "id" = ${actionId}::uuid
          FOR UPDATE
        `;
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

        const evidenceReferences = [...(input.evidenceReferences ?? [])].sort(
          (left, right) =>
            left.storageReference.localeCompare(right.storageReference),
        );
        if (
          new Set(
            evidenceReferences.map(({ storageReference }) => storageReference),
          ).size !== evidenceReferences.length
        ) {
          throw capaInvalid(
            'Each evidence storage reference must be unique within an action completion.',
          );
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
          effectiveDueAt: effectiveActionDueAt(action).toISOString(),
          extensionEvidence: action.extensions.map(
            ({ id, newDueAt, recordHash: extensionRecordHash }) => ({
              id,
              newDueAt: newDueAt.toISOString(),
              recordHash: extensionRecordHash,
            }),
          ),
          evidenceReferences,
          planCreatedAt: capa.createdAt.toISOString(),
          completedByUserId: principal.userId,
          sessionId: principal.sessionId,
          meaning: 'ACTION_COMPLETION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          attestationAccepted: true,
          completionComment: input.comment,
          completedAt: now.toISOString(),
        });

        if (evidenceReferences.length > 0) {
          await transaction.capaActionEvidenceReference.createMany({
            data: evidenceReferences.map((reference) => ({
              tenantId: principal.tenantId,
              capaId: capa.id,
              actionId: action.id,
              ...reference,
            })),
          });
        }

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
            evidenceReferenceCount: evidenceReferences.length,
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
          const cycleNumber = capa.followUpCycles.at(-1)?.cycleNumber ?? 0;
          const cycleActions = actionsForCycle(capa.actions, cycleNumber);
          if (
            cycleActions.length === 0 ||
            cycleActions.some(({ status }) => status !== 'COMPLETED') ||
            capa.effectivenessReviews.some(
              (review) => review.cycleNumber === cycleNumber,
            )
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
              cycleNumber,
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
              cycleNumber,
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
        const review = capa.effectivenessReviews.at(-1);
        if (!review || review.status !== 'SCHEDULED') throw capaConflict();
        if (review.assignedToUserId !== principal.userId) {
          throw capaEffectivenessForbidden();
        }
        const cycleActions = actionsForCycle(capa.actions, review.cycleNumber);
        if (
          cycleActions.length === 0 ||
          cycleActions.some(({ status }) => status !== 'COMPLETED')
        ) {
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

        const actionEvidence = [...cycleActions]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(({ id, recordHash }) => ({ id, recordHash }));
        const recordHash = hashRecord({
          schemaVersion: 1,
          effectivenessReviewId: review.id,
          cycleNumber: review.cycleNumber,
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
            cycleNumber: review.cycleNumber,
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
  const currentCycleNumber = capa.followUpCycles.reduce(
    (latest, cycle) => Math.max(latest, cycle.cycleNumber),
    0,
  );
  const currentActions = actionsForCycle(capa.actions, currentCycleNumber);
  const completedActionCount = capa.actions.filter(
    ({ status }) => status === 'COMPLETED',
  ).length;
  const completedCurrentActionCount = currentActions.filter(
    ({ status }) => status === 'COMPLETED',
  ).length;
  const openActions = currentActions.filter(({ status }) => status === 'OPEN');
  const nextDueAt = openActions.reduce<Date | null>(
    (earliest, action) =>
      !earliest || effectiveActionDueAt(action).getTime() < earliest.getTime()
        ? effectiveActionDueAt(action)
        : earliest,
    null,
  );
  const review = latestEffectivenessReview(capa.effectivenessReviews);
  return {
    id: capa.id,
    code: capa.code,
    title: capa.title,
    status: aggregateStatus(
      currentCycleNumber,
      completedCurrentActionCount,
      currentActions.length,
      review?.status ?? null,
      review?.decision ?? null,
      review?.cycleNumber ?? null,
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
    currentCycleNumber,
    followUpCycleCount: capa.followUpCycles.length,
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
    effectivenessReview: capa.effectivenessReviews.at(-1)
      ? mapEffectivenessReview(capa.effectivenessReviews.at(-1)!, now)
      : null,
    effectivenessReviews: capa.effectivenessReviews.map((review) =>
      mapEffectivenessReview(review, now),
    ),
    followUpCycles: capa.followUpCycles.map((cycle) => ({
      id: cycle.id,
      cycleNumber: cycle.cycleNumber,
      rationale: cycle.rationale,
      sourceEffectivenessReviewId: cycle.sourceEffectivenessReviewId,
      createdBy: cycle.createdByUser,
      createdAt: cycle.createdAt.toISOString(),
      lockedAt: cycle.lockedAt!.toISOString(),
    })),
  };
}

function mapEffectivenessReview(
  review: CapaDetailRecord['effectivenessReviews'][number],
  now: Date,
): CapaEffectivenessReviewResponseDto {
  return {
    id: review.id,
    cycleNumber: review.cycleNumber,
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
  const effectiveDueAt = effectiveActionDueAt(action);
  return {
    id: action.id,
    type: action.type,
    title: action.title,
    description: action.description,
    assignedTo: action.assignedToUser,
    dueAt: action.dueAt.toISOString(),
    effectiveDueAt: effectiveDueAt.toISOString(),
    followUpCycleNumber: action.followUpCycle?.cycleNumber ?? null,
    status: action.status,
    dueState: actionDueState(action.status, effectiveDueAt, now),
    meaning: action.meaning,
    authenticationMethod: action.authenticationMethod,
    completionComment: action.completionComment,
    completedAt: action.completedAt?.toISOString() ?? null,
    recordHash: action.recordHash,
    createdAt: action.createdAt.toISOString(),
    extensions: action.extensions.map((extension) => ({
      id: extension.id,
      previousDueAt: extension.previousDueAt.toISOString(),
      newDueAt: extension.newDueAt.toISOString(),
      reason: extension.reason,
      approvedBy: extension.approvedByUser,
      meaning: extension.meaning,
      authenticationMethod: extension.authenticationMethod,
      approvedAt: extension.approvedAt.toISOString(),
      recordHash: extension.recordHash,
    })),
    evidenceReferences: action.evidenceReferences.map((reference) => ({
      id: reference.id,
      fileName: reference.fileName,
      contentType: reference.contentType,
      sizeBytes: reference.sizeBytes,
      sha256: reference.sha256,
      storageReference: reference.storageReference,
      createdAt: reference.createdAt.toISOString(),
    })),
  };
}

function aggregateDueState(
  openActions: {
    dueAt: Date;
    extensions: { newDueAt: Date }[];
  }[],
  now: Date,
): 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'ESCALATED' | 'COMPLETED' {
  if (openActions.length === 0) return 'COMPLETED';
  return openActions.reduce<'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'ESCALATED'>(
    (state, action) => {
      const current = actionDueState('OPEN', effectiveActionDueAt(action), now);
      if (current === 'ESCALATED' || state === 'ESCALATED') return 'ESCALATED';
      if (current === 'OVERDUE' || state === 'OVERDUE') return 'OVERDUE';
      if (current === 'DUE_SOON' || state === 'DUE_SOON') return 'DUE_SOON';
      return 'ON_TRACK';
    },
    'ON_TRACK',
  );
}

function aggregateStatus(
  currentCycleNumber: number,
  completedActionCount: number,
  actionCount: number,
  reviewStatus: 'SCHEDULED' | 'COMPLETED' | null,
  decision: 'EFFECTIVE' | 'INEFFECTIVE' | null,
  reviewCycleNumber: number | null,
):
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'IMPLEMENTATION_COMPLETED'
  | 'FOLLOW_UP_ACTIONS'
  | 'FOLLOW_UP_IMPLEMENTATION_COMPLETED'
  | 'EFFECTIVENESS_REVIEW'
  | 'CLOSED_EFFECTIVE'
  | 'INEFFECTIVE' {
  if (
    reviewCycleNumber === currentCycleNumber &&
    reviewStatus === 'SCHEDULED'
  ) {
    return 'EFFECTIVENESS_REVIEW';
  }
  if (
    reviewCycleNumber === currentCycleNumber &&
    reviewStatus === 'COMPLETED'
  ) {
    return decision === 'EFFECTIVE' ? 'CLOSED_EFFECTIVE' : 'INEFFECTIVE';
  }
  if (completedActionCount < actionCount) {
    if (currentCycleNumber > 0) return 'FOLLOW_UP_ACTIONS';
    return completedActionCount > 0 ? 'IN_PROGRESS' : 'OPEN';
  }
  return currentCycleNumber > 0
    ? 'FOLLOW_UP_IMPLEMENTATION_COMPLETED'
    : 'IMPLEMENTATION_COMPLETED';
}

function actionDueState(
  status: 'OPEN' | 'COMPLETED',
  dueAt: Date,
  now: Date,
): 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'ESCALATED' | 'COMPLETED' {
  if (status === 'COMPLETED') return 'COMPLETED';
  const overdueEscalationThreshold = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (dueAt.getTime() < overdueEscalationThreshold) return 'ESCALATED';
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  const dueSoonThreshold = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  return dueAt.getTime() <= dueSoonThreshold ? 'DUE_SOON' : 'ON_TRACK';
}

function effectiveActionDueAt(action: {
  dueAt: Date;
  extensions: { newDueAt: Date }[];
}): Date {
  return action.extensions.at(-1)?.newDueAt ?? action.dueAt;
}

function actionsForCycle<
  T extends { followUpCycle: { cycleNumber: number } | null },
>(actions: T[], cycleNumber: number): T[] {
  return actions.filter(
    (action) => (action.followUpCycle?.cycleNumber ?? 0) === cycleNumber,
  );
}

function latestEffectivenessReview<T extends { cycleNumber: number }>(
  reviews: T[],
): T | undefined {
  return reviews.reduce<T | undefined>(
    (latest, review) =>
      !latest || review.cycleNumber > latest.cycleNumber ? review : latest,
    undefined,
  );
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
