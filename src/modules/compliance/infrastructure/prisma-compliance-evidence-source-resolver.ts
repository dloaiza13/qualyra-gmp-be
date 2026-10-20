import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  ComplianceEvidenceSourceResolver,
  type ComplianceEvidenceSourceType,
} from '../domain/compliance-evidence-source.js';

@Injectable()
export class PrismaComplianceEvidenceSourceResolver extends ComplianceEvidenceSourceResolver {
  async navigation(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    sourceType: ComplianceEvidenceSourceType,
    sourceId: string,
  ): Promise<{
    modulePath: string;
    recordId: string;
    permission: string;
  } | null> {
    if (!(await this.exists(transaction, tenantId, sourceType, sourceId)))
      return null;
    if (sourceType === 'CALIBRATION') {
      const calibration =
        await transaction.equipmentCalibration.findFirstOrThrow({
          where: { id: sourceId, tenantId },
          select: { equipmentId: true },
        });
      return {
        modulePath: 'equipment',
        recordId: calibration.equipmentId,
        permission: 'equipment.read',
      };
    }
    if (sourceType === 'PHOTO_EVIDENCE') {
      const photo = await transaction.photoEvidence.findFirstOrThrow({
        where: { id: sourceId, tenantId },
        select: { subjectType: true, subjectId: true },
      });
      return this.navigation(
        transaction,
        tenantId,
        photo.subjectType,
        photo.subjectId,
      );
    }
    const targets = {
      DOCUMENT: ['documents', 'documents.read'],
      TRAINING_ASSIGNMENT: ['training', 'training.read'],
      CAPA: ['capas', 'capas.read'],
      AUDIT: ['audits', 'audits.read'],
      DEVIATION: ['deviations', 'deviations.read'],
      EQUIPMENT: ['equipment', 'equipment.read'],
      SUPPLIER: ['suppliers', 'suppliers.read'],
      CHANGE_CONTROL: ['changes', 'changes.read'],
      QUALITY_RISK: ['risks', 'risks.read'],
      COMPLAINT: ['complaints', 'complaints.read'],
      RECALL: ['recalls', 'recalls.read'],
      PRODUCT_REVIEW: ['product-reviews', 'product_reviews.read'],
    } as const;
    const [modulePath, permission] = targets[sourceType];
    return { modulePath, recordId: sourceId, permission };
  }

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
