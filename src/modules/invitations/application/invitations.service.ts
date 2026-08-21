import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { Environment } from '../../../common/config/environment.js';
import { AccessTokenService } from '../../../infrastructure/crypto/access-token.service.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import {
  SecureTokenService,
  type PersistedToken,
} from '../../../infrastructure/crypto/secure-token.service.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthenticationResult } from '../../authentication/application/authentication.service.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CommercialEntitlementPolicy } from '../../commercial-entitlements/application/commercial-entitlement.policy.js';
import { NotificationOutboxService } from '../../notifications/application/notification-outbox.service.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationTokenDto,
} from './dto/invitation-request.dto.js';
import type {
  InvitationPreviewDto,
  InvitationResponseDto,
} from './dto/invitation-response.dto.js';

const invitationDetails = {
  invitedByUser: { select: { displayName: true } },
  invitationRoles: {
    include: { role: { select: { id: true, name: true } } },
  },
} satisfies Prisma.InvitationInclude;

type InvitationDetails = Prisma.InvitationGetPayload<{
  include: typeof invitationDetails;
}>;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly invitationTtlHours: number;
  private readonly refreshTokenTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly tokens: SecureTokenService,
    private readonly passwordHasher: PasswordHasher,
    private readonly accessTokens: AccessTokenService,
    private readonly outbox: NotificationOutboxService,
    private readonly commercialEntitlements: CommercialEntitlementPolicy,
    config: ConfigService<Environment, true>,
  ) {
    this.invitationTtlHours = config.getOrThrow('INVITATION_TTL_HOURS', {
      infer: true,
    });
    this.refreshTokenTtlDays = config.getOrThrow('REFRESH_TOKEN_TTL_DAYS', {
      infer: true,
    });
  }

  async create(
    principal: AuthenticatedPrincipal,
    input: CreateInvitationDto,
    request: RequestMetadata,
  ): Promise<InvitationResponseDto> {
    const token = this.tokens.create(principal.tenantId);
    const result = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT 1::int AS locked
          FROM pg_advisory_xact_lock(
            hashtextextended(${`${principal.tenantId}:commercial-seat-allocation`}, 0)
          )
        `;
        const existingUser = await transaction.user.count({
          where: { tenantId: principal.tenantId, email: input.email },
        });
        if (existingUser > 0) throw emailExists();

        const roles = await transaction.role.findMany({
          where: { tenantId: principal.tenantId, id: { in: input.roleIds } },
          select: { id: true, name: true },
        });
        if (roles.length !== input.roleIds.length) throw roleInvalid();

        const now = new Date();
        const existingInvitation = await transaction.invitation.findFirst({
          where: {
            tenantId: principal.tenantId,
            email: input.email,
            status: 'PENDING',
          },
          select: { id: true, expiresAt: true },
        });
        if (existingInvitation && existingInvitation.expiresAt > now) {
          throw invitationAlreadyExists();
        }
        if (existingInvitation) {
          await transaction.invitation.update({
            where: { id: existingInvitation.id },
            data: { status: 'EXPIRED' },
          });
        }

        const [tenant, committedUsers, pendingInvitations] = await Promise.all([
          transaction.tenant.findUniqueOrThrow({
            where: { id: principal.tenantId },
            select: {
              name: true,
              slug: true,
              plan: true,
              trialEndsAt: true,
            },
          }),
          transaction.user.count({
            where: {
              tenantId: principal.tenantId,
              status: { not: 'DISABLED' },
            },
          }),
          transaction.invitation.count({
            where: {
              tenantId: principal.tenantId,
              status: 'PENDING',
              expiresAt: { gt: now },
            },
          }),
        ]);
        this.commercialEntitlements.assertCanAllocateSeat(
          tenant,
          committedUsers + pendingInvitations,
          { now },
        );

        const invitation = await transaction.invitation.create({
          data: {
            id: token.id,
            tenantId: principal.tenantId,
            email: input.email,
            tokenHash: token.hash,
            invitedByUserId: principal.userId,
            expiresAt: addHours(now, this.invitationTtlHours),
            invitationRoles: {
              create: roles.map(({ id: roleId }) => ({
                roleId,
              })),
            },
          },
          include: invitationDetails,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'USER_INVITED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            invitationId: invitation.id,
            roleIds: roles.map(({ id }) => id),
          },
        });
        await this.outbox.enqueue(transaction, {
          tenantId: principal.tenantId,
          type: 'AUTH_INVITATION',
          deduplicationKey: `invitation:${invitation.id}:${token.hash}`,
          payload: {
            email: input.email,
            displayName: input.email,
            tenantName: tenant.name,
            tenantSlug: tenant.slug,
            roles: roles.map(({ name }) => name),
            token: token.raw,
          },
        });
        return { invitation, tenant, roles };
      },
    );

    await this.deliverNotificationsSafely(principal.tenantId);
    return mapInvitation(result.invitation);
  }

  list(principal: AuthenticatedPrincipal): Promise<InvitationResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const invitations = await transaction.invitation.findMany({
          where: { tenantId: principal.tenantId },
          orderBy: { createdAt: 'desc' },
          include: invitationDetails,
        });
        return invitations.map(mapInvitation);
      },
    );
  }

  async resend(
    principal: AuthenticatedPrincipal,
    invitationId: string,
    request: RequestMetadata,
  ): Promise<InvitationResponseDto> {
    const token = this.tokens.create(principal.tenantId, invitationId);
    const result = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const invitation = await transaction.invitation.findFirst({
          where: { id: invitationId, tenantId: principal.tenantId },
          include: invitationDetails,
        });
        if (!invitation || invitation.status !== 'PENDING') {
          throw invitationInvalid();
        }

        const now = new Date();
        const updated = await transaction.invitation.updateMany({
          where: {
            id: invitation.id,
            tenantId: principal.tenantId,
            status: 'PENDING',
          },
          data: {
            tokenHash: token.hash,
            expiresAt: addHours(now, this.invitationTtlHours),
            lastSentAt: now,
          },
        });
        if (updated.count !== 1) throw invitationInvalid();

        const refreshedInvitation =
          await transaction.invitation.findUniqueOrThrow({
            where: { id: invitation.id },
            include: invitationDetails,
          });
        const tenant = await transaction.tenant.findUniqueOrThrow({
          where: { id: principal.tenantId },
          select: { name: true, slug: true },
        });
        await this.outbox.cancelPending(transaction, {
          tenantId: principal.tenantId,
          type: 'AUTH_INVITATION',
          deduplicationKeyPrefix: `invitation:${invitation.id}:`,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'INVITATION_RESENT',
          outcome: 'SUCCESS',
          request,
          metadata: { invitationId: invitation.id },
        });

        await this.outbox.enqueue(transaction, {
          tenantId: principal.tenantId,
          type: 'AUTH_INVITATION',
          deduplicationKey: `invitation:${invitation.id}:${token.hash}`,
          payload: {
            email: refreshedInvitation.email,
            displayName: refreshedInvitation.email,
            tenantName: tenant.name,
            tenantSlug: tenant.slug,
            roles: mapRoles(refreshedInvitation).map(({ name }) => name),
            token: token.raw,
          },
        });

        return { invitation: refreshedInvitation, tenant };
      },
    );

    await this.deliverNotificationsSafely(principal.tenantId);
    return mapInvitation(result.invitation);
  }

  async revoke(
    principal: AuthenticatedPrincipal,
    invitationId: string,
    request: RequestMetadata,
  ): Promise<void> {
    await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const invitation = await transaction.invitation.findFirst({
          where: { id: invitationId, tenantId: principal.tenantId },
          select: { id: true, status: true },
        });
        if (!invitation) throw invitationInvalid();
        if (invitation.status !== 'PENDING') return;
        const now = new Date();
        await transaction.invitation.updateMany({
          where: {
            id: invitation.id,
            tenantId: principal.tenantId,
            status: 'PENDING',
          },
          data: { status: 'REVOKED', revokedAt: now },
        });
        await this.outbox.cancelPending(transaction, {
          tenantId: principal.tenantId,
          type: 'AUTH_INVITATION',
          deduplicationKeyPrefix: `invitation:${invitation.id}:`,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'INVITATION_REVOKED',
          outcome: 'SUCCESS',
          request,
          metadata: { invitationId: invitation.id },
        });
      },
    );
  }

  async preview(input: InvitationTokenDto): Promise<InvitationPreviewDto> {
    const parsed = this.tokens.parse(input.token);
    if (!parsed) throw invitationInvalid();
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: parsed.tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) throw invitationInvalid();

    const invitation = await this.tenantUnitOfWork.execute(
      tenant.id,
      (transaction) =>
        transaction.invitation.findFirst({
          where: {
            id: parsed.tokenId,
            tenantId: tenant.id,
            tokenHash: parsed.hash,
            status: 'PENDING',
          },
          include: invitationDetails,
        }),
    );
    if (!invitation) throw invitationInvalid();
    if (invitation.expiresAt <= new Date()) throw invitationExpired();
    return {
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      email: invitation.email,
      roles: mapRoles(invitation),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async accept(
    input: AcceptInvitationDto,
    request: RequestMetadata,
  ): Promise<AuthenticationResult> {
    const parsed = this.tokens.parse(input.token);
    if (!parsed) throw invitationInvalid();
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: parsed.tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) throw invitationInvalid();

    const passwordHash = await this.passwordHasher.hash(input.password);
    const userId = randomUUID();
    const sessionId = randomUUID();
    const refreshToken = this.tokens.create(tenant.id);
    const now = new Date();
    const expiresAt = addDays(now, this.refreshTokenTtlDays);

    let accepted: { email: string } | { expired: true } | undefined;
    try {
      accepted = await this.tenantUnitOfWork.execute(
        tenant.id,
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT 1::int AS locked
            FROM pg_advisory_xact_lock(
              hashtextextended(${`${tenant.id}:commercial-seat-allocation`}, 0)
            )
          `;
          const invitation = await transaction.invitation.findFirst({
            where: {
              id: parsed.tokenId,
              tenantId: tenant.id,
              tokenHash: parsed.hash,
            },
            include: invitationDetails,
          });
          if (!invitation || invitation.status !== 'PENDING') return undefined;
          if (invitation.expiresAt <= now) {
            await transaction.invitation.updateMany({
              where: { id: invitation.id, status: 'PENDING' },
              data: { status: 'EXPIRED' },
            });
            return { expired: true as const };
          }
          const [commercialState, committedUsers, pendingInvitations] =
            await Promise.all([
              transaction.tenant.findUniqueOrThrow({
                where: { id: tenant.id },
                select: { plan: true, trialEndsAt: true },
              }),
              transaction.user.count({
                where: {
                  tenantId: tenant.id,
                  status: { not: 'DISABLED' },
                },
              }),
              transaction.invitation.count({
                where: {
                  tenantId: tenant.id,
                  status: 'PENDING',
                  expiresAt: { gt: now },
                },
              }),
            ]);
          this.commercialEntitlements.assertCanAllocateSeat(
            commercialState,
            committedUsers + pendingInvitations,
            { now, reservedSeat: true },
          );
          const claimed = await transaction.invitation.updateMany({
            where: {
              id: invitation.id,
              tenantId: tenant.id,
              tokenHash: parsed.hash,
              status: 'PENDING',
              expiresAt: { gt: now },
            },
            data: { status: 'ACCEPTED', acceptedAt: now },
          });
          if (claimed.count !== 1) return undefined;
          const existing = await transaction.user.count({
            where: { tenantId: tenant.id, email: invitation.email },
          });
          if (existing > 0) throw emailExists();

          await transaction.user.create({
            data: {
              id: userId,
              tenantId: tenant.id,
              email: invitation.email,
              displayName: input.displayName,
              passwordHash,
              status: 'ACTIVE',
              emailVerifiedAt: now,
              passwordChangedAt: now,
              userRoles: {
                create: invitation.invitationRoles.map(({ roleId }) => ({
                  roleId,
                })),
              },
            },
          });
          await transaction.session.create({
            data: {
              id: sessionId,
              tenantId: tenant.id,
              userId,
              userAgent: request.userAgent?.slice(0, 1024),
              ipAddress: request.ipAddress,
              expiresAt,
            },
          });
          await transaction.refreshToken.create({
            data: {
              id: refreshToken.id,
              tenantId: tenant.id,
              userId,
              sessionId,
              tokenHash: refreshToken.hash,
              issuedAt: now,
              expiresAt,
            },
          });
          await appendSecurityEvent(transaction, {
            tenantId: tenant.id,
            actorUserId: userId,
            subjectUserId: userId,
            eventType: 'INVITATION_ACCEPTED',
            outcome: 'SUCCESS',
            request,
            metadata: { invitationId: invitation.id },
          });
          return { email: invitation.email };
        },
      );
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw emailExists();
      throw error;
    }

    if (accepted && 'expired' in accepted) throw invitationExpired();
    if (!accepted) throw invitationInvalid();
    return this.authenticationResult({
      userId,
      email: accepted.email,
      displayName: input.displayName,
      tenant,
      sessionId,
      refreshToken,
      passwordChangedAt: now,
    });
  }

  private async authenticationResult(input: {
    userId: string;
    email: string;
    displayName: string;
    tenant: { id: string; name: string; slug: string };
    sessionId: string;
    refreshToken: PersistedToken;
    passwordChangedAt: Date;
  }): Promise<AuthenticationResult> {
    const csrfToken = this.tokens.createCsrfToken();
    return {
      response: {
        accessToken: await this.accessTokens.sign({
          userId: input.userId,
          tenantId: input.tenant.id,
          sessionId: input.sessionId,
          tokenVersion: input.passwordChangedAt.getTime(),
        }),
        csrfToken,
        user: {
          id: input.userId,
          email: input.email,
          displayName: input.displayName,
          status: 'ACTIVE',
          emailVerifiedAt: input.passwordChangedAt.toISOString(),
        },
        tenant: input.tenant,
      },
      refreshToken: input.refreshToken.raw,
      csrfToken,
    };
  }

  private async deliverNotificationsSafely(tenantId: string): Promise<void> {
    try {
      await this.outbox.deliverTenant(tenantId);
    } catch {
      this.logger.warn(
        { tenantId },
        'The notification outbox could not be drained immediately.',
      );
    }
  }
}

