import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { documentStatuses, documentTypes } from './document-request.dto.js';

export class DocumentUserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'email' })
  email!: string;
}

export class DocumentVersionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 1 })
  versionNumber!: number;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty()
  changeSummary!: string;

  @ApiProperty({
    enum: [
      'DRAFT',
      'IN_REVIEW',
      'APPROVED',
      'EFFECTIVE',
      'SUPERSEDED',
      'OBSOLETE',
    ],
  })
  status!: string;

  @ApiProperty({ type: DocumentUserSummaryDto })
  createdBy!: DocumentUserSummaryDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class DocumentVersionResponseDto extends DocumentVersionSummaryDto {
  @ApiProperty()
  content!: string;
}

export class DocumentWorkflowResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  documentVersionId!: string;

  @ApiProperty({ minimum: 1 })
  versionNumber!: number;

  @ApiProperty({
    enum: ['PENDING_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
  })
  status!: string;

  @ApiProperty({ type: DocumentUserSummaryDto })
  requestedBy!: DocumentUserSummaryDto;

  @ApiProperty({ type: DocumentUserSummaryDto })
  reviewer!: DocumentUserSummaryDto;

  @ApiProperty({ type: DocumentUserSummaryDto })
  approver!: DocumentUserSummaryDto;

  @ApiPropertyOptional({ nullable: true })
  reviewComment!: string | null;

  @ApiPropertyOptional({ nullable: true })
  approvalComment!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  reviewedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  approvedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class DocumentReleaseResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  documentVersionId!: string;

  @ApiProperty({ minimum: 1 })
  versionNumber!: number;

  @ApiProperty({ enum: ['DOCUMENT_RELEASE'] })
  meaning!: string;

  @ApiProperty({ enum: ['PASSWORD_REAUTHENTICATION'] })
  authenticationMethod!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ type: DocumentUserSummaryDto })
  releasedBy!: DocumentUserSummaryDto;

  @ApiProperty({ format: 'date-time' })
  effectiveAt!: string;

  @ApiProperty({ format: 'date-time' })
  releasedAt!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  recordHash!: string;
}

export class DocumentObsolescenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  documentVersionId!: string;

  @ApiProperty({ minimum: 1 })
  versionNumber!: number;

  @ApiProperty({ enum: ['DOCUMENT_OBSOLESCENCE'] })
  meaning!: string;

  @ApiProperty({ enum: ['PASSWORD_REAUTHENTICATION'] })
  authenticationMethod!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ type: DocumentUserSummaryDto })
  obsoletedBy!: DocumentUserSummaryDto;

  @ApiProperty({ format: 'date-time' })
  obsoletedAt!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  recordHash!: string;
}

export class DocumentPeriodicReviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  documentVersionId!: string;

  @ApiProperty({ minimum: 1 })
  versionNumber!: number;

  @ApiProperty({ type: DocumentUserSummaryDto })
  assignedTo!: DocumentUserSummaryDto;

  @ApiProperty({ type: DocumentUserSummaryDto })
  scheduledBy!: DocumentUserSummaryDto;

  @ApiProperty({ minimum: 1, maximum: 60 })
  intervalMonths!: number;

  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({
    enum: ['UPCOMING', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'CANCELLED'],
  })
  dueState!: string;

  @ApiProperty({ format: 'date-time' })
  dueAt!: string;

  @ApiPropertyOptional({
    enum: ['CONFIRM_EFFECTIVE', 'REVISION_REQUIRED'],
    nullable: true,
  })
  decision!: string | null;

  @ApiPropertyOptional({ nullable: true })
  comment!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class DocumentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: documentTypes })
  type!: string;

  @ApiProperty({ enum: documentStatuses })
  status!: string;

  @ApiProperty({ minimum: 1 })
  currentVersionNumber!: number;

  @ApiProperty({ type: DocumentUserSummaryDto })
  owner!: DocumentUserSummaryDto;

  @ApiProperty({ type: DocumentUserSummaryDto })
  createdBy!: DocumentUserSummaryDto;

  @ApiProperty({ type: DocumentVersionSummaryDto })
  currentVersion!: DocumentVersionSummaryDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 60, nullable: true })
  periodicReviewIntervalMonths!: number | null;

  @ApiPropertyOptional({ type: DocumentUserSummaryDto, nullable: true })
  periodicReviewReviewer!: DocumentUserSummaryDto | null;

  @ApiPropertyOptional({
    type: DocumentPeriodicReviewResponseDto,
    nullable: true,
  })
  periodicReview!: DocumentPeriodicReviewResponseDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DocumentDetailResponseDto extends DocumentSummaryResponseDto {
  @ApiProperty({ type: DocumentVersionResponseDto, isArray: true })
  versions!: DocumentVersionResponseDto[];

  @ApiProperty({ type: DocumentWorkflowResponseDto, isArray: true })
  workflows!: DocumentWorkflowResponseDto[];

  @ApiProperty({ type: DocumentReleaseResponseDto, isArray: true })
  releases!: DocumentReleaseResponseDto[];

  @ApiProperty({ type: DocumentObsolescenceResponseDto, isArray: true })
  obsolescences!: DocumentObsolescenceResponseDto[];

  @ApiProperty({ type: DocumentPeriodicReviewResponseDto, isArray: true })
  periodicReviews!: DocumentPeriodicReviewResponseDto[];
}
