import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  HelpGuideContext,
  Prisma,
} from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import {
  systemGuideByKey,
  systemHelpGuides,
} from '../domain/system-help-guides.js';
import type {
  CreateHelpGuideDto,
  HelpGuideListQueryDto,
  UpdateHelpGuideDto,
} from './dto/help-guide-request.dto.js';
import type {
  HelpGuideFeedbackResponseDto,
  HelpGuideRevisionResponseDto,
  ManagedHelpGuideResponseDto,
  PublishedHelpGuideResponseDto,
} from './dto/help-guide-response.dto.js';

const managedGuideInclude = {
  createdBy: { select: { displayName: true } },
  revisions: {
    orderBy: { version: 'desc' as const },
    include: {
      createdBy: { select: { displayName: true } },
      publishedBy: { select: { displayName: true } },
    },
  },
} satisfies Prisma.HelpGuideInclude;

type ManagedGuideRecord = Prisma.HelpGuideGetPayload<{
  include: typeof managedGuideInclude;
}>;

type RevisionRecord = ManagedGuideRecord['revisions'][number];

interface RevisionContent {
  titleEs: string;
  titleEn: string;
  summaryEs: string;
  summaryEn: string;
  stepsEs: string[];
  stepsEn: string[];
  mediaUrl: string | null;
  videoUrl: string | null;
  resourceLabelEs: string | null;
  resourceLabelEn: string | null;
  resourceUrl: string | null;
}

@Injectable()
export class HelpGuidesService {
  constructor(private readonly tenantUnitOfWork: TenantUnitOfWork) {}

  contextual(
    principal: AuthenticatedPrincipal,
    context: HelpGuideContext,
  ): Promise<PublishedHelpGuideResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const tenantGuides = await transaction.helpGuide.findMany({
          where: {
            tenantId: principal.tenantId,
            context,
            archivedAt: null,
            revisions: { some: { status: 'PUBLISHED' } },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            revisions: {
              where: { status: 'PUBLISHED' },
              take: 1,
              include: {
                createdBy: { select: { displayName: true } },
                publishedBy: { select: { displayName: true } },
              },
            },
          },
        });
        const systemGuides = systemHelpGuides.filter(
          (guide) => guide.context === context,
        );
        const guideKeys = [
          ...tenantGuides.map(({ id }) => `tenant:${id}`),
          ...systemGuides.map(({ key }) => key),
        ];
        const feedback = guideKeys.length
          ? await transaction.helpGuideFeedback.findMany({
              where: {
                tenantId: principal.tenantId,
                userId: principal.userId,
                guideKey: { in: guideKeys },
              },
              select: { guideKey: true, helpful: true },
            })
          : [];
        const viewerFeedback = new Map(
          feedback.map((item) => [item.guideKey, item.helpful]),
        );