function mapInvitation(invitation: InvitationDetails): InvitationResponseDto {
  return {
    id: invitation.id,
    email: invitation.email,
    status:
      invitation.status === 'PENDING' && invitation.expiresAt <= new Date()
        ? 'EXPIRED'
        : invitation.status,
    roles: mapRoles(invitation),
    invitedBy: invitation.invitedByUser.displayName,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    lastSentAt: invitation.lastSentAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

function mapRoles(
  invitation: InvitationDetails,
): { id: string; name: string }[] {
  return invitation.invitationRoles
    .map(({ role }) => role)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 60 * 60 * 1_000);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function invitationInvalid(): ApplicationError {
  return new ApplicationError(
    ErrorCode.InvitationInvalid,
    'The invitation is invalid.',
    HttpStatus.BAD_REQUEST,
  );
}

function invitationExpired(): ApplicationError {
  return new ApplicationError(
    ErrorCode.InvitationExpired,
    'The invitation has expired.',
    HttpStatus.BAD_REQUEST,
  );
}

function invitationAlreadyExists(): ApplicationError {
  return new ApplicationError(
    ErrorCode.InvitationAlreadyExists,
    'A pending invitation already exists for this email.',
    HttpStatus.CONFLICT,
  );
}

function emailExists(): ApplicationError {
  return new ApplicationError(
    ErrorCode.EmailAlreadyExists,
    'A user with this email already exists.',
    HttpStatus.CONFLICT,
  );
}

function roleInvalid(): ApplicationError {
  return new ApplicationError(
    ErrorCode.RoleInvalid,
    'One or more roles are invalid.',
    HttpStatus.BAD_REQUEST,
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002',
  );
}
