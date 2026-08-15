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
}
