import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CapaUserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'email' })
  email!: string;
}

export class CapaDeviationSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'DEV-2026-0001' })
  code!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ enum: ['MINOR', 'MAJOR', 'CRITICAL'], nullable: true })
  severity!: string | null;
}

export class CapaActionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['CORRECTIVE', 'PREVENTIVE'] })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: CapaUserSummaryDto })
  assignedTo!: CapaUserSummaryDto;

  @ApiProperty({ format: 'date-time' })
  dueAt!: string;

  @ApiProperty({ format: 'date-time' })
  effectiveDueAt!: string;

  @ApiPropertyOptional({ minimum: 1, nullable: true })
  followUpCycleNumber!: number | null;

  @ApiProperty({ enum: ['OPEN', 'COMPLETED'] })
  status!: string;

  @ApiProperty({
    enum: ['ON_TRACK', 'DUE_SOON', 'OVERDUE', 'ESCALATED', 'COMPLETED'],
  })
  dueState!: string;

  @ApiPropertyOptional({ enum: ['ACTION_COMPLETION'], nullable: true })
  meaning!: string | null;

  @ApiPropertyOptional({ enum: ['PASSWORD_REAUTHENTICATION'], nullable: true })
  authenticationMethod!: string | null;

  @ApiPropertyOptional({ nullable: true })
  completionComment!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ minLength: 64, maxLength: 64, nullable: true })
  recordHash!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: () => CapaActionExtensionResponseDto, isArray: true })
  extensions!: CapaActionExtensionResponseDto[];

  @ApiProperty({
    type: () => CapaActionEvidenceReferenceResponseDto,
    isArray: true,
  })
  evidenceReferences!: CapaActionEvidenceReferenceResponseDto[];
}

export class CapaActionExtensionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  previousDueAt!: string;

  @ApiProperty({ format: 'date-time' })
  newDueAt!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ type: CapaUserSummaryDto })
  approvedBy!: CapaUserSummaryDto;

  @ApiProperty({ enum: ['ACTION_EXTENSION_APPROVAL'] })
  meaning!: string;

  @ApiProperty({ enum: ['PASSWORD_REAUTHENTICATION'] })
  authenticationMethod!: string;

  @ApiProperty({ format: 'date-time' })
  approvedAt!: string;

  @ApiProperty({ minLength: 64, maxLength: 64 })
  recordHash!: string;
}

export class CapaActionEvidenceReferenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty({ minLength: 64, maxLength: 64 })
  sha256!: string;

  @ApiProperty()
  storageReference!: string;

  @ApiProperty()
  managed!: boolean;

  @ApiPropertyOptional({ nullable: true })
  downloadUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CapaEvidenceUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty({ minLength: 64, maxLength: 64 })
  sha256!: string;

  @ApiProperty({ enum: ['AVAILABLE'] })
  scanStatus!: string;

  @ApiProperty()
  scanEngine!: string;

  @ApiProperty()
  scanResult!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class CapaAuditExportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty({ enum: ['JSON'] })
  format!: string;

  @ApiProperty({ example: 'qualyra.capa.audit.v1' })
  schemaVersion!: string;

  @ApiProperty({ minimum: 1 })
  recordCount!: number;

  @ApiProperty({ minLength: 64, maxLength: 64 })
  manifestHash!: string;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  manifest!: object;
}

export class CapaAnalyticsBucketDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  count!: number;
}

export class CapaAnalyticsAssigneeDto {
  @ApiProperty({ type: CapaUserSummaryDto })
  user!: CapaUserSummaryDto;

  @ApiProperty()
  openItems!: number;

  @ApiProperty()
  escalatedItems!: number;
}

export class CapaAnalyticsNotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  capaCode!: string;

  @ApiProperty()
  subjectType!: string;

  @ApiProperty()
  dueState!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: CapaUserSummaryDto })
  recipient!: CapaUserSummaryDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CapaAnalyticsResponseDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty()
  totalCapas!: number;

  @ApiProperty()
  activeCapas!: number;

  @ApiProperty()
  closedEffective!: number;

  @ApiProperty()
  ineffectiveReviews!: number;

  @ApiProperty()
  effectivenessRate!: number | null;

  @ApiProperty()
  overdueItems!: number;

  @ApiProperty()
  escalatedItems!: number;

  @ApiProperty({ type: CapaAnalyticsBucketDto, isArray: true })
  byStatus!: CapaAnalyticsBucketDto[];

  @ApiProperty({ type: CapaAnalyticsBucketDto, isArray: true })
  bySeverity!: CapaAnalyticsBucketDto[];

  @ApiProperty({ type: CapaAnalyticsAssigneeDto, isArray: true })
  workload!: CapaAnalyticsAssigneeDto[];

  @ApiProperty({ type: CapaAnalyticsNotificationDto, isArray: true })
  recentNotifications!: CapaAnalyticsNotificationDto[];
}

