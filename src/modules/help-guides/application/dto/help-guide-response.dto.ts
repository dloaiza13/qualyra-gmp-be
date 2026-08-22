import { ApiProperty } from '@nestjs/swagger';
import {
  HelpGuideContext,
  HelpGuideRevisionStatus,
} from '../../../../generated/prisma/client.js';

export class HelpGuideRevisionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ enum: HelpGuideRevisionStatus })
  status!: HelpGuideRevisionStatus;

  @ApiProperty()
  titleEs!: string;

  @ApiProperty()
  titleEn!: string;

  @ApiProperty()
  summaryEs!: string;

  @ApiProperty()
  summaryEn!: string;

  @ApiProperty({ type: String, isArray: true })
  stepsEs!: string[];

  @ApiProperty({ type: String, isArray: true })
  stepsEn!: string[];

  @ApiProperty({ nullable: true, type: String })
  mediaUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  videoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  resourceLabelEs!: string | null;

  @ApiProperty({ nullable: true, type: String })
  resourceLabelEn!: string | null;

  @ApiProperty({ nullable: true, type: String })
  resourceUrl!: string | null;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty({ nullable: true, type: String })
  publishedBy!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  publishedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class PublishedHelpGuideResponseDto {
  @ApiProperty()
  key!: string;

  @ApiProperty({ enum: ['SYSTEM', 'TENANT'] })
  source!: 'SYSTEM' | 'TENANT';

  @ApiProperty({ enum: HelpGuideContext })
  context!: HelpGuideContext;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  titleEs!: string;

  @ApiProperty()
  titleEn!: string;

  @ApiProperty()
  summaryEs!: string;

  @ApiProperty()
  summaryEn!: string;

  @ApiProperty({ type: String, isArray: true })
  stepsEs!: string[];

  @ApiProperty({ type: String, isArray: true })
  stepsEn!: string[];

  @ApiProperty({ nullable: true, type: String })
  mediaUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  videoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  resourceLabelEs!: string | null;

  @ApiProperty({ nullable: true, type: String })
  resourceLabelEn!: string | null;

  @ApiProperty({ nullable: true, type: String })
  resourceUrl!: string | null;

  @ApiProperty({ nullable: true, type: Boolean })
  viewerFeedback!: boolean | null;
}

export class ManagedHelpGuideResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty({ enum: HelpGuideContext })
  context!: HelpGuideContext;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  archivedAt!: string | null;

  @ApiProperty({ nullable: true, type: HelpGuideRevisionResponseDto })
  draft!: HelpGuideRevisionResponseDto | null;

  @ApiProperty({ nullable: true, type: HelpGuideRevisionResponseDto })
  published!: HelpGuideRevisionResponseDto | null;

  @ApiProperty({ type: HelpGuideRevisionResponseDto, isArray: true })
  history!: HelpGuideRevisionResponseDto[];

  @ApiProperty()
  helpfulCount!: number;

  @ApiProperty()
  notHelpfulCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class HelpGuideFeedbackResponseDto {
  @ApiProperty()
  accepted!: boolean;

  @ApiProperty()
  helpful!: boolean;
}
