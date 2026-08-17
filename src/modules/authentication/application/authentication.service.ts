import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Environment } from '../../../common/config/environment.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { ErrorCodeValue } from '../../../common/errors/error-codes.js';
import { AccessTokenService } from '../../../infrastructure/crypto/access-token.service.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import {
  SecureTokenService,
  type PersistedToken,
} from '../../../infrastructure/crypto/secure-token.service.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { Prisma, UserStatus } from '../../../generated/prisma/client.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal.js';
import { AuthenticationNotifier } from '../domain/ports/authentication-notifier.js';
import type {
  AuthenticationResponseDto,
  MeResponseDto,
  RegistrationPolicyResponseDto,
  SessionResponseDto,
} from './dto/auth-response.dto.js';
import type {
  LoginDto,
  RegisterCompanyDto,
  ResetPasswordDto,
  TenantEmailDto,
  TokenDto,
} from './dto/auth-request.dto.js';
import type { RequestMetadata } from './request-metadata.js';

const initialRoles = [
  'Administrator',
  'QA Manager',
  'Document Controller',
  'Operator',
  'Auditor',
] as const;
const initialRolePermissions: Record<(typeof initialRoles)[number], string[]> =
  {
    Administrator: [],
    'QA Manager': [
      'users.read',
      'roles.read',
      'documents.read',
      'documents.create',
      'documents.update',
      'documents.review',
      'documents.approve',
      'training.read',
      'training.assign',
      'training.complete',
      'deviations.read',
      'deviations.create',
      'deviations.triage',
      'deviations.investigate',
      'capas.read',
      'capas.create',
      'capas.execute',
      'capas.schedule_effectiveness',
      'capas.verify_effectiveness',
      'capas.create_follow_up',
      'capas.approve_extensions',
      'capas.export',
    ],
    'Document Controller': [
      'documents.read',
      'documents.create',
      'documents.update',
      'documents.review',
      'documents.release',
      'training.read',
      'training.complete',
      'deviations.read',
      'deviations.create',
      'deviations.investigate',
      'capas.read',
      'capas.execute',
    ],
    Operator: [
      'documents.read',
      'training.read',
      'training.complete',
      'deviations.read',
      'deviations.create',
      'capas.read',
      'capas.execute',
    ],
    Auditor: [
      'documents.read',
      'security.events.read',
      'training.read',
      'training.complete',
      'deviations.read',
      'capas.read',
      'capas.export',
      'audit.read',
    ],
  };
const failedLoginThreshold = 5;

export interface AuthenticationResult {
  response: AuthenticationResponseDto;
  refreshToken: string;
  csrfToken: string;
}

interface UserSnapshot {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date | null;
}