export class CapaEffectivenessReviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 0 })
  cycleNumber!: number;

  @ApiProperty()
  criterion!: string;

  @ApiProperty({ type: CapaUserSummaryDto })
  assignedTo!: CapaUserSummaryDto;

  @ApiProperty({ type: CapaUserSummaryDto })
  scheduledBy!: CapaUserSummaryDto;

  @ApiProperty({ format: 'date-time' })
  dueAt!: string;

  @ApiProperty({ enum: ['SCHEDULED', 'COMPLETED'] })
  status!: string;

  @ApiProperty({
    enum: ['ON_TRACK', 'DUE_SOON', 'OVERDUE', 'ESCALATED', 'COMPLETED'],
  })
  dueState!: string;

  @ApiPropertyOptional({ enum: ['EFFECTIVE', 'INEFFECTIVE'], nullable: true })
  decision!: string | null;

  @ApiPropertyOptional({ nullable: true })
  evidence!: string | null;

  @ApiPropertyOptional({ enum: ['EFFECTIVENESS_VERIFICATION'], nullable: true })
  meaning!: string | null;

  @ApiPropertyOptional({ enum: ['PASSWORD_REAUTHENTICATION'], nullable: true })
  authenticationMethod!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ minLength: 64, maxLength: 64, nullable: true })
  recordHash!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CapaSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CAPA-2026-0001' })
  code!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    enum: [
      'OPEN',
      'IN_PROGRESS',
      'IMPLEMENTATION_COMPLETED',
      'FOLLOW_UP_ACTIONS',
      'FOLLOW_UP_IMPLEMENTATION_COMPLETED',
      'EFFECTIVENESS_REVIEW',
      'CLOSED_EFFECTIVE',
      'INEFFECTIVE',
    ],
  })
  status!: string;

  @ApiProperty({
    enum: ['ON_TRACK', 'DUE_SOON', 'OVERDUE', 'ESCALATED', 'COMPLETED'],
  })
  dueState!: string;

  @ApiProperty({ type: CapaDeviationSummaryDto })
  deviation!: CapaDeviationSummaryDto;

  @ApiProperty({ type: CapaUserSummaryDto })
  createdBy!: CapaUserSummaryDto;

  @ApiProperty()
  actionCount!: number;

  @ApiProperty()
  completedActionCount!: number;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  nextDueAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  effectivenessDueAt!: string | null;

  @ApiPropertyOptional({ enum: ['EFFECTIVE', 'INEFFECTIVE'], nullable: true })
  effectivenessDecision!: string | null;

  @ApiProperty({ minimum: 0 })
  currentCycleNumber!: number;

  @ApiProperty({ minimum: 0 })
  followUpCycleCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CapaDetailResponseDto extends CapaSummaryResponseDto {
  @ApiProperty()
  objective!: string;

  @ApiProperty({ format: 'uuid' })
  investigationId!: string;

  @ApiProperty()
  rootCause!: string;

  @ApiProperty()
  capaRationale!: string;

  @ApiProperty({ minLength: 64, maxLength: 64 })
  investigationRecordHash!: string;

  @ApiProperty({ type: CapaActionResponseDto, isArray: true })
  actions!: CapaActionResponseDto[];

  @ApiPropertyOptional({
    type: CapaEffectivenessReviewResponseDto,
    nullable: true,
  })
  effectivenessReview!: CapaEffectivenessReviewResponseDto | null;

  @ApiProperty({ type: CapaEffectivenessReviewResponseDto, isArray: true })
  effectivenessReviews!: CapaEffectivenessReviewResponseDto[];

  @ApiProperty({ type: () => CapaFollowUpCycleResponseDto, isArray: true })
  followUpCycles!: CapaFollowUpCycleResponseDto[];
}

export class CapaFollowUpCycleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 1 })
  cycleNumber!: number;

  @ApiProperty()
  rationale!: string;

  @ApiProperty({ format: 'uuid' })
  sourceEffectivenessReviewId!: string;

  @ApiProperty({ type: CapaUserSummaryDto })
  createdBy!: CapaUserSummaryDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  lockedAt!: string;
}
