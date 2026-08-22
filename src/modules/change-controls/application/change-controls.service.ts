import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { changeAccessWhere } from '../../authorization/application/record-access.policy.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  AssessChangeControlDto,
  CancelChangeControlDto,
  ChangeControlListQueryDto,
  CompleteChangeTaskDto,
  CreateChangeControlDto,
  DecideChangeControlDto,
  VerifyChangeControlDto,
} from './dto/change-control-request.dto.js';
import type {
  ChangeControlDetailResponseDto,
  ChangeControlSummaryResponseDto,
} from './dto/change-control-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const changeControlInclude = {
  proposedByUser: { select: userSummary },
  assessment: {
    include: {
      assessedByUser: { select: userSummary },
      ownerUser: { select: userSummary },
      approverUser: { select: userSummary },
      verifierUser: { select: userSummary },
    },
  },
  decision: { include: { decidedByUser: { select: userSummary } } },
  tasks: {
    orderBy: [{ dueAt: 'asc' as const }, { createdAt: 'asc' as const }],
    include: { assignedToUser: { select: userSummary } },
  },
  verification: { include: { verifiedByUser: { select: userSummary } } },
} satisfies Prisma.ChangeControlInclude;
type ChangeControlRecord = Prisma.ChangeControlGetPayload<{
  include: typeof changeControlInclude;
}>;