@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);
  private readonly refreshTokenTtlDays: number;
  private readonly resetTokenTtlMinutes: number;
  private readonly verificationTokenTtlHours: number;
  private readonly publicRegistrationEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokens: SecureTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly notifier: AuthenticationNotifier,
    configService: ConfigService<Environment, true>,
  ) {
    this.refreshTokenTtlDays = configService.getOrThrow(
      'REFRESH_TOKEN_TTL_DAYS',
      { infer: true },
    );
    this.resetTokenTtlMinutes = configService.getOrThrow(
      'PASSWORD_RESET_TTL_MINUTES',
      { infer: true },
    );
    this.verificationTokenTtlHours = configService.getOrThrow(
      'EMAIL_VERIFICATION_TTL_HOURS',
      { infer: true },
    );
    this.publicRegistrationEnabled = configService.getOrThrow(
      'ALLOW_PUBLIC_TENANT_REGISTRATION',
      { infer: true },
    );
  }

  async registerCompany(
    input: RegisterCompanyDto,
    metadata: RequestMetadata,
  ): Promise<AuthenticationResult> {
    if (!this.publicRegistrationEnabled) {
      throw new ApplicationError(
        ErrorCode.PublicRegistrationDisabled,
        'Public organization registration is disabled.',
        HttpStatus.FORBIDDEN,
      );
    }

    const tenantId = randomUUID();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    const passwordHash = await this.passwordHasher.hash(input.password);
    const refreshToken = this.tokens.create(tenantId);
    const verificationToken = this.tokens.create(tenantId);
    const sessionExpiresAt = addDays(now, this.refreshTokenTtlDays);

    try {
      await this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
        await transaction.tenant.create({
          data: {
            id: tenantId,
            name: input.tenantName,
            slug: input.tenantSlug,
          },
        });

        const permissions = await transaction.permission.findMany({
          select: { id: true, code: true },
        });
        const roles = new Map<string, string>();
        for (const name of initialRoles) {
          const role = await transaction.role.create({
            data: {
              tenantId,
              name,
              description: `${name} role created during organization registration.`,
              isSystem: true,
            },
            select: { id: true },
          });
          roles.set(name, role.id);
        }

        const administratorRoleId = roles.get('Administrator');
        if (!administratorRoleId) {
          throw new Error('Administrator role was not created.');
        }

        await transaction.rolePermission.createMany({
          data: permissions.map(({ id: permissionId }) => ({
            tenantId,
            roleId: administratorRoleId,
            permissionId,
          })),
        });

        for (const [roleName, roleId] of roles) {
          if (roleName === 'Administrator') continue;
          const allowedCodes = new Set(
            initialRolePermissions[roleName as (typeof initialRoles)[number]],
          );
          await transaction.rolePermission.createMany({
            data: permissions
              .filter(({ code }) => allowedCodes.has(code))
              .map(({ id: permissionId }) => ({
                tenantId,
                roleId,
                permissionId,
              })),
          });
        }

        await transaction.user.create({
          data: {
            id: userId,
            tenantId,
            email: input.email,
            displayName: input.adminName,
            passwordHash,
            status: 'ACTIVE',
            passwordChangedAt: now,
          },
        });
        await transaction.userRole.create({
          data: { tenantId, userId, roleId: administratorRoleId },
        });
        await transaction.session.create({
          data: {
            id: sessionId,
            tenantId,
            userId,
            status: 'ACTIVE',
            userAgent: sanitizeUserAgent(metadata.userAgent),
            ipAddress: metadata.ipAddress,
            expiresAt: sessionExpiresAt,
          },
        });
        await transaction.refreshToken.create({
          data: {
            id: refreshToken.id,
            tenantId,
            userId,
            sessionId,
            tokenHash: refreshToken.hash,
            issuedAt: now,
            expiresAt: sessionExpiresAt,
          },
        });
        await transaction.emailVerificationToken.create({
          data: {
            id: verificationToken.id,
            tenantId,
            userId,
            tokenHash: verificationToken.hash,
            expiresAt: addHours(now, this.verificationTokenTtlHours),
          },
        });
        await this.createSecurityEvent(transaction, {
          tenantId,
          actorUserId: userId,
          subjectUserId: userId,
          eventType: 'TENANT_REGISTERED',
          outcome: 'SUCCESS',
          metadata,
        });
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ApplicationError(
          ErrorCode.SlugAlreadyExists,
          'The organization could not be registered.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.sendNotificationSafely(() =>
      this.notifier.sendEmailVerification({
        email: input.email,
        displayName: input.adminName,
        tenantSlug: input.tenantSlug,
        token: verificationToken.raw,
      }),
    );

    return this.createAuthenticationResult(
      {
        id: userId,
        tenantId,
        email: input.email,
        displayName: input.adminName,
        status: 'ACTIVE',
        emailVerifiedAt: null,
        passwordChangedAt: now,
      },
      { id: tenantId, name: input.tenantName, slug: input.tenantSlug },
      sessionId,
      refreshToken,
    );
  }

  getRegistrationPolicy(): RegistrationPolicyResponseDto {
    return {
      publicCompanyRegistrationEnabled: this.publicRegistrationEnabled,
      existingOrganizationMembership: 'INVITATION_ONLY',
    };
  }

  async isTenantSlugAvailable(slug: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    return tenant === null;
  }

  async login(
    input: LoginDto,
    metadata: RequestMetadata,
  ): Promise<AuthenticationResult> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: input.tenant, status: 'ACTIVE' },
      select: { id: true, name: true, slug: true },
    });

    if (!tenant) {
      await this.passwordHasher.verifyDummy(input.password);
      throw invalidCredentials();
    }

    const user = await this.tenantUnitOfWork.execute(tenant.id, (transaction) =>
      transaction.user.findFirst({
        where: { tenantId: tenant.id, email: input.email },
        select: {
          id: true,
          tenantId: true,
          email: true,
          displayName: true,
          passwordHash: true,
          status: true,
          emailVerifiedAt: true,
          failedLoginCount: true,
          lockedUntil: true,
          passwordChangedAt: true,
        },
      }),
    );

    if (!user) {
      await this.passwordHasher.verifyDummy(input.password);
      await this.auditLoginFailure(
        tenant.id,
        undefined,
        'USER_NOT_FOUND',
        metadata,
      );
      throw invalidCredentials();
    }

    const passwordMatches = await this.passwordHasher.verify(
      user.passwordHash,
      input.password,
    );
    const now = new Date();
    const lockActive = Boolean(user.lockedUntil && user.lockedUntil > now);
    const accountAllowed =
      user.status === 'ACTIVE' ||
      (user.status === 'LOCKED' && !lockActive && passwordMatches);

    if (!passwordMatches || !accountAllowed || lockActive) {
      await this.recordFailedLogin(user, passwordMatches, lockActive, metadata);
      throw invalidCredentials();
    }

    const sessionId = randomUUID();
    const refreshToken = this.tokens.create(tenant.id);
    const sessionExpiresAt = addDays(now, this.refreshTokenTtlDays);

    await this.tenantUnitOfWork.execute(tenant.id, async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          status: 'ACTIVE',
        },
      });
      await transaction.session.create({
        data: {
          id: sessionId,
          tenantId: tenant.id,
          userId: user.id,
          userAgent: sanitizeUserAgent(metadata.userAgent),
          ipAddress: metadata.ipAddress,
          expiresAt: sessionExpiresAt,
        },
      });
      await transaction.refreshToken.create({
        data: {
          id: refreshToken.id,
          tenantId: tenant.id,
          userId: user.id,
          sessionId,
          tokenHash: refreshToken.hash,
          issuedAt: now,
          expiresAt: sessionExpiresAt,
        },
      });
      await this.createSecurityEvent(transaction, {
        tenantId: tenant.id,
        actorUserId: user.id,
        subjectUserId: user.id,
        eventType: 'LOGIN_SUCCEEDED',
        outcome: 'SUCCESS',
        metadata,
      });
    });

    return this.createAuthenticationResult(
      user,
      tenant,
      sessionId,
      refreshToken,
    );
  }

  async refresh(
    rawToken: string,
    metadata: RequestMetadata,
  ): Promise<AuthenticationResult> {
    const parsed = this.tokens.parse(rawToken);
    if (!parsed) throw invalidCredentials(ErrorCode.SessionExpired);

    const replacement = this.tokens.create(parsed.tenantId);
    const now = new Date();
    const replacementExpiresAt = addDays(now, this.refreshTokenTtlDays);
    const result = await this.tenantUnitOfWork.execute(
      parsed.tenantId,
      async (transaction) => {
        const current = await transaction.refreshToken.findFirst({
          where: {
            id: parsed.tokenId,
            tenantId: parsed.tenantId,
            tokenHash: parsed.hash,
          },
          include: {
            user: true,
            session: true,
            tenant: { select: { id: true, name: true, slug: true } },
          },
        });

        if (!current) return { kind: 'invalid' as const };
        if (
          current.usedAt ||
          current.replacedByTokenId ||
          current.reuseDetectedAt
        ) {
          await this.revokeCompromisedSession(
            transaction,
            current.tenantId,
            current.userId,
            current.sessionId,
            current.id,
            metadata,
          );
          return { kind: 'reuse' as const };
        }
        if (
          current.revokedAt ||
          current.expiresAt <= now ||
          current.session.status !== 'ACTIVE' ||
          current.session.expiresAt <= now ||
          current.user.status !== 'ACTIVE'
        ) {
          return { kind: 'invalid' as const };
        }

        const inserted = await transaction.$queryRaw<{ id: string }[]>`
          WITH claimed AS (
            UPDATE refresh_tokens
               SET used_at = ${now}
             WHERE id = ${current.id}::uuid
               AND tenant_id = ${current.tenantId}::uuid
               AND used_at IS NULL
               AND revoked_at IS NULL
               AND replaced_by_token_id IS NULL
            RETURNING tenant_id, user_id, session_id
          )
          INSERT INTO refresh_tokens (
            id, tenant_id, user_id, session_id, token_hash,
            parent_token_id, issued_at, expires_at
          )
          SELECT
            ${replacement.id}::uuid, tenant_id, user_id, session_id,
            ${replacement.hash}, ${current.id}::uuid, ${now}, ${replacementExpiresAt}
          FROM claimed
          RETURNING id
        `;

        if (inserted.length !== 1) {
          await this.revokeCompromisedSession(
            transaction,
            current.tenantId,
            current.userId,
            current.sessionId,
            current.id,
            metadata,
          );
          return { kind: 'reuse' as const };
        }

        await transaction.refreshToken.update({
          where: { id: current.id },
          data: { replacedByTokenId: replacement.id },
        });
        await transaction.session.update({
          where: { id: current.sessionId },
          data: { lastUsedAt: now },
        });
        await this.createSecurityEvent(transaction, {
          tenantId: current.tenantId,
          actorUserId: current.userId,
          subjectUserId: current.userId,
          eventType: 'TOKEN_REFRESHED',
          outcome: 'SUCCESS',
          metadata,
        });
        return { kind: 'success' as const, current };
      },
    );

    if (result.kind === 'reuse') {
      throw invalidCredentials(ErrorCode.SessionRevoked);
    }
    if (result.kind === 'invalid') {
      throw invalidCredentials(ErrorCode.SessionExpired);
    }

    return this.createAuthenticationResult(
      result.current.user,
      result.current.tenant,
      result.current.sessionId,
      replacement,
    );
  }

  async logout(
    rawToken: string | undefined,
    metadata: RequestMetadata,
  ): Promise<void> {
    const parsed = rawToken ? this.tokens.parse(rawToken) : undefined;
    if (!parsed) return;

    await this.tenantUnitOfWork.execute(
      parsed.tenantId,
      async (transaction) => {
        const token = await transaction.refreshToken.findFirst({
          where: {
            id: parsed.tokenId,
            tenantId: parsed.tenantId,
            tokenHash: parsed.hash,
          },
          select: { userId: true, sessionId: true },
        });
        if (!token) return;
        await this.revokeSessions(
          transaction,
          parsed.tenantId,
          token.userId,
          [token.sessionId],
          'USER_LOGOUT',
        );
        await this.createSecurityEvent(transaction, {
          tenantId: parsed.tenantId,
          actorUserId: token.userId,
          subjectUserId: token.userId,
          eventType: 'SESSION_REVOKED',
          outcome: 'SUCCESS',
          metadata,
        });
      },
    );
  }

  async logoutAll(
    principal: AuthenticatedPrincipal,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await this.revokeSessions(
          transaction,
          principal.tenantId,
          principal.userId,
          undefined,
          'LOGOUT_ALL',
        );
        await this.createSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          eventType: 'ALL_SESSIONS_REVOKED',
          outcome: 'SUCCESS',
          metadata,
        });
      },
    );
  }

  async getMe(principal: AuthenticatedPrincipal): Promise<MeResponseDto> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: principal.tenantId },
      select: { id: true, name: true, slug: true },
    });
    const user = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      (transaction) =>
        transaction.user.findFirstOrThrow({
          where: { id: principal.userId, tenantId: principal.tenantId },
          select: {
            id: true,
            email: true,
            displayName: true,
            status: true,
            emailVerifiedAt: true,
            userRoles: {
              select: {
                role: {
                  select: {
                    name: true,
                    rolePermissions: {
                      select: { permission: { select: { code: true } } },
                    },
                  },
                },
              },
            },
          },
        }),
    );
    return {
      user: mapUser(user),
      tenant,
      roles: user.userRoles.map(({ role }) => role.name).sort(),
      permissions: [
        ...new Set(
          user.userRoles.flatMap(({ role }) =>
            role.rolePermissions.map(({ permission }) => permission.code),
          ),
        ),
      ].sort(),
    };
  }

  listSessions(
    principal: AuthenticatedPrincipal,
  ): Promise<SessionResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const sessions = await transaction.session.findMany({
          where: {
            tenantId: principal.tenantId,
            userId: principal.userId,
          },
          orderBy: { lastUsedAt: 'desc' },
        });
        const now = new Date();
        return sessions.map((session) => ({
          id: session.id,
          device: describeUserAgent(session.userAgent),
          createdAt: session.createdAt.toISOString(),
          lastUsedAt: session.lastUsedAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          isCurrent: session.id === principal.sessionId,
          status:
            session.status === 'ACTIVE' && session.expiresAt <= now
              ? 'EXPIRED'
              : session.status,
        }));
      },
    );
  }

  async revokeSession(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const session = await transaction.session.findFirst({
          where: {
            id: sessionId,
            tenantId: principal.tenantId,
            userId: principal.userId,
          },
          select: { id: true },
        });
        if (!session) return;
        await this.revokeSessions(
          transaction,
          principal.tenantId,
          principal.userId,
          [sessionId],
          'USER_REVOKED',
        );
        await this.createSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          eventType: 'SESSION_REVOKED',
          outcome: 'SUCCESS',
          metadata,
          eventMetadata: { revokedSessionId: sessionId },
        });
      },
    );
  }

  async forgotPassword(
    input: TenantEmailDto,
    metadata: RequestMetadata,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: input.tenant, status: 'ACTIVE' },
      select: { id: true, slug: true },
    });
    if (!tenant) return;

    const token = this.tokens.create(tenant.id);
    const user = await this.tenantUnitOfWork.execute(
      tenant.id,
      async (transaction) => {
        const found = await transaction.user.findFirst({
          where: {
            tenantId: tenant.id,
            email: input.email,
            status: { in: ['ACTIVE', 'LOCKED'] },
          },
          select: { id: true, email: true, displayName: true },
        });
        if (!found) return undefined;
        const now = new Date();
        await transaction.passwordResetToken.updateMany({
          where: { tenantId: tenant.id, userId: found.id, usedAt: null },
          data: { usedAt: now },
        });
        await transaction.passwordResetToken.create({
          data: {
            id: token.id,
            tenantId: tenant.id,
            userId: found.id,
            tokenHash: token.hash,
            expiresAt: addMinutes(now, this.resetTokenTtlMinutes),
          },
        });
        await this.createSecurityEvent(transaction, {
          tenantId: tenant.id,
          actorUserId: found.id,
          subjectUserId: found.id,
          eventType: 'PASSWORD_RESET_REQUESTED',
          outcome: 'SUCCESS',
          metadata,
        });
        return found;
      },
    );

    if (user) {
      await this.sendNotificationSafely(() =>
        this.notifier.sendPasswordReset({
          email: user.email,
          displayName: user.displayName,
          tenantSlug: tenant.slug,
          token: token.raw,
        }),
      );
    }
  }

  async resetPassword(
    input: ResetPasswordDto,
    metadata: RequestMetadata,
  ): Promise<void> {
    const parsed = this.tokens.parse(input.token);
    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    if (!parsed) throw invalidResetToken();
    const tenantExists = await this.prisma.tenant.count({
      where: { id: parsed.tenantId },
    });
    if (!tenantExists) throw invalidResetToken();

    const completed = await this.tenantUnitOfWork.execute(
      parsed.tenantId,
      async (transaction) => {
        const token = await transaction.passwordResetToken.findFirst({
          where: {
            id: parsed.tokenId,
            tenantId: parsed.tenantId,
            tokenHash: parsed.hash,
          },
          select: {
            id: true,
            userId: true,
            usedAt: true,
            expiresAt: true,
            user: { select: { status: true } },
          },
        });
        const now = new Date();
        if (!token || token.usedAt || token.expiresAt <= now) {
          await this.createSecurityEvent(transaction, {
            tenantId: parsed.tenantId,
            subjectUserId: token?.userId,
            eventType: 'PASSWORD_RESET_FAILED',
            outcome: 'FAILURE',
            metadata,
            eventMetadata: { reason: 'INVALID_OR_EXPIRED_TOKEN' },
          });
          return false;
        }

        await transaction.passwordResetToken.update({
          where: { id: token.id },
          data: { usedAt: now },
        });
        await transaction.passwordResetToken.updateMany({
          where: {
            tenantId: parsed.tenantId,
            userId: token.userId,
            id: { not: token.id },
            usedAt: null,
          },
          data: { usedAt: now },
        });
        await transaction.user.update({
          where: { id: token.userId },
          data: {
            passwordHash,
            passwordChangedAt: now,
            failedLoginCount: 0,
            lockedUntil: null,
            status: token.user.status === 'LOCKED' ? 'ACTIVE' : undefined,
          },
        });
        await this.revokeSessions(
          transaction,
          parsed.tenantId,
          token.userId,
          undefined,
          'PASSWORD_CHANGED',
        );
        await this.createSecurityEvent(transaction, {
          tenantId: parsed.tenantId,
          actorUserId: token.userId,
          subjectUserId: token.userId,
          eventType: 'PASSWORD_RESET_COMPLETED',
          outcome: 'SUCCESS',
          metadata,
        });
        return true;
      },
    );

    if (!completed) throw invalidResetToken();
  }

  async verifyEmail(input: TokenDto, metadata: RequestMetadata): Promise<void> {
    const parsed = this.tokens.parse(input.token);
    if (!parsed) throw invalidVerificationToken();
    const tenantExists = await this.prisma.tenant.count({
      where: { id: parsed.tenantId },
    });
    if (!tenantExists) throw invalidVerificationToken();

    const completed = await this.tenantUnitOfWork.execute(
      parsed.tenantId,
      async (transaction) => {
        const token = await transaction.emailVerificationToken.findFirst({
          where: {
            id: parsed.tokenId,
            tenantId: parsed.tenantId,
            tokenHash: parsed.hash,
          },
          select: { id: true, userId: true, usedAt: true, expiresAt: true },
        });
        const now = new Date();
        if (!token || token.usedAt || token.expiresAt <= now) return false;
        await transaction.emailVerificationToken.update({
          where: { id: token.id },
          data: { usedAt: now },
        });
        await transaction.user.update({
          where: { id: token.userId },
          data: { emailVerifiedAt: now },
        });
        await this.createSecurityEvent(transaction, {
          tenantId: parsed.tenantId,
          actorUserId: token.userId,
          subjectUserId: token.userId,
          eventType: 'EMAIL_VERIFIED',
          outcome: 'SUCCESS',
          metadata,
        });
        return true;
      },
    );
    if (!completed) throw invalidVerificationToken();
  }

  async resendVerification(
    input: TenantEmailDto,
    metadata: RequestMetadata,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: input.tenant, status: 'ACTIVE' },
      select: { id: true, slug: true },
    });
    if (!tenant) return;

    const token = this.tokens.create(tenant.id);
    const user = await this.tenantUnitOfWork.execute(
      tenant.id,
      async (transaction) => {
        const found = await transaction.user.findFirst({
          where: {
            tenantId: tenant.id,
            email: input.email,
            emailVerifiedAt: null,
            status: { in: ['ACTIVE', 'LOCKED'] },
          },
          select: { id: true, email: true, displayName: true },
        });
        if (!found) return undefined;
        const now = new Date();
        await transaction.emailVerificationToken.updateMany({
          where: { tenantId: tenant.id, userId: found.id, usedAt: null },
          data: { usedAt: now },
        });
        await transaction.emailVerificationToken.create({
          data: {
            id: token.id,
            tenantId: tenant.id,
            userId: found.id,
            tokenHash: token.hash,
            expiresAt: addHours(now, this.verificationTokenTtlHours),
          },
        });
        await this.createSecurityEvent(transaction, {
          tenantId: tenant.id,
          subjectUserId: found.id,
          eventType: 'EMAIL_VERIFICATION_REQUESTED',
          outcome: 'SUCCESS',
          metadata,
        });
        return found;
      },
    );

    if (user) {
      await this.sendNotificationSafely(() =>
        this.notifier.sendEmailVerification({
          email: user.email,
          displayName: user.displayName,
          tenantSlug: tenant.slug,
          token: token.raw,
        }),
      );
    }
  }

  private async createAuthenticationResult(
    user: {
      id: string;
      tenantId: string;
      email: string;
      displayName: string;
      status: UserStatus;
      emailVerifiedAt: Date | null;
      passwordChangedAt: Date | null;
    },
    tenant: { id: string; name: string; slug: string },
    sessionId: string,
    refreshToken: PersistedToken,
  ): Promise<AuthenticationResult> {
    const principal: AuthenticatedPrincipal = {
      userId: user.id,
      tenantId: user.tenantId,
      sessionId,
      tokenVersion: user.passwordChangedAt?.getTime() ?? 0,
    };
    const csrfToken = this.tokens.createCsrfToken();
    return {
      response: {
        accessToken: await this.accessTokens.sign(principal),
        csrfToken,
        user: mapUser(user),
        tenant,
      },
      refreshToken: refreshToken.raw,
      csrfToken,
    };
  }

  private async recordFailedLogin(
    user: UserSnapshot,
    passwordMatches: boolean,
    lockActive: boolean,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.tenantUnitOfWork.execute(user.tenantId, async (transaction) => {
      let eventType = 'LOGIN_FAILED';
      let count = user.failedLoginCount;
      let lockedUntil = user.lockedUntil;
      let status = user.status;
      if (!passwordMatches && !lockActive && user.status !== 'DISABLED') {
        count += 1;
        if (count >= failedLoginThreshold) {
          const minutes = Math.min(2 ** (count - failedLoginThreshold), 60);
          lockedUntil = addMinutes(new Date(), minutes);
          status = 'LOCKED';
          eventType = 'ACCOUNT_LOCKED';
        }
        await transaction.user.update({
          where: { id: user.id },
          data: { failedLoginCount: count, lockedUntil, status },
        });
      }
      await this.createSecurityEvent(transaction, {
        tenantId: user.tenantId,
        actorUserId: user.id,
        subjectUserId: user.id,
        eventType,
        outcome: 'FAILURE',
        metadata,
        eventMetadata: {
          reason: lockActive
            ? 'ACCOUNT_TEMPORARILY_LOCKED'
            : user.status === 'DISABLED'
              ? 'ACCOUNT_DISABLED'
              : passwordMatches
                ? 'ACCOUNT_NOT_ACTIVE'
                : 'PASSWORD_MISMATCH',
        },
      });
    });
  }

  private auditLoginFailure(
    tenantId: string,
    userId: string | undefined,
    reason: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    return this.tenantUnitOfWork.execute(tenantId, (transaction) =>
      this.createSecurityEvent(transaction, {
        tenantId,
        actorUserId: userId,
        subjectUserId: userId,
        eventType: 'LOGIN_FAILED',
        outcome: 'FAILURE',
        metadata,
        eventMetadata: { reason },
      }),
    );
  }

  private async revokeCompromisedSession(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    sessionId: string,
    tokenId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const now = new Date();
    await transaction.refreshToken.updateMany({
      where: { tenantId, sessionId },
      data: { revokedAt: now },
    });
    await transaction.refreshToken.updateMany({
      where: { id: tokenId, tenantId },
      data: { reuseDetectedAt: now },
    });
    await transaction.session.updateMany({
      where: { id: sessionId, tenantId, userId },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        revokeReason: 'REFRESH_TOKEN_REUSE',
      },
    });
    await this.createSecurityEvent(transaction, {
      tenantId,
      actorUserId: userId,
      subjectUserId: userId,
      eventType: 'REFRESH_TOKEN_REUSE_DETECTED',
      outcome: 'FAILURE',
      metadata,
    });
  }

  private async revokeSessions(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    sessionIds: string[] | undefined,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const sessionWhere: Prisma.SessionWhereInput = {
      tenantId,
      userId,
      ...(sessionIds ? { id: { in: sessionIds } } : {}),
    };
    await transaction.session.updateMany({
      where: sessionWhere,
      data: {
        status: 'REVOKED',
        revokedAt: now,
        revokeReason: reason,
      },
    });
    await transaction.refreshToken.updateMany({
      where: {
        tenantId,
        userId,
        ...(sessionIds ? { sessionId: { in: sessionIds } } : {}),
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  }

  private async createSecurityEvent(
    transaction: Prisma.TransactionClient,
    input: {
      tenantId: string;
      actorUserId?: string;
      subjectUserId?: string;
      eventType: string;
      outcome: 'SUCCESS' | 'FAILURE';
      metadata: RequestMetadata;
      eventMetadata?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await transaction.securityEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        subjectUserId: input.subjectUserId,
        eventType: input.eventType,
        outcome: input.outcome,
        correlationId: input.metadata.correlationId,
        ipAddress: input.metadata.ipAddress,
        userAgent: sanitizeUserAgent(input.metadata.userAgent),
        metadata: input.eventMetadata,
      },
    });
  }

  private async sendNotificationSafely(
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch {
      this.logger.warn('An authentication email could not be delivered.');
    }
  }
}