        const custom = tenantGuides.flatMap((guide) => {
          const revision = guide.revisions[0];
          if (!revision) return [];
          const key = `tenant:${guide.id}`;
          return [
            {
              key,
              source: 'TENANT' as const,
              context: guide.context,
              slug: guide.slug,
              sortOrder: guide.sortOrder,
              version: revision.version,
              ...revisionContent(revision),
              viewerFeedback: viewerFeedback.get(key) ?? null,
            },
          ];
        });
        const defaults = systemGuides.map((guide) => ({
          ...guide,
          viewerFeedback: viewerFeedback.get(guide.key) ?? null,
        }));
        return [...custom, ...defaults];
      },
    );
  }

  list(
    principal: AuthenticatedPrincipal,
    query: HelpGuideListQueryDto,
  ): Promise<ManagedHelpGuideResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const guides = await transaction.helpGuide.findMany({
          where: {
            tenantId: principal.tenantId,
            context: query.context,
            archivedAt: query.includeArchived ? undefined : null,
          },
          orderBy: [
            { archivedAt: 'asc' },
            { context: 'asc' },
            { sortOrder: 'asc' },
            { createdAt: 'asc' },
          ],
          include: managedGuideInclude,
        });
        return mapManagedGuides(transaction, principal.tenantId, guides);
      },
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateHelpGuideDto,
    request: RequestMetadata,
  ): Promise<ManagedHelpGuideResponseDto> {
    const content = contentFromCreate(input);
    validateResource(content);
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        try {
          const guide = await transaction.helpGuide.create({
            data: {
              tenantId: principal.tenantId,
              context: input.context,
              slug: input.slug,
              sortOrder: input.sortOrder ?? 0,
              createdByUserId: principal.userId,
              revisions: {
                create: {
                  version: 1,
                  createdByUserId: principal.userId,
                  ...content,
                },
              },
            },
            include: managedGuideInclude,
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'HELP_GUIDE_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: { guideId: guide.id, context: guide.context, version: 1 },
          });
          return mapManagedGuide(guide, { helpful: 0, notHelpful: 0 });
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) throw slugConflict();
          throw error;
        }
      },
    );
  }

  update(
    principal: AuthenticatedPrincipal,
    guideId: string,
    input: UpdateHelpGuideDto,
    request: RequestMetadata,
  ): Promise<ManagedHelpGuideResponseDto> {
    if (Object.keys(input).length === 0) throw invalidGuide();
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const existing = await transaction.helpGuide.findFirst({
          where: { tenantId: principal.tenantId, id: guideId },
          include: managedGuideInclude,
        });
        if (!existing) throw guideNotFound();
        if (existing.archivedAt) throw invalidGuide();
        const draft = existing.revisions.find(
          ({ status }) => status === 'DRAFT',
        );
        const published = existing.revisions.find(
          ({ status }) => status === 'PUBLISHED',
        );
        const base = draft ?? published;
        if (!base) throw invalidGuide();
        const content = mergeContent(base, input);
        validateResource(content);
        const nextVersion =
          Math.max(...existing.revisions.map(({ version }) => version)) + 1;

        try {
          await transaction.helpGuide.update({
            where: { id: guideId },
            data: {
              context: input.context,
              slug: input.slug,
              sortOrder: input.sortOrder,
            },
          });
          if (draft) {
            await transaction.helpGuideRevision.update({
              where: { id: draft.id },
              data: content,
            });
          } else {
            await transaction.helpGuideRevision.create({
              data: {
                tenantId: principal.tenantId,
                guideId,
                version: nextVersion,
                createdByUserId: principal.userId,
                ...content,
              },
            });
          }
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'HELP_GUIDE_DRAFT_SAVED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              guideId,
              version: draft?.version ?? nextVersion,
            },
          });
          return this.findManaged(transaction, principal.tenantId, guideId);
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) throw slugConflict();
          throw error;
        }
      },
    );
  }

  publish(
    principal: AuthenticatedPrincipal,
    guideId: string,
    request: RequestMetadata,
  ): Promise<ManagedHelpGuideResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const guide = await transaction.helpGuide.findFirst({
          where: {
            tenantId: principal.tenantId,
            id: guideId,
            archivedAt: null,
          },
          include: { revisions: true },
        });
        if (!guide) throw guideNotFound();
        const draft = guide.revisions.find(({ status }) => status === 'DRAFT');
        if (!draft) throw invalidGuide();
        const published = guide.revisions.find(
          ({ status }) => status === 'PUBLISHED',
        );
        const now = new Date();
        if (published) {
          await transaction.helpGuideRevision.update({
            where: { id: published.id },
            data: { status: 'RETIRED' },
          });
        }
        await transaction.helpGuideRevision.update({
          where: { id: draft.id },
          data: {
            status: 'PUBLISHED',
            publishedByUserId: principal.userId,
            publishedAt: now,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'HELP_GUIDE_PUBLISHED',
          outcome: 'SUCCESS',
          request,
          metadata: { guideId, version: draft.version },
        });
        return this.findManaged(transaction, principal.tenantId, guideId);
      },
    );
  }

  archive(
    principal: AuthenticatedPrincipal,
    guideId: string,
    request: RequestMetadata,
  ): Promise<ManagedHelpGuideResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const guide = await transaction.helpGuide.findFirst({
          where: { tenantId: principal.tenantId, id: guideId },
          include: { revisions: true },
        });
        if (!guide) throw guideNotFound();
        if (guide.archivedAt)
          return this.findManaged(transaction, principal.tenantId, guideId);
        const published = guide.revisions.find(
          ({ status }) => status === 'PUBLISHED',
        );
        if (published) {
          await transaction.helpGuideRevision.update({
            where: { id: published.id },
            data: { status: 'RETIRED' },
          });
        }
        await transaction.helpGuide.update({
          where: { id: guideId },
          data: { archivedAt: new Date() },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'HELP_GUIDE_RETIRED',
          outcome: 'SUCCESS',
          request,
          metadata: { guideId, version: published?.version },
        });
        return this.findManaged(transaction, principal.tenantId, guideId);
      },
    );
  }

  feedback(
    principal: AuthenticatedPrincipal,
    guideKey: string,
    helpful: boolean,
  ): Promise<HelpGuideFeedbackResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        if (guideKey.startsWith('system:')) {
          if (!systemGuideByKey(guideKey)) throw guideNotFound();
        } else if (guideKey.startsWith('tenant:')) {
          const guideId = guideKey.slice('tenant:'.length);
          const guide = await transaction.helpGuide.findFirst({
            where: {
              tenantId: principal.tenantId,
              id: guideId,
              archivedAt: null,
              revisions: { some: { status: 'PUBLISHED' } },
            },
            select: { id: true },
          });
          if (!guide) throw guideNotFound();
        } else {
          throw guideNotFound();
        }
        await transaction.helpGuideFeedback.upsert({
          where: {
            tenantId_userId_guideKey: {
              tenantId: principal.tenantId,
              userId: principal.userId,
              guideKey,
            },
          },
          create: {
            tenantId: principal.tenantId,
            userId: principal.userId,
            guideKey,
            helpful,
          },
          update: { helpful },
        });
        return { accepted: true, helpful };
      },
    );
  }

  private async findManaged(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    guideId: string,
  ): Promise<ManagedHelpGuideResponseDto> {
    const guide = await transaction.helpGuide.findFirst({
      where: { tenantId, id: guideId },
      include: managedGuideInclude,
    });
    if (!guide) throw guideNotFound();
    const [mapped] = await mapManagedGuides(transaction, tenantId, [guide]);
    if (!mapped) throw guideNotFound();
    return mapped;
  }
}