@Injectable()
export class ChangeControlsService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  listParticipants(
    principal: AuthenticatedPrincipal,
  ): Promise<
    { id: string; displayName: string; email: string; permissions: string[] }[]
  > {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const users = await transaction.user.findMany({
          where: { tenantId: principal.tenantId, status: 'ACTIVE' },
          orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
          select: {
            id: true,
            displayName: true,
            email: true,
            userRoles: {
              select: {
                role: {
                  select: {
                    name: true,
                    isSystem: true,
                    rolePermissions: {
                      select: { permission: { select: { code: true } } },
                    },
                  },
                },
              },
            },
          },
        });
        const changePermissions = [
          'changes.read',
          'changes.create',
          'changes.assess',
          'changes.approve',
          'changes.implement',
          'changes.verify',
        ];
        return users.map((user) => {
          const administrator = user.userRoles.some(
            ({ role }) => role.isSystem && role.name === 'Administrator',
          );
          const permissions = administrator
            ? changePermissions
            : [
                ...new Set(
                  user.userRoles.flatMap(({ role }) =>
                    role.rolePermissions.map(
                      ({ permission }) => permission.code,
                    ),
                  ),
                ),
              ].filter((code) => code.startsWith('changes.'));
          return {
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            permissions,
          };
        });
      },
    );
  }

  list(
    principal: AuthenticatedPrincipal,
    query: ChangeControlListQueryDto,
  ): Promise<ChangeControlSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const records = await transaction.changeControl.findMany({
          where: {
            tenantId: principal.tenantId,
            AND: [changeAccessWhere(principal)],
            status: query.status,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { title: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          include: changeControlInclude,
        });
        const now = new Date();
        return records.map((record) => mapSummary(record, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    changeControlId: string,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(
          await readChangeControl(
            transaction,
            principal.tenantId,
            changeControlId,
            changeAccessWhere(principal),
          ),
        ),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateChangeControlDto,
    request: RequestMetadata,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const targetCompletionAt = futureDate(
          input.targetCompletionAt,
          now,
          'The target completion date must be in the future.',
        );
        const year = now.getUTCFullYear();
        const sequence = await transaction.changeControlSequence.upsert({
          where: { tenantId_year: { tenantId: principal.tenantId, year } },
          create: { tenantId: principal.tenantId, year, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const code = `CC-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const created = await transaction.changeControl.create({
          data: {
            tenantId: principal.tenantId,
            code,
            title: input.title,
            description: input.description,
            justification: input.justification,
            category: input.category,
            proposedByUserId: principal.userId,
            targetCompletionAt,
          },
          include: changeControlInclude,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'CHANGE_CONTROL_PROPOSED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            changeControlId: created.id,
            code,
            category: created.category,
          },
        });
        return mapDetail(created);
      },
    );
  }

  assess(
    principal: AuthenticatedPrincipal,
    changeControlId: string,
    input: AssessChangeControlDto,
    request: RequestMetadata,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const change = await readChangeControl(
          transaction,
          principal.tenantId,
          changeControlId,
        );
        if (change.status !== 'PROPOSED') throw changeConflict();
        if (change.proposedByUserId === principal.userId) {
          throw changeForbidden('The proposer cannot assess their own change.');
        }
        const participants = [
          principal.userId,
          input.approverUserId,
          input.verifierUserId,
        ];
        if (new Set(participants).size !== participants.length) {
          throw changeInvalid(
            'The assessor, approver, and verifier must be different people.',
          );
        }
        if (
          [
            principal.userId,
            input.approverUserId,
            input.verifierUserId,
          ].includes(change.proposedByUserId)
        ) {
          throw changeInvalid(
            'The proposer cannot assess, approve, or verify the same change.',
          );
        }
        if (input.ownerUserId === input.verifierUserId) {
          throw changeInvalid(
            'The change owner and verifier must be different.',
          );
        }

        await Promise.all([
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.ownerUserId,
            'changes.implement',
            'owner',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.approverUserId,
            'changes.approve',
            'approver',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.verifierUserId,
            'changes.verify',
            'verifier',
          ),
          ...[
            ...new Set(
              input.tasks.map(({ assignedToUserId }) => assignedToUserId),
            ),
          ].map((userId) =>
            assertEligibleUser(
              transaction,
              principal.tenantId,
              userId,
              'changes.implement',
              'task assignee',
            ),
          ),
        ]);

        const now = new Date();
        const tasks = input.tasks.map((task) => {
          if (task.assignedToUserId === input.verifierUserId) {
            throw changeInvalid('The verifier cannot implement change tasks.');
          }
          const dueAt = futureDate(
            task.dueAt,
            now,
            'Every task due date must be in the future.',
          );
          if (dueAt.getTime() > change.targetCompletionAt.getTime()) {
            throw changeInvalid(
              'Task due dates cannot be later than the change target date.',
            );
          }
          return { ...task, dueAt };
        });

        await transaction.changeControlAssessment.create({
          data: {
            tenantId: principal.tenantId,
            changeControlId: change.id,
            impactSummary: input.impactSummary,
            qualityImpact: input.qualityImpact,
            regulatoryImpact: input.regulatoryImpact,
            validationImpact: input.validationImpact,
            trainingImpact: input.trainingImpact,
            documentImpact: input.documentImpact,
            riskLevel: input.riskLevel,
            riskRationale: input.riskRationale,
            implementationPlan: input.implementationPlan,
            rollbackPlan: input.rollbackPlan,
            assessedByUserId: principal.userId,
            ownerUserId: input.ownerUserId,
            approverUserId: input.approverUserId,
            verifierUserId: input.verifierUserId,
            verificationCriterion: input.verificationCriterion,
            assessedAt: now,
          },
        });
        await transaction.changeControlTask.createMany({
          data: tasks.map((task) => ({
            tenantId: principal.tenantId,
            changeControlId: change.id,
            title: task.title,
            description: task.description,
            assignedToUserId: task.assignedToUserId,
            dueAt: task.dueAt,
          })),
        });
        const transitioned = await transaction.changeControl.updateMany({
          where: {
            id: change.id,
            tenantId: principal.tenantId,
            status: 'PROPOSED',
          },
          data: { status: 'ASSESSED' },
        });
        if (transitioned.count !== 1) throw changeConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.approverUserId,
          eventType: 'CHANGE_CONTROL_ASSESSED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            changeControlId: change.id,
            code: change.code,
            riskLevel: input.riskLevel,
            ownerUserId: input.ownerUserId,
            approverUserId: input.approverUserId,
            verifierUserId: input.verifierUserId,
            taskCount: tasks.length,
          },
        });
        return mapDetail(
          await readChangeControl(transaction, principal.tenantId, change.id),
        );
      },
    );
  }

  cancel(
    principal: AuthenticatedPrincipal,
    changeControlId: string,
    input: CancelChangeControlDto,
    request: RequestMetadata,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const change = await transaction.changeControl.findFirst({
          where: { id: changeControlId, tenantId: principal.tenantId },
          select: { id: true, code: true, status: true },
        });
        if (!change) throw changeNotFound();
        if (change.status !== 'PROPOSED') throw changeConflict();
        const now = new Date();
        const result = await transaction.changeControl.updateMany({
          where: {
            id: change.id,
            tenantId: principal.tenantId,
            status: 'PROPOSED',
          },
          data: {
            status: 'CANCELLED',
            cancelledByUserId: principal.userId,
            cancelledAt: now,
            cancellationReason: input.reason,
          },
        });
        if (result.count !== 1) throw changeConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'CHANGE_CONTROL_CANCELLED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            changeControlId: change.id,
            code: change.code,
            reason: input.reason,
          },
        });
        return mapDetail(
          await readChangeControl(transaction, principal.tenantId, change.id),
        );
      },
    );
  }

  async decide(
    principal: AuthenticatedPrincipal,
    changeControlId: string,
    input: DecideChangeControlDto,
    request: RequestMetadata,
  ): Promise<ChangeControlDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'CHANGE_CONTROL_APPROVAL_REAUTHENTICATION_FAILED',
      { changeControlId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const change = await readChangeControl(
          transaction,
          principal.tenantId,
          changeControlId,
        );
        if (change.status !== 'ASSESSED') throw changeConflict();
        if (change.assessment?.approverUserId !== principal.userId) {
          throw changeForbidden(
            'Only the assigned approver can decide this change.',
          );
        }
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          changeControlId: change.id,
          code: change.code,
          decision: input.decision,
          comment: input.comment,
          decidedByUserId: principal.userId,
          decisionSessionId: principal.sessionId,
          meaning: 'CHANGE_APPROVAL',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          decidedAt: now.toISOString(),
        });
        await transaction.changeControlDecision.create({
          data: {
            id,
            tenantId: principal.tenantId,
            changeControlId: change.id,
            decision: input.decision,
            comment: input.comment,
            decidedByUserId: principal.userId,
            decisionSessionId: principal.sessionId,
            decidedAt: now,
            recordHash,
          },
        });
        const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const transitioned = await transaction.changeControl.updateMany({
          where: {
            id: change.id,
            tenantId: principal.tenantId,
            status: 'ASSESSED',
          },
          data: { status },
        });
        if (transitioned.count !== 1) throw changeConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'CHANGE_CONTROL_APPROVAL_DECIDED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            changeControlId: change.id,
            code: change.code,
            decision: input.decision,
            meaning: 'CHANGE_APPROVAL',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            recordHash,
          },
        });
        return mapDetail(
          await readChangeControl(transaction, principal.tenantId, change.id),
        );
      },
    );
  }

  async completeTask(
    principal: AuthenticatedPrincipal,
    changeControlId: string,
    taskId: string,
    input: CompleteChangeTaskDto,
    request: RequestMetadata,
  ): Promise<ChangeControlDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'CHANGE_CONTROL_TASK_REAUTHENTICATION_FAILED',
      { changeControlId, taskId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const change = await readChangeControl(
          transaction,
          principal.tenantId,
          changeControlId,
        );
        if (!['APPROVED', 'IMPLEMENTING'].includes(change.status)) {
          throw changeConflict();
        }
        const task = change.tasks.find(({ id }) => id === taskId);
        if (!task) throw changeNotFound('The change task was not found.');
        if (task.assignedToUserId !== principal.userId) {
          throw changeForbidden(
            'Only the assigned user can complete this task.',
          );
        }
        if (task.status !== 'OPEN') throw changeConflict();
        const recordHash = hashRecord({
          schemaVersion: 1,
          taskId: task.id,
          changeControlId: change.id,
          code: change.code,
          title: task.title,
          assignedToUserId: principal.userId,
          comment: input.comment,
          completionSessionId: principal.sessionId,
          meaning: 'CHANGE_TASK_COMPLETION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          completedAt: now.toISOString(),
        });
        const completed = await transaction.changeControlTask.updateMany({
          where: {
            id: task.id,
            tenantId: principal.tenantId,
            changeControlId: change.id,
            assignedToUserId: principal.userId,
            status: 'OPEN',
          },
          data: {
            status: 'COMPLETED',
            completionComment: input.comment,
            completionSessionId: principal.sessionId,
            meaning: 'CHANGE_TASK_COMPLETION',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            completedAt: now,
            recordHash,
          },
        });
        if (completed.count !== 1) throw changeConflict();
        const remaining = await transaction.changeControlTask.count({
          where: {
            tenantId: principal.tenantId,
            changeControlId: change.id,
            status: 'OPEN',
          },
        });
        const nextStatus =
          remaining === 0 ? 'PENDING_VERIFICATION' : 'IMPLEMENTING';
        const transitioned = await transaction.changeControl.updateMany({
          where: {
            id: change.id,
            tenantId: principal.tenantId,
            status: change.status,
          },
          data: { status: nextStatus },
        });
        if (transitioned.count !== 1) throw changeConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'CHANGE_CONTROL_TASK_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            changeControlId: change.id,
            code: change.code,
            taskId: task.id,
            remainingTaskCount: remaining,
            recordHash,
          },
        });
        return mapDetail(
          await readChangeControl(transaction, principal.tenantId, change.id),
        );
      },
    );
  }

  async verify(
    principal: AuthenticatedPrincipal,
    changeControlId: string,
    input: VerifyChangeControlDto,
    request: RequestMetadata,
  ): Promise<ChangeControlDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'CHANGE_CONTROL_VERIFICATION_REAUTHENTICATION_FAILED',
      { changeControlId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const change = await readChangeControl(
          transaction,
          principal.tenantId,
          changeControlId,
        );
        if (change.status !== 'PENDING_VERIFICATION') throw changeConflict();
        if (change.assessment?.verifierUserId !== principal.userId) {
          throw changeForbidden(
            'Only the assigned verifier can verify this change.',
          );
        }
        if (change.tasks.some(({ status }) => status !== 'COMPLETED')) {
          throw changeConflict();
        }
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          changeControlId: change.id,
          code: change.code,
          criterion: change.assessment.verificationCriterion,
          decision: input.decision,
          evidence: input.evidence,
          verifiedByUserId: principal.userId,
          verificationSessionId: principal.sessionId,
          meaning: 'CHANGE_VERIFICATION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          verifiedAt: now.toISOString(),
        });
        await transaction.changeControlVerification.create({
          data: {
            id,
            tenantId: principal.tenantId,
            changeControlId: change.id,
            decision: input.decision,
            evidence: input.evidence,
            verifiedByUserId: principal.userId,
            verificationSessionId: principal.sessionId,
            verifiedAt: now,
            recordHash,
          },
        });
        const status =
          input.decision === 'EFFECTIVE' ? 'CLOSED' : 'VERIFICATION_FAILED';
        const transitioned = await transaction.changeControl.updateMany({
          where: {
            id: change.id,
            tenantId: principal.tenantId,
            status: 'PENDING_VERIFICATION',
          },
          data: { status },
        });
        if (transitioned.count !== 1) throw changeConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'CHANGE_CONTROL_VERIFICATION_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            changeControlId: change.id,
            code: change.code,
            decision: input.decision,
            meaning: 'CHANGE_VERIFICATION',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            recordHash,
          },
        });
        return mapDetail(
          await readChangeControl(transaction, principal.tenantId, change.id),
        );
      },
    );
  }

  private async reauthenticate(
    principal: AuthenticatedPrincipal,
    password: string,
    request: RequestMetadata,
    eventType: string,
    metadata: Record<string, unknown>,
  ): Promise<string> {
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
    const matches = signer
      ? await this.passwordHasher
          .verify(signer.passwordHash, password)
          .catch(() => false)
      : false;
    if (!signer || !matches) {
      await this.tenantUnitOfWork.execute(principal.tenantId, (transaction) =>
        appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType,
          outcome: 'FAILURE',
          request,
          metadata: metadata as Prisma.InputJsonObject,
        }),
      );
      throw reauthenticationFailed();
    }
    return signer.passwordHash;
  }
}

async function readChangeControl(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  changeControlId: string,
  accessWhere: Prisma.ChangeControlWhereInput = {},
): Promise<ChangeControlRecord> {
  const record = await transaction.changeControl.findFirst({
    where: { id: changeControlId, tenantId, AND: [accessWhere] },
    include: changeControlInclude,
  });
  if (!record) throw changeNotFound();
  return record;
}

async function assertEligibleUser(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  permissionCode: string,
  label: string,
): Promise<void> {
  const user = await transaction.user.findFirst({
    where: {
      id: userId,
      tenantId,
      status: 'ACTIVE',
      userRoles: {
        some: {
          role: {
            OR: [
              { name: 'Administrator', isSystem: true },
              {
                rolePermissions: {
                  some: { permission: { code: permissionCode } },
                },
              },
            ],
          },
        },
      },
    },
    select: { id: true },
  });
  if (!user) {
    throw changeInvalid(
      `The ${label} must be active and have the required permission.`,
    );
  }
}

async function assertCurrentSigner(
  transaction: Prisma.TransactionClient,
  principal: AuthenticatedPrincipal,
  passwordHash: string,
  now: Date,
): Promise<void> {
  const [user, session] = await Promise.all([
    transaction.user.findFirst({
      where: {
        id: principal.userId,
        tenantId: principal.tenantId,
        status: 'ACTIVE',
      },
      select: { passwordHash: true },
    }),
    transaction.session.findFirst({
      where: {
        id: principal.sessionId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
      select: { id: true },
    }),
  ]);
  if (!user || user.passwordHash !== passwordHash || !session) {
    throw reauthenticationFailed();
  }
}

function mapSummary(
  record: ChangeControlRecord,
  now = new Date(),
): ChangeControlSummaryResponseDto {
  return {
    id: record.id,
    code: record.code,
    title: record.title,
    category: record.category,
    status: record.status,
    dueState: dueState(record.targetCompletionAt, now, record.status),
    proposedBy: record.proposedByUser,
    riskLevel: record.assessment?.riskLevel ?? null,
    targetCompletionAt: record.targetCompletionAt.toISOString(),
    openTaskCount: record.tasks.filter(({ status }) => status === 'OPEN')
      .length,
    totalTaskCount: record.tasks.length,
    createdAt: record.createdAt.toISOString(),
  };
}

function mapDetail(
  record: ChangeControlRecord,
): ChangeControlDetailResponseDto {
  const now = new Date();
  return {
    ...mapSummary(record, now),
    description: record.description,
    justification: record.justification,
    assessment: record.assessment
      ? {
          id: record.assessment.id,
          impactSummary: record.assessment.impactSummary,
          qualityImpact: record.assessment.qualityImpact,
          regulatoryImpact: record.assessment.regulatoryImpact,
          validationImpact: record.assessment.validationImpact,
          trainingImpact: record.assessment.trainingImpact,
          documentImpact: record.assessment.documentImpact,
          riskLevel: record.assessment.riskLevel,
          riskRationale: record.assessment.riskRationale,
          implementationPlan: record.assessment.implementationPlan,
          rollbackPlan: record.assessment.rollbackPlan,
          verificationCriterion: record.assessment.verificationCriterion,
          assessedBy: record.assessment.assessedByUser,
          owner: record.assessment.ownerUser,
          approver: record.assessment.approverUser,
          verifier: record.assessment.verifierUser,
          assessedAt: record.assessment.assessedAt.toISOString(),
        }
      : null,
    decision: record.decision
      ? {
          decision: record.decision.decision,
          comment: record.decision.comment,
          decidedBy: record.decision.decidedByUser,
          meaning: record.decision.meaning,
          authenticationMethod: record.decision.authenticationMethod,
          decidedAt: record.decision.decidedAt.toISOString(),
          recordHash: record.decision.recordHash,
        }
      : null,
    tasks: record.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      assignedTo: task.assignedToUser,
      dueAt: task.dueAt.toISOString(),
      status: task.status,
      dueState: dueState(task.dueAt, now, task.status),
      completionComment: task.completionComment,
      meaning: task.meaning,
      authenticationMethod: task.authenticationMethod,
      completedAt: task.completedAt?.toISOString() ?? null,
      recordHash: task.recordHash,
    })),
    verification: record.verification
      ? {
          decision: record.verification.decision,
          evidence: record.verification.evidence,
          verifiedBy: record.verification.verifiedByUser,
          meaning: record.verification.meaning,
          authenticationMethod: record.verification.authenticationMethod,
          verifiedAt: record.verification.verifiedAt.toISOString(),
          recordHash: record.verification.recordHash,
        }
      : null,
    cancellationReason: record.cancellationReason,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
  };
}

function dueState(
  dueAt: Date,
  now: Date,
  status: string,
): 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' {
  if (
    [
      'COMPLETED',
      'CLOSED',
      'REJECTED',
      'VERIFICATION_FAILED',
      'CANCELLED',
    ].includes(status)
  ) {
    return 'COMPLETED';
  }
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  return dueAt.getTime() <= now.getTime() + 7 * 24 * 60 * 60 * 1000
    ? 'DUE_SOON'
    : 'ON_TRACK';
}

function futureDate(value: string, now: Date, message: string): Date {
  const result = new Date(value);
  if (result.getTime() <= now.getTime()) throw changeInvalid(message);
  return result;
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function changeNotFound(
  message = 'The change control was not found.',
): ApplicationError {
  return new ApplicationError(
    ErrorCode.ChangeControlNotFound,
    message,
    HttpStatus.NOT_FOUND,
  );
}
function changeInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ChangeControlInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}
function changeConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.ChangeControlConflict,
    'The change control changed. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}
function changeForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ChangeControlForbidden,
    message,
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
