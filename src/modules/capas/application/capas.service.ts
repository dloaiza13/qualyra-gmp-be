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
  CompleteCapaActionDto,
  CreateCapaDto,
} from './dto/capa-request.dto.js';
import type {
  CapaActionResponseDto,
  CapaDetailResponseDto,
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
  return {
    id: capa.id,
    code: capa.code,
    title: capa.title,
    status:
      completedActionCount === capa.actions.length
        ? 'IMPLEMENTATION_COMPLETED'
        : completedActionCount > 0
          ? 'IN_PROGRESS'
          : 'OPEN',
    dueState: aggregateDueState(openActions, now),
    deviation: capa.deviation,
    createdBy: capa.createdByUser,
    actionCount: capa.actions.length,
    completedActionCount,
    nextDueAt: nextDueAt?.toISOString() ?? null,
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