async function mapManagedGuides(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  guides: ManagedGuideRecord[],
): Promise<ManagedHelpGuideResponseDto[]> {
  if (guides.length === 0) return [];
  const feedback = await transaction.helpGuideFeedback.findMany({
    where: {
      tenantId,
      guideKey: { in: guides.map(({ id }) => `tenant:${id}`) },
    },
    select: { guideKey: true, helpful: true },
  });
  const totals = new Map<string, { helpful: number; notHelpful: number }>();
  for (const item of feedback) {
    const current = totals.get(item.guideKey) ?? { helpful: 0, notHelpful: 0 };
    if (item.helpful) current.helpful += 1;
    else current.notHelpful += 1;
    totals.set(item.guideKey, current);
  }
  return guides.map((guide) =>
    mapManagedGuide(
      guide,
      totals.get(`tenant:${guide.id}`) ?? { helpful: 0, notHelpful: 0 },
    ),
  );
}

function mapManagedGuide(
  guide: ManagedGuideRecord,
  feedback: { helpful: number; notHelpful: number },
): ManagedHelpGuideResponseDto {
  return {
    id: guide.id,
    key: `tenant:${guide.id}`,
    context: guide.context,
    slug: guide.slug,
    sortOrder: guide.sortOrder,
    createdBy: guide.createdBy.displayName,
    archivedAt: guide.archivedAt?.toISOString() ?? null,
    draft: mapOptionalRevision(
      guide.revisions.find(({ status }) => status === 'DRAFT'),
    ),
    published: mapOptionalRevision(
      guide.revisions.find(({ status }) => status === 'PUBLISHED'),
    ),
    history: guide.revisions.map(mapRevision),
    helpfulCount: feedback.helpful,
    notHelpfulCount: feedback.notHelpful,
    createdAt: guide.createdAt.toISOString(),
    updatedAt: guide.updatedAt.toISOString(),
  };
}

function mapOptionalRevision(
  revision: RevisionRecord | undefined,
): HelpGuideRevisionResponseDto | null {
  return revision ? mapRevision(revision) : null;
}

