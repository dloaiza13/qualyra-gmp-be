import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import type { Prisma } from '../../../generated/prisma/client.js';

export function hasPermission(
  principal: AuthenticatedPrincipal,
  permission: string,
): boolean {
  return principal.effectivePermissions?.includes(permission) ?? false;
}

export function documentAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.DocumentWhereInput {
  if (hasPermission(principal, 'documents.read_all')) return {};
  return {
    OR: [
      { status: 'EFFECTIVE' },
      { ownerUserId: principal.userId },
      { createdByUserId: principal.userId },
      { versions: { some: { createdByUserId: principal.userId } } },
      {
        workflows: {
          some: {
            OR: [
              { requestedByUserId: principal.userId },
              { reviewerUserId: principal.userId },
              { approverUserId: principal.userId },
            ],
          },
        },
      },
      { periodicReviews: { some: { assignedToUserId: principal.userId } } },
    ],
  };
}

export function deviationAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.DeviationWhereInput {
  if (hasPermission(principal, 'deviations.read_all')) return {};
  return {
    OR: [
      { reportedByUserId: principal.userId },
      { investigatorUserId: principal.userId },
      { triagedByUserId: principal.userId },
      { investigation: { is: { completedByUserId: principal.userId } } },
    ],
  };
}

export function capaAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.CapaWhereInput {
  if (hasPermission(principal, 'capas.read_all')) return {};
  return {
    OR: [
      { createdByUserId: principal.userId },
      { deviation: { is: { reportedByUserId: principal.userId } } },
      { investigation: { is: { completedByUserId: principal.userId } } },
      { actions: { some: { assignedToUserId: principal.userId } } },
      {
        effectivenessReviews: {
          some: {
            OR: [
              { assignedToUserId: principal.userId },
              { scheduledByUserId: principal.userId },
            ],
          },
        },
      },
      { followUpCycles: { some: { createdByUserId: principal.userId } } },
    ],
  };
}

export function changeAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.ChangeControlWhereInput {
  if (hasPermission(principal, 'changes.read_all')) return {};
  return {
    OR: [
      { proposedByUserId: principal.userId },
      {
        assessment: {
          is: {
            OR: [
              { assessedByUserId: principal.userId },
              { ownerUserId: principal.userId },
              { approverUserId: principal.userId },
              { verifierUserId: principal.userId },
            ],
          },
        },
      },
      { tasks: { some: { assignedToUserId: principal.userId } } },
    ],
  };
}

export function auditAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.GmpAuditWhereInput {
  if (hasPermission(principal, 'audits.read_all')) return {};
  return {
    OR: [
      { createdByUserId: principal.userId },
      { leadAuditorUserId: principal.userId },
      { reviewerUserId: principal.userId },
      { findings: { some: { responsibleUserId: principal.userId } } },
    ],
  };
}

export function riskAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.QualityRiskAssessmentWhereInput {
  if (hasPermission(principal, 'risks.read_all')) return {};
  return {
    OR: [
      { createdByUserId: principal.userId },
      { ownerUserId: principal.userId },
      { reviewerUserId: principal.userId },
      { items: { some: { assignedToUserId: principal.userId } } },
    ],
  };
}

export function supplierAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.SupplierWhereInput {
  if (hasPermission(principal, 'suppliers.read_all')) return {};
  return {
    OR: [
      { createdByUserId: principal.userId },
      { qualityOwnerUserId: principal.userId },
      { approverUserId: principal.userId },
      { qualifications: { some: { evaluatedByUserId: principal.userId } } },
      { scars: { some: { createdByUserId: principal.userId } } },
      {
        scars: {
          some: {
            responses: {
              some: {
                OR: [
                  { respondedByUserId: principal.userId },
                  { reviewedByUserId: principal.userId },
                ],
              },
            },
          },
        },
      },
    ],
  };
}

export function equipmentAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.EquipmentWhereInput {
  if (hasPermission(principal, 'equipment.read_all')) return {};
  return {
    OR: [
      { createdByUserId: principal.userId },
      { ownerUserId: principal.userId },
      { verifierUserId: principal.userId },
    ],
  };
}

export function complaintAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.ProductComplaintWhereInput {
  if (hasPermission(principal, 'complaints.read_all')) return {};
  return {
    OR: [
      { reportedByUserId: principal.userId },
      { investigatorUserId: principal.userId },
      { reviewerUserId: principal.userId },
      { triagedByUserId: principal.userId },
    ],
  };
}

export function recallAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.ProductRecallWhereInput {
  if (hasPermission(principal, 'recalls.read_all')) return {};
  return {
    OR: [
      { reportedByUserId: principal.userId },
      { approverUserId: principal.userId },
      { riskAssessment: { is: { assessedByUserId: principal.userId } } },
      { executionUpdates: { some: { recordedByUserId: principal.userId } } },
    ],
  };
}

export function productReviewAccessWhere(
  principal: AuthenticatedPrincipal,
): Prisma.ProductQualityReviewWhereInput {
  if (hasPermission(principal, 'product_reviews.read_all')) return {};
  return {
    OR: [
      { createdByUserId: principal.userId },
      { approverUserId: principal.userId },
      { assessment: { is: { preparedByUserId: principal.userId } } },
    ],
  };
}
