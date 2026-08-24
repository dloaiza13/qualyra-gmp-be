import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { CapaEvidenceScanner } from '../../capas/domain/ports/capa-evidence-scanner.js';
import { CapaEvidenceStorage } from '../../capas/domain/ports/capa-evidence-storage.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal.js';
import type { UpdateProfileDto } from './dto/profile-request.dto.js';
import type { RequestMetadata } from './request-metadata.js';

const allowedAvatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxAvatarBytes = 5_242_880;

export interface UploadedAvatarFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export interface DownloadedAvatar {
  bytes: Buffer;
  contentType: string;
  sha256: string;
}

export interface ProfilePreferences {
  displayName: string;
  themePreference: 'SYSTEM' | 'LIGHT' | 'DARK';
  localePreference: 'ES' | 'EN';
  avatarUpdatedAt: string | null;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly storage: CapaEvidenceStorage,
    private readonly scanner: CapaEvidenceScanner,
  ) {}

  async update(
    principal: AuthenticatedPrincipal,
    input: UpdateProfileDto,
    request: RequestMetadata,
  ): Promise<ProfilePreferences> {
    const displayName = input.displayName?.trim();
    if (
      !displayName &&
      input.themePreference === undefined &&
      input.localePreference === undefined
    ) {
      throw invalidProfile('At least one profile preference is required.');
    }
    if (
      input.displayName !== undefined &&
      (!displayName || displayName.length < 2)
    ) {
      throw invalidProfile(
        'The display name must contain at least two characters.',
      );
    }

    const user = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const updated = await transaction.user.update({
          where: { id: principal.userId },
          data: {
            ...(displayName ? { displayName } : {}),
            ...(input.themePreference
              ? { themePreference: input.themePreference }
              : {}),
            ...(input.localePreference
              ? { localePreference: input.localePreference }
              : {}),
          },
          select: profileSelection,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          eventType: 'PROFILE_PREFERENCES_UPDATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            displayNameChanged: input.displayName !== undefined,
            themePreferenceChanged: input.themePreference !== undefined,
            localePreferenceChanged: input.localePreference !== undefined,
          },
        });
        return updated;
      },
    );
    return toPreferences(user);
  }

  async uploadAvatar(
    principal: AuthenticatedPrincipal,
    file: UploadedAvatarFile | undefined,
    request: RequestMetadata,
  ): Promise<ProfilePreferences> {
    if (!file || file.buffer.length === 0) {
      throw invalidProfile('A non-empty profile image is required.');
    }
    const contentType = file.mimetype.toLowerCase();
    if (!allowedAvatarTypes.has(contentType)) {
      throw invalidProfile(
        'Only JPEG, PNG, or WebP profile images are allowed.',
      );
    }
    if (file.buffer.length > maxAvatarBytes) {
      throw invalidProfile('The profile image exceeds the 5 MB limit.');
    }

    try {
      await this.scanner.scan({
        fileName: file.originalname,
        contentType,
        bytes: file.buffer,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'The profile image was rejected.';
      throw invalidProfile(message);
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const objectKey = [
      principal.tenantId,
      'profile-avatars',
      principal.userId,
      randomUUID(),
    ].join('/');
    let stored;
    try {
      stored = await this.storage.store(
        objectKey,
        file.buffer,
        contentType,
        sha256,
      );
    } catch {
      throw new ApplicationError(
        ErrorCode.InternalError,
        'Managed profile image storage is unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let oldObjectKey: string | null = null;
    try {
      const user = await this.tenantUnitOfWork.execute(
        principal.tenantId,
        async (transaction) => {
          const current = await transaction.user.findFirstOrThrow({
            where: { id: principal.userId, tenantId: principal.tenantId },
            select: { avatarObjectKey: true },
          });
          oldObjectKey = current.avatarObjectKey;
          const updated = await transaction.user.update({
            where: { id: principal.userId },
            data: {
              avatarObjectKey: stored.objectKey,
              avatarStorageDriver: stored.storageDriver,
              avatarContentType: contentType,
              avatarSizeBytes: file.buffer.length,
              avatarSha256: sha256,
              avatarUpdatedAt: new Date(),
            },
            select: profileSelection,
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            subjectUserId: principal.userId,
            eventType: 'PROFILE_AVATAR_UPDATED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              contentType,
              sizeBytes: file.buffer.length,
              sha256,
              storageDriver: stored.storageDriver,
            },
          });
          return updated;
        },
      );
      if (oldObjectKey && oldObjectKey !== stored.objectKey) {
        await this.storage.remove(oldObjectKey).catch(() => undefined);
      }
      return toPreferences(user);
    } catch (error) {
      await this.storage.remove(stored.objectKey).catch(() => undefined);
      throw error;
    }
  }

  async downloadAvatar(
    principal: AuthenticatedPrincipal,
  ): Promise<DownloadedAvatar> {
    const avatar = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      (transaction) =>
        transaction.user.findFirst({
          where: { id: principal.userId, tenantId: principal.tenantId },
          select: {
            avatarObjectKey: true,
            avatarContentType: true,
            avatarSha256: true,
          },
        }),
    );
    if (
      !avatar?.avatarObjectKey ||
      !avatar.avatarContentType ||
      !avatar.avatarSha256
    ) {
      throw new ApplicationError(
        ErrorCode.ProfileAvatarNotFound,
        'The profile image was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    try {
      const bytes = await this.storage.read(avatar.avatarObjectKey);
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== avatar.avatarSha256) {
        throw new Error('Profile image integrity verification failed.');
      }
      return {
        bytes,
        contentType: avatar.avatarContentType,
        sha256: avatar.avatarSha256,
      };
    } catch {
      throw new ApplicationError(
        ErrorCode.InternalError,
        'The profile image failed integrity verification.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async removeAvatar(
    principal: AuthenticatedPrincipal,
    request: RequestMetadata,
  ): Promise<void> {
    const objectKey = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const current = await transaction.user.findFirstOrThrow({
          where: { id: principal.userId, tenantId: principal.tenantId },
          select: { avatarObjectKey: true },
        });
        if (!current.avatarObjectKey) return null;
        await transaction.user.update({
          where: { id: principal.userId },
          data: {
            avatarObjectKey: null,
            avatarStorageDriver: null,
            avatarContentType: null,
            avatarSizeBytes: null,
            avatarSha256: null,
            avatarUpdatedAt: null,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          eventType: 'PROFILE_AVATAR_REMOVED',
          outcome: 'SUCCESS',
          request,
        });
        return current.avatarObjectKey;
      },
    );
    if (objectKey) await this.storage.remove(objectKey).catch(() => undefined);
  }
}

const profileSelection = {
  displayName: true,
  themePreference: true,
  localePreference: true,
  avatarUpdatedAt: true,
} as const;

function toPreferences(user: {
  displayName: string;
  themePreference: 'SYSTEM' | 'LIGHT' | 'DARK';
  localePreference: 'ES' | 'EN';
  avatarUpdatedAt: Date | null;
}): ProfilePreferences {
  return {
    ...user,
    avatarUpdatedAt: user.avatarUpdatedAt?.toISOString() ?? null,
  };
}

function invalidProfile(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ProfileInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}