function mapUser(user: {
  id: string;
  email: string;
  displayName: string;
  status: string;
  emailVerifiedAt: Date | null;
}): AuthenticationResponseDto['user'] {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}

function invalidCredentials(
  code: ErrorCodeValue = ErrorCode.InvalidCredentials,
): ApplicationError {
  return new ApplicationError(
    code,
    'The credentials are invalid.',
    HttpStatus.UNAUTHORIZED,
  );
}

function invalidResetToken(): ApplicationError {
  return new ApplicationError(
    ErrorCode.PasswordResetInvalid,
    'The password reset request is invalid or expired.',
    HttpStatus.BAD_REQUEST,
  );
}

function invalidVerificationToken(): ApplicationError {
  return new ApplicationError(
    ErrorCode.VerificationTokenInvalid,
    'The email verification request is invalid or expired.',
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

function sanitizeUserAgent(value: string | undefined): string | undefined {
  return value?.slice(0, 1024);
}

function describeUserAgent(value: string | null): string {
  if (!value) return 'Unknown device';
  const browser = value.includes('Edg/')
    ? 'Microsoft Edge'
    : value.includes('Chrome/')
      ? 'Google Chrome'
      : value.includes('Firefox/')
        ? 'Mozilla Firefox'
        : value.includes('Safari/')
          ? 'Safari'
          : 'Browser';
  const operatingSystem = value.includes('Windows')
    ? 'Windows'
    : value.includes('Mac OS')
      ? 'macOS'
      : value.includes('Linux')
        ? 'Linux'
        : 'Unknown OS';
  return `${browser} on ${operatingSystem}`;
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 3_600_000);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}
