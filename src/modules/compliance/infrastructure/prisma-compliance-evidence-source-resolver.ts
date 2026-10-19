import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  ComplianceEvidenceSourceResolver,
  type ComplianceEvidenceSourceType,
} from '../domain/compliance-evidence-source.js';

@Injectable()
export class PrismaComplianceEvidenceSourceResolver extends ComplianceEvidenceSourceResolver {
  async exists(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    sourceType: ComplianceEvidenceSourceType,
    sourceId: string,
  ): Promise<boolean> {
    const where = { id: sourceId, tenantId };
    switch (sourceType) {
      case 'DOCUMENT':
        return Boolean(
          await transaction.document.findFirst({ where, select: { id: true } }),
        );
      case 'TRAINING_ASSIGNMENT':
        return Boolean(
          await transaction.trainingAssignment.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'CAPA':
        return Boolean(
          await transaction.capa.findFirst({ where, select: { id: true } }),
        );
      case 'AUDIT':
        return Boolean(
          await transaction.gmpAudit.findFirst({ where, select: { id: true } }),
        );
      case 'DEVIATION':
        return Boolean(
          await transaction.deviation.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'EQUIPMENT':
        return Boolean(
          await transaction.equipment.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'CALIBRATION':
        return Boolean(
          await transaction.equipmentCalibration.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'SUPPLIER':
        return Boolean(
          await transaction.supplier.findFirst({ where, select: { id: true } }),
        );
      case 'CHANGE_CONTROL':
        return Boolean(
          await transaction.changeControl.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'QUALITY_RISK':
        return Boolean(
          await transaction.qualityRiskAssessment.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'COMPLAINT':
        return Boolean(
          await transaction.productComplaint.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'RECALL':
        return Boolean(
          await transaction.productRecall.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'PRODUCT_REVIEW':
        return Boolean(
          await transaction.productQualityReview.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'PHOTO_EVIDENCE':
        return Boolean(
          await transaction.photoEvidence.findFirst({
            where,
            select: { id: true },
          }),
        );
    }
  }
}