function mapRevision(revision: RevisionRecord): HelpGuideRevisionResponseDto {
  return {
    id: revision.id,
    version: revision.version,
    status: revision.status,
    ...revisionContent(revision),
    createdBy: revision.createdBy.displayName,
    publishedBy: revision.publishedBy?.displayName ?? null,
    publishedAt: revision.publishedAt?.toISOString() ?? null,
    createdAt: revision.createdAt.toISOString(),
    updatedAt: revision.updatedAt.toISOString(),
  };
}

function revisionContent(revision: {
  titleEs: string;
  titleEn: string;
  summaryEs: string;
  summaryEn: string;
  stepsEs: Prisma.JsonValue;
  stepsEn: Prisma.JsonValue;
  mediaUrl: string | null;
  videoUrl: string | null;
  resourceLabelEs: string | null;
  resourceLabelEn: string | null;
  resourceUrl: string | null;
}): RevisionContent {
  return {
    titleEs: revision.titleEs,
    titleEn: revision.titleEn,
    summaryEs: revision.summaryEs,
    summaryEn: revision.summaryEn,
    stepsEs: parseSteps(revision.stepsEs),
    stepsEn: parseSteps(revision.stepsEn),
    mediaUrl: revision.mediaUrl,
    videoUrl: revision.videoUrl,
    resourceLabelEs: revision.resourceLabelEs,
    resourceLabelEn: revision.resourceLabelEn,
    resourceUrl: revision.resourceUrl,
  };
}

function contentFromCreate(input: CreateHelpGuideDto): RevisionContent {
  return {
    titleEs: input.titleEs,
    titleEn: input.titleEn,
    summaryEs: input.summaryEs,
    summaryEn: input.summaryEn,
    stepsEs: input.stepsEs.map((step) => step.trim()),
    stepsEn: input.stepsEn.map((step) => step.trim()),
    mediaUrl: input.mediaUrl ?? null,
    videoUrl: input.videoUrl ?? null,
    resourceLabelEs: input.resourceLabelEs ?? null,
    resourceLabelEn: input.resourceLabelEn ?? null,
    resourceUrl: input.resourceUrl ?? null,
  };
}

function mergeContent(
  base: RevisionRecord,
  input: UpdateHelpGuideDto,
): RevisionContent {
  const current = revisionContent(base);
  return {
    titleEs: input.titleEs ?? current.titleEs,
    titleEn: input.titleEn ?? current.titleEn,
    summaryEs: input.summaryEs ?? current.summaryEs,
    summaryEn: input.summaryEn ?? current.summaryEn,
    stepsEs: input.stepsEs?.map((step) => step.trim()) ?? current.stepsEs,
    stepsEn: input.stepsEn?.map((step) => step.trim()) ?? current.stepsEn,
    mediaUrl: input.mediaUrl === undefined ? current.mediaUrl : input.mediaUrl,
    videoUrl: input.videoUrl === undefined ? current.videoUrl : input.videoUrl,
    resourceLabelEs:
      input.resourceLabelEs === undefined
        ? current.resourceLabelEs
        : input.resourceLabelEs,
    resourceLabelEn:
      input.resourceLabelEn === undefined
        ? current.resourceLabelEn
        : input.resourceLabelEn,
    resourceUrl:
      input.resourceUrl === undefined ? current.resourceUrl : input.resourceUrl,
  };
}

function validateResource(content: RevisionContent): void {
  const resourceFields = [
    content.resourceUrl,
    content.resourceLabelEs,
    content.resourceLabelEn,
  ];
  if (resourceFields.some(Boolean) && !resourceFields.every(Boolean)) {
    throw invalidGuide();
  }
}

function parseSteps(value: Prisma.JsonValue): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((step) => typeof step === 'string')
  ) {
    throw invalidGuide();
  }
  return value;
}

function guideNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.HelpGuideNotFound,
    'The help guide was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function invalidGuide(): ApplicationError {
  return new ApplicationError(
    ErrorCode.HelpGuideInvalid,
    'The help guide is invalid for this operation.',
    HttpStatus.BAD_REQUEST,
  );
}

function slugConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.HelpGuideConflict,
    'A help guide with this slug already exists.',
    HttpStatus.CONFLICT,
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
