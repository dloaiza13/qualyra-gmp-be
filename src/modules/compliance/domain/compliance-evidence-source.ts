import type { Prisma } from '../../../generated/prisma/client.js';

export const complianceEvidenceSourceTypes = [
  'DOCUMENT',
  'TRAINING_ASSIGNMENT',
  'CAPA',
  'AUDIT',
  'DEVIATION',
  'EQUIPMENT',
  'CALIBRATION',
  'SUPPLIER',
  'CHANGE_CONTROL',
  'QUALITY_RISK',
  'COMPLAINT',
  'RECALL',
  'PRODUCT_REVIEW',
  'PHOTO_EVIDENCE',
] as const;

export type ComplianceEvidenceSourceType =
  (typeof complianceEvidenceSourceTypes)[number];

export abstract class ComplianceEvidenceSourceResolver {
  abstract navigation(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    sourceType: ComplianceEvidenceSourceType,
    sourceId: string,
  ): Promise<{
    modulePath: string;
    recordId: string;
    permission: string;
  } | null>;

  abstract exists(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    sourceType: ComplianceEvidenceSourceType,
    sourceId: string,
  ): Promise<boolean>;
}
