import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  OperationalReportExportDto,
  OperationalReportQueryDto,
} from './dto/report-request.dto.js';
import {
  type OperationalReportKpisDto,
  type OperationalReportResponseDto,
  type ReportModuleId,
  type ReportModuleSummaryDto,
  type ReportPriorityItemDto,
  type ReportTrendPointDto,
} from './dto/report-response.dto.js';
import { OperationalReportPdfService } from './operational-report-pdf.service.js';

interface AggregateRow {
  kind: 'SUMMARY' | 'TREND';
  module: ReportModuleId;
  status: string | null;
  month: string | null;
  total: number;
  open: number;
  overdue: number;
  critical: number;
}

interface PriorityRow {
  module: ReportModuleId;
  id: string;
  code: string;
  title: string;
  status: string;
  dueAt: Date | null;
  isCritical: boolean;
}

export interface OperationalReportExport {
  bytes: Buffer;
  fileName: string;
  reportId: string;
  dataSha256: string;
  pdfSha256: string;
}

const modulePermissions: readonly [ReportModuleId, string][] = [
  ['documents', 'documents.read_all'],
  ['training', 'training.assign'],
  ['deviations', 'deviations.read_all'],
  ['capas', 'capas.read_all'],
  ['changes', 'changes.read_all'],
  ['audits', 'audits.read_all'],
  ['risks', 'risks.read_all'],
  ['suppliers', 'suppliers.read_all'],
  ['equipment', 'equipment.read_all'],
  ['complaints', 'complaints.read_all'],
  ['recalls', 'recalls.read_all'],
  ['productReviews', 'product_reviews.read_all'],
];

const dayMilliseconds = 24 * 60 * 60 * 1000;

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly pdf: OperationalReportPdfService,
  ) {}

  operational(
    principal: AuthenticatedPrincipal,
    permissions: ReadonlySet<string>,
    query: OperationalReportQueryDto,
  ): Promise<OperationalReportResponseDto> {
    const generatedAt = new Date();
    const period = resolvePeriod(query, generatedAt);
    const previousPeriod = precedingPeriod(period);
    const allowed = Object.fromEntries(
      modulePermissions.map(([module, permission]) => [
        module,
        permissions.has(permission),
      ]),
    ) as Record<ReportModuleId, boolean>;

    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const rows = await aggregateRows(
          transaction,
          principal.tenantId,
          allowed,
          period.from,
          period.toExclusive,
          generatedAt,
        );
        const previousRows = await aggregateRows(
          transaction,
          principal.tenantId,
          allowed,
          previousPeriod.from,
          previousPeriod.toExclusive,
          generatedAt,
        );
        const priorities = await priorityRows(
          transaction,
          principal.tenantId,
          allowed,
          period.from,
          period.toExclusive,
          generatedAt,
        );
        return buildResponse(
          rows,
          previousRows,
          priorities,
          allowed,
          period,
          previousPeriod,
          generatedAt,
        );
      },
    );
  }

  async exportOperationalPdf(
    principal: AuthenticatedPrincipal,
    permissions: ReadonlySet<string>,
    input: OperationalReportExportDto,
    request: RequestMetadata,
  ): Promise<OperationalReportExport> {
    const report = await this.operational(principal, permissions, input);
    const identity = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const tenant = await transaction.tenant.findUniqueOrThrow({
          where: { id: principal.tenantId },
          select: { name: true, slug: true },
        });
        const user = await transaction.user.findUniqueOrThrow({
          where: { id: principal.userId },
          select: { displayName: true, email: true },
        });
        return { tenant, user };
      },
    );
    const reportId = randomUUID();
    const dataSha256 = createHash('sha256')
      .update(JSON.stringify(report))
      .digest('hex');
    const bytes = await this.pdf.render({
      report,
      reportId,
      dataSha256,
      locale: input.locale ?? 'es',
      tenant: identity.tenant,
      user: identity.user,
    });
    const pdfSha256 = createHash('sha256').update(bytes).digest('hex');

    await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'QUALITY_REPORT_EXPORTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            reportId,
            from: report.period.from,
            to: report.period.to,
            moduleCount: report.modules.length,
            recordCount: report.kpis.totalRecords,
            dataSha256,
            pdfSha256,
          },
        });
      },
    );

    return {
      bytes,
      fileName: `qualyra-reporte-${identity.tenant.slug}-${report.period.from}-${report.period.to}.pdf`,
      reportId,
      dataSha256,
      pdfSha256,
    };
  }
}

function aggregateRows(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  allowed: Record<ReportModuleId, boolean>,
  from: Date,
  toExclusive: Date,
  now: Date,
): Promise<AggregateRow[]> {
  return transaction.$queryRaw<AggregateRow[]>`
    WITH report_records AS (
      SELECT
        'documents'::text AS module,
        document.status::text AS status,
        document.created_at,
        document.status NOT IN ('EFFECTIVE', 'OBSOLETE') AS is_open,
        document.status <> 'OBSOLETE' AND EXISTS (
          SELECT 1 FROM document_periodic_reviews review
          WHERE review.tenant_id = document.tenant_id
            AND review.document_id = document.id
            AND review.status = 'PENDING'
            AND review.due_at < ${now}
        ) AS is_overdue,
        false AS is_critical
      FROM documents document
      WHERE ${allowed.documents}
        AND document.tenant_id = ${tenantId}::uuid
        AND document.created_at >= ${from}
        AND document.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'training'::text,
        assignment.status::text,
        assignment.created_at,
        assignment.status = 'ASSIGNED',
        assignment.status = 'ASSIGNED' AND assignment.due_at < ${now},
        false
      FROM training_assignments assignment
      WHERE ${allowed.training}
        AND assignment.tenant_id = ${tenantId}::uuid
        AND assignment.created_at >= ${from}
        AND assignment.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'deviations'::text,
        deviation.status::text,
        deviation.created_at,
        deviation.status NOT IN ('CLOSED', 'CANCELLED'),
        deviation.status NOT IN ('CLOSED', 'CANCELLED')
          AND deviation.investigation_due_at IS NOT NULL
          AND deviation.investigation_due_at < ${now},
        deviation.status NOT IN ('CLOSED', 'CANCELLED')
          AND deviation.severity = 'CRITICAL'
      FROM deviations deviation
      WHERE ${allowed.deviations}
        AND deviation.tenant_id = ${tenantId}::uuid
        AND deviation.created_at >= ${from}
        AND deviation.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'capas'::text,
        capa_state.status,
        capa.created_at,
        capa_state.status <> 'CLOSED_EFFECTIVE',
        capa_state.status <> 'CLOSED_EFFECTIVE' AND (
          EXISTS (
            SELECT 1 FROM capa_actions action
            WHERE action.tenant_id = capa.tenant_id
              AND action.capa_id = capa.id
              AND action.status = 'OPEN'
              AND COALESCE(
                (
                  SELECT extension.new_due_at
                  FROM capa_action_extensions extension
                  WHERE extension.tenant_id = action.tenant_id
                    AND extension.action_id = action.id
                  ORDER BY extension.approved_at DESC, extension.id DESC
                  LIMIT 1
                ),
                action.due_at
              ) < ${now}
          ) OR EXISTS (
            SELECT 1 FROM capa_effectiveness_reviews review
            WHERE review.tenant_id = capa.tenant_id
              AND review.capa_id = capa.id
              AND review.status = 'SCHEDULED'
              AND review.due_at < ${now}
          )
        ),
        capa_state.status <> 'CLOSED_EFFECTIVE' AND deviation.severity = 'CRITICAL'
      FROM capas capa
      INNER JOIN deviations deviation
        ON deviation.tenant_id = capa.tenant_id AND deviation.id = capa.deviation_id
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN EXISTS (
            SELECT 1 FROM capa_actions action
            WHERE action.tenant_id = capa.tenant_id
              AND action.capa_id = capa.id
              AND action.status = 'OPEN'
          ) THEN 'ACTIVE'
          WHEN EXISTS (
            SELECT 1 FROM capa_effectiveness_reviews review
            WHERE review.tenant_id = capa.tenant_id
              AND review.capa_id = capa.id
              AND review.status = 'SCHEDULED'
          ) THEN 'EFFECTIVENESS_REVIEW'
          WHEN (
            SELECT review.decision::text
            FROM capa_effectiveness_reviews review
            WHERE review.tenant_id = capa.tenant_id
              AND review.capa_id = capa.id
              AND review.status = 'COMPLETED'
            ORDER BY review.cycle_number DESC
            LIMIT 1
          ) = 'EFFECTIVE' THEN 'CLOSED_EFFECTIVE'
          WHEN (
            SELECT review.decision::text
            FROM capa_effectiveness_reviews review
            WHERE review.tenant_id = capa.tenant_id
              AND review.capa_id = capa.id
              AND review.status = 'COMPLETED'
            ORDER BY review.cycle_number DESC
            LIMIT 1
          ) = 'INEFFECTIVE' THEN 'INEFFECTIVE'
          ELSE 'IMPLEMENTATION_COMPLETED'
        END AS status
      ) capa_state
      WHERE ${allowed.capas}
        AND capa.tenant_id = ${tenantId}::uuid
        AND capa.created_at >= ${from}
        AND capa.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'changes'::text,
        change.status::text,
        change.created_at,
        change.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED'),
        change.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED')
          AND change.target_completion_at < ${now},
        change.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED')
          AND assessment.risk_level = 'CRITICAL'
      FROM change_controls change
      LEFT JOIN change_control_assessments assessment
        ON assessment.tenant_id = change.tenant_id
        AND assessment.change_control_id = change.id
      WHERE ${allowed.changes}
        AND change.tenant_id = ${tenantId}::uuid
        AND change.created_at >= ${from}
        AND change.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'audits'::text,
        audit.status::text,
        audit.created_at,
        audit.status NOT IN ('CLOSED', 'CANCELLED'),
        audit.status NOT IN ('CLOSED', 'CANCELLED')
          AND audit.scheduled_end_at < ${now},
        audit.status NOT IN ('CLOSED', 'CANCELLED') AND EXISTS (
          SELECT 1 FROM audit_findings finding
          WHERE finding.tenant_id = audit.tenant_id
            AND finding.audit_id = audit.id
            AND finding.status <> 'CLOSED'
            AND finding.classification = 'CRITICAL'
        )
      FROM audits audit
      WHERE ${allowed.audits}
        AND audit.tenant_id = ${tenantId}::uuid
        AND audit.created_at >= ${from}
        AND audit.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'risks'::text,
        risk.status::text,
        risk.created_at,
        risk.status NOT IN ('CLOSED', 'CANCELLED'),
        risk.status NOT IN ('CLOSED', 'CANCELLED') AND (
          risk.target_review_at < ${now} OR EXISTS (
            SELECT 1 FROM quality_risk_items item
            WHERE item.tenant_id = risk.tenant_id
              AND item.risk_id = risk.id
              AND item.status = 'OPEN'
              AND item.due_at < ${now}
          )
        ),
        risk.status NOT IN ('CLOSED', 'CANCELLED') AND EXISTS (
          SELECT 1 FROM quality_risk_items item
          WHERE item.tenant_id = risk.tenant_id
            AND item.risk_id = risk.id
            AND COALESCE(item.residual_rpn, item.initial_rpn) > 80
        )
      FROM quality_risk_assessments risk
      WHERE ${allowed.risks}
        AND risk.tenant_id = ${tenantId}::uuid
        AND risk.created_at >= ${from}
        AND risk.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'suppliers'::text,
        supplier.status::text,
        supplier.created_at,
        supplier.status = 'PENDING_QUALIFICATION'
          OR supplier.next_review_at < ${now},
        supplier.next_review_at IS NOT NULL
          AND supplier.next_review_at < ${now},
        supplier.criticality = 'CRITICAL' AND (
          supplier.status = 'PENDING_QUALIFICATION'
          OR supplier.next_review_at < ${now}
        )
      FROM suppliers supplier
      WHERE ${allowed.suppliers}
        AND supplier.tenant_id = ${tenantId}::uuid
        AND supplier.created_at >= ${from}
        AND supplier.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'equipment'::text,
        equipment.status::text,
        equipment.created_at,
        equipment.status = 'OUT_OF_SERVICE' OR (
          equipment.status = 'ACTIVE' AND (
            (equipment.calibration_required AND equipment.next_calibration_at < ${now})
            OR (equipment.maintenance_required AND equipment.next_maintenance_at < ${now})
          )
        ),
        equipment.status = 'ACTIVE' AND (
          (equipment.calibration_required AND equipment.next_calibration_at < ${now})
          OR (equipment.maintenance_required AND equipment.next_maintenance_at < ${now})
        ),
        equipment.criticality = 'CRITICAL' AND (
          equipment.status = 'OUT_OF_SERVICE' OR (
            equipment.status = 'ACTIVE' AND (
              (equipment.calibration_required AND equipment.next_calibration_at < ${now})
              OR (equipment.maintenance_required AND equipment.next_maintenance_at < ${now})
            )
          )
        )
      FROM equipment equipment
      WHERE ${allowed.equipment}
        AND equipment.tenant_id = ${tenantId}::uuid
        AND equipment.created_at >= ${from}
        AND equipment.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'complaints'::text,
        complaint.status::text,
        complaint.created_at,
        complaint.status NOT IN ('CLOSED', 'CANCELLED'),
        complaint.status NOT IN ('CLOSED', 'CANCELLED')
          AND complaint.target_close_at IS NOT NULL
          AND complaint.target_close_at < ${now},
        complaint.status NOT IN ('CLOSED', 'CANCELLED')
          AND (complaint.severity = 'CRITICAL' OR complaint.potential_safety_event)
      FROM product_complaints complaint
      WHERE ${allowed.complaints}
        AND complaint.tenant_id = ${tenantId}::uuid
        AND complaint.created_at >= ${from}
        AND complaint.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'recalls'::text,
        recall.status::text,
        recall.created_at,
        recall.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED'),
        recall.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED')
          AND recall.target_close_at < ${now},
        recall.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED')
          AND assessment.classification = 'CLASS_I'
      FROM product_recalls recall
      LEFT JOIN recall_risk_assessments assessment
        ON assessment.tenant_id = recall.tenant_id
        AND assessment.recall_id = recall.id
      WHERE ${allowed.recalls}
        AND recall.tenant_id = ${tenantId}::uuid
        AND recall.created_at >= ${from}
        AND recall.created_at < ${toExclusive}

      UNION ALL

      SELECT
        'productReviews'::text,
        review.status::text,
        review.created_at,
        review.status NOT IN ('APPROVED', 'CANCELLED'),
        review.status NOT IN ('APPROVED', 'CANCELLED')
          AND review.target_completion_at < ${now},
        review.status = 'FOLLOW_UP_REQUIRED'
          OR (review.status NOT IN ('APPROVED', 'CANCELLED')
            AND review.target_completion_at < ${now})
      FROM product_quality_reviews review
      WHERE ${allowed.productReviews}
        AND review.tenant_id = ${tenantId}::uuid
        AND review.created_at >= ${from}
        AND review.created_at < ${toExclusive}
    )
    SELECT
      'SUMMARY'::text AS kind,
      module,
      status,
      NULL::text AS month,
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE is_open)::integer AS open,
      COUNT(*) FILTER (WHERE is_overdue)::integer AS overdue,
      COUNT(*) FILTER (WHERE is_critical)::integer AS critical
    FROM report_records
    GROUP BY module, status

    UNION ALL

    SELECT
      'TREND'::text,
      module,
      NULL::text,
      TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM'),
      COUNT(*)::integer,
      0,
      0,
      0
    FROM report_records
    GROUP BY module, DATE_TRUNC('month', created_at)
    ORDER BY kind, module, month, status
  `;
}

function priorityRows(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  allowed: Record<ReportModuleId, boolean>,
  from: Date,
  toExclusive: Date,
  now: Date,
): Promise<PriorityRow[]> {
  return transaction.$queryRaw<PriorityRow[]>`
    WITH priority_records AS (
      SELECT
        'documents'::text AS module,
        document.id::text AS id,
        document.code::text AS code,
        version.title::text AS title,
        document.status::text AS status,
        review.due_at AS "dueAt",
        false AS "isCritical"
      FROM documents document
      CROSS JOIN LATERAL (
        SELECT title FROM document_versions version
        WHERE version.tenant_id = document.tenant_id
          AND version.document_id = document.id
        ORDER BY version.version_number DESC
        LIMIT 1
      ) version
      CROSS JOIN LATERAL (
        SELECT MIN(due_at) AS due_at FROM document_periodic_reviews review
        WHERE review.tenant_id = document.tenant_id
          AND review.document_id = document.id
          AND review.status = 'PENDING'
      ) review
      WHERE ${allowed.documents}
        AND document.tenant_id = ${tenantId}::uuid
        AND document.created_at >= ${from}
        AND document.created_at < ${toExclusive}
        AND document.status <> 'OBSOLETE'
        AND review.due_at < ${now}

      UNION ALL

      SELECT
        'training', assignment.id::text, document.code::text,
        version.title::text, assignment.status::text, assignment.due_at, false
      FROM training_assignments assignment
      INNER JOIN documents document
        ON document.tenant_id = assignment.tenant_id
        AND document.id = assignment.document_id
      INNER JOIN document_versions version
        ON version.tenant_id = assignment.tenant_id
        AND version.id = assignment.document_version_id
      WHERE ${allowed.training}
        AND assignment.tenant_id = ${tenantId}::uuid
        AND assignment.created_at >= ${from}
        AND assignment.created_at < ${toExclusive}
        AND assignment.status = 'ASSIGNED'
        AND assignment.due_at < ${now}

      UNION ALL

      SELECT
        'deviations', deviation.id::text, deviation.code::text,
        deviation.title::text, deviation.status::text,
        deviation.investigation_due_at,
        deviation.severity = 'CRITICAL'
      FROM deviations deviation
      WHERE ${allowed.deviations}
        AND deviation.tenant_id = ${tenantId}::uuid
        AND deviation.created_at >= ${from}
        AND deviation.created_at < ${toExclusive}
        AND deviation.status NOT IN ('CLOSED', 'CANCELLED')
        AND (
          deviation.severity = 'CRITICAL'
          OR deviation.investigation_due_at < ${now}
        )

      UNION ALL

      SELECT
        'capas', capa.id::text, capa.code::text, capa.title::text,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM capa_actions action
            WHERE action.tenant_id = capa.tenant_id
              AND action.capa_id = capa.id AND action.status = 'OPEN'
          ) THEN 'ACTIVE'
          WHEN EXISTS (
            SELECT 1 FROM capa_effectiveness_reviews review
            WHERE review.tenant_id = capa.tenant_id
              AND review.capa_id = capa.id AND review.status = 'SCHEDULED'
          ) THEN 'EFFECTIVENESS_REVIEW'
          ELSE 'IMPLEMENTATION_COMPLETED'
        END,
        due.due_at,
        deviation.severity = 'CRITICAL'
      FROM capas capa
      INNER JOIN deviations deviation
        ON deviation.tenant_id = capa.tenant_id AND deviation.id = capa.deviation_id
      CROSS JOIN LATERAL (
        SELECT MIN(candidate.due_at) AS due_at
        FROM (
          SELECT COALESCE(
            (
              SELECT extension.new_due_at
              FROM capa_action_extensions extension
              WHERE extension.tenant_id = action.tenant_id
                AND extension.action_id = action.id
              ORDER BY extension.approved_at DESC, extension.id DESC
              LIMIT 1
            ), action.due_at
          ) AS due_at
          FROM capa_actions action
          WHERE action.tenant_id = capa.tenant_id
            AND action.capa_id = capa.id AND action.status = 'OPEN'
          UNION ALL
          SELECT review.due_at
          FROM capa_effectiveness_reviews review
          WHERE review.tenant_id = capa.tenant_id
            AND review.capa_id = capa.id AND review.status = 'SCHEDULED'
        ) candidate
      ) due
      WHERE ${allowed.capas}
        AND capa.tenant_id = ${tenantId}::uuid
        AND capa.created_at >= ${from}
        AND capa.created_at < ${toExclusive}
        AND (deviation.severity = 'CRITICAL' OR due.due_at < ${now})

      UNION ALL

      SELECT
        'changes', change.id::text, change.code::text, change.title::text,
        change.status::text, change.target_completion_at,
        assessment.risk_level = 'CRITICAL'
      FROM change_controls change
      LEFT JOIN change_control_assessments assessment
        ON assessment.tenant_id = change.tenant_id
        AND assessment.change_control_id = change.id
      WHERE ${allowed.changes}
        AND change.tenant_id = ${tenantId}::uuid
        AND change.created_at >= ${from}
        AND change.created_at < ${toExclusive}
        AND change.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED')
        AND (
          assessment.risk_level = 'CRITICAL'
          OR change.target_completion_at < ${now}
        )

      UNION ALL

      SELECT
        'audits', audit.id::text, audit.code::text, audit.title::text,
        audit.status::text, due.due_at,
        EXISTS (
          SELECT 1 FROM audit_findings finding
          WHERE finding.tenant_id = audit.tenant_id
            AND finding.audit_id = audit.id
            AND finding.status <> 'CLOSED'
            AND finding.classification = 'CRITICAL'
        )
      FROM audits audit
      CROSS JOIN LATERAL (
        SELECT MIN(candidate.due_at) AS due_at
        FROM (
          SELECT audit.scheduled_end_at AS due_at
          UNION ALL
          SELECT finding.response_due_at
          FROM audit_findings finding
          WHERE finding.tenant_id = audit.tenant_id
            AND finding.audit_id = audit.id AND finding.status <> 'CLOSED'
        ) candidate
      ) due
      WHERE ${allowed.audits}
        AND audit.tenant_id = ${tenantId}::uuid
        AND audit.created_at >= ${from}
        AND audit.created_at < ${toExclusive}
        AND audit.status NOT IN ('CLOSED', 'CANCELLED')
        AND (
          due.due_at < ${now}
          OR EXISTS (
            SELECT 1 FROM audit_findings finding
            WHERE finding.tenant_id = audit.tenant_id
              AND finding.audit_id = audit.id
              AND finding.status <> 'CLOSED'
              AND finding.classification = 'CRITICAL'
          )
        )

      UNION ALL

      SELECT
        'risks', risk.id::text, risk.code::text, risk.title::text,
        risk.status::text, due.due_at,
        EXISTS (
          SELECT 1 FROM quality_risk_items item
          WHERE item.tenant_id = risk.tenant_id AND item.risk_id = risk.id
            AND COALESCE(item.residual_rpn, item.initial_rpn) > 80
        )
      FROM quality_risk_assessments risk
      CROSS JOIN LATERAL (
        SELECT MIN(candidate.due_at) AS due_at
        FROM (
          SELECT risk.target_review_at AS due_at
          UNION ALL
          SELECT item.due_at FROM quality_risk_items item
          WHERE item.tenant_id = risk.tenant_id
            AND item.risk_id = risk.id AND item.status = 'OPEN'
        ) candidate
      ) due
      WHERE ${allowed.risks}
        AND risk.tenant_id = ${tenantId}::uuid
        AND risk.created_at >= ${from}
        AND risk.created_at < ${toExclusive}
        AND risk.status NOT IN ('CLOSED', 'CANCELLED')
        AND (
          due.due_at < ${now}
          OR EXISTS (
            SELECT 1 FROM quality_risk_items item
            WHERE item.tenant_id = risk.tenant_id AND item.risk_id = risk.id
              AND COALESCE(item.residual_rpn, item.initial_rpn) > 80
          )
        )

      UNION ALL

      SELECT
        'suppliers', supplier.id::text, supplier.code::text,
        supplier.legal_name::text, supplier.status::text,
        supplier.next_review_at, supplier.criticality = 'CRITICAL'
      FROM suppliers supplier
      WHERE ${allowed.suppliers}
        AND supplier.tenant_id = ${tenantId}::uuid
        AND supplier.created_at >= ${from}
        AND supplier.created_at < ${toExclusive}
        AND (
          supplier.next_review_at < ${now}
          OR (
            supplier.criticality = 'CRITICAL'
            AND supplier.status = 'PENDING_QUALIFICATION'
          )
        )

      UNION ALL

      SELECT
        'equipment', equipment.id::text, equipment.code::text,
        equipment.name::text, equipment.status::text, due.due_at,
        equipment.criticality = 'CRITICAL'
      FROM equipment equipment
      CROSS JOIN LATERAL (
        SELECT MIN(candidate.due_at) AS due_at
        FROM (VALUES
          (CASE WHEN equipment.calibration_required THEN equipment.next_calibration_at END),
          (CASE WHEN equipment.maintenance_required THEN equipment.next_maintenance_at END)
        ) candidate(due_at)
      ) due
      WHERE ${allowed.equipment}
        AND equipment.tenant_id = ${tenantId}::uuid
        AND equipment.created_at >= ${from}
        AND equipment.created_at < ${toExclusive}
        AND equipment.status <> 'RETIRED'
        AND (
          due.due_at < ${now}
          OR (equipment.criticality = 'CRITICAL' AND equipment.status = 'OUT_OF_SERVICE')
        )

      UNION ALL

      SELECT
        'complaints', complaint.id::text, complaint.code::text,
        complaint.title::text, complaint.status::text,
        complaint.target_close_at,
        complaint.severity = 'CRITICAL' OR complaint.potential_safety_event
      FROM product_complaints complaint
      WHERE ${allowed.complaints}
        AND complaint.tenant_id = ${tenantId}::uuid
        AND complaint.created_at >= ${from}
        AND complaint.created_at < ${toExclusive}
        AND complaint.status NOT IN ('CLOSED', 'CANCELLED')
        AND (
          complaint.severity = 'CRITICAL'
          OR complaint.potential_safety_event
          OR complaint.target_close_at < ${now}
        )

      UNION ALL

      SELECT
        'recalls', recall.id::text, recall.code::text, recall.title::text,
        recall.status::text, recall.target_close_at,
        assessment.classification = 'CLASS_I'
      FROM product_recalls recall
      LEFT JOIN recall_risk_assessments assessment
        ON assessment.tenant_id = recall.tenant_id AND assessment.recall_id = recall.id
      WHERE ${allowed.recalls}
        AND recall.tenant_id = ${tenantId}::uuid
        AND recall.created_at >= ${from}
        AND recall.created_at < ${toExclusive}
        AND recall.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED')
        AND (
          assessment.classification = 'CLASS_I'
          OR recall.target_close_at < ${now}
        )

      UNION ALL

      SELECT
        'productReviews', review.id::text, review.code::text,
        review.product_name::text, review.status::text,
        review.target_completion_at,
        review.status = 'FOLLOW_UP_REQUIRED'
      FROM product_quality_reviews review
      WHERE ${allowed.productReviews}
        AND review.tenant_id = ${tenantId}::uuid
        AND review.created_at >= ${from}
        AND review.created_at < ${toExclusive}
        AND review.status NOT IN ('APPROVED', 'CANCELLED')
        AND (
          review.status = 'FOLLOW_UP_REQUIRED'
          OR review.target_completion_at < ${now}
        )
    )
    SELECT module, id, code, title, status, "dueAt", "isCritical"
    FROM priority_records
    ORDER BY "isCritical" DESC, "dueAt" ASC NULLS LAST, code ASC
    LIMIT 20
  `;
}

function buildResponse(
  rows: AggregateRow[],
  previousRows: AggregateRow[],
  priorityRows: PriorityRow[],
  allowed: Record<ReportModuleId, boolean>,
  period: ResolvedPeriod,
  previousPeriod: ResolvedPeriod,
  generatedAt: Date,
): OperationalReportResponseDto {
  const modules = summarizeModules(rows, allowed);
  const previousModules = summarizeModules(previousRows, allowed);
  const kpis = calculateKpis(modules);
  const previousKpis = calculateKpis(previousModules);
  const trend = trendPoints(rows, modules, period.from, period.toExclusive);

  return {
    generatedAt: generatedAt.toISOString(),
    period: publicPeriod(period),
    kpis,
    comparison: {
      period: publicPeriod(previousPeriod),
      totalRecords: countComparison(
        kpis.totalRecords,
        previousKpis.totalRecords,
      ),
      openRecords: countComparison(kpis.openRecords, previousKpis.openRecords),
      overdueRecords: countComparison(
        kpis.overdueRecords,
        previousKpis.overdueRecords,
      ),
      criticalRecords: countComparison(
        kpis.criticalRecords,
        previousKpis.criticalRecords,
      ),
      trainingCompliancePercent: rateComparison(
        kpis.trainingCompliancePercent,
        previousKpis.trainingCompliancePercent,
      ),
      capaEffectivenessPercent: rateComparison(
        kpis.capaEffectivenessPercent,
        previousKpis.capaEffectivenessPercent,
      ),
    },
    modules,
    trend,
    priorities: priorityRows.map((item): ReportPriorityItemDto => {
      const daysOverdue = item.dueAt
        ? Math.max(
            0,
            Math.floor(
              (generatedAt.getTime() - item.dueAt.getTime()) / dayMilliseconds,
            ),
          )
        : null;
      return {
        module: item.module,
        id: item.id,
        code: item.code,
        title: item.title,
        status: item.status,
        dueAt: item.dueAt?.toISOString() ?? null,
        daysOverdue,
        level: item.isCritical ? 'CRITICAL' : 'OVERDUE',
      };
    }),
  };
}

function summarizeModules(
  rows: AggregateRow[],
  allowed: Record<ReportModuleId, boolean>,
): ReportModuleSummaryDto[] {
  return modulePermissions
    .filter(([module]) => allowed[module])
    .map(([module]): ReportModuleSummaryDto => {
      const statusRows = rows.filter(
        (row) => row.kind === 'SUMMARY' && row.module === module,
      );
      return {
        id: module,
        total: sum(statusRows, 'total'),
        open: sum(statusRows, 'open'),
        overdue: sum(statusRows, 'overdue'),
        critical: sum(statusRows, 'critical'),
        byStatus: statusRows
          .filter((row): row is AggregateRow & { status: string } =>
            Boolean(row.status),
          )
          .map((row) => ({ status: row.status, count: row.total }))
          .sort((left, right) => right.count - left.count),
      };
    });
}

function calculateKpis(
  modules: ReportModuleSummaryDto[],
): OperationalReportKpisDto {
  const training = modules.find(({ id }) => id === 'training');
  const capa = modules.find(({ id }) => id === 'capas');
  const trainingCompleted = statusCount(training, 'COMPLETED');
  const trainingApplicable =
    trainingCompleted + statusCount(training, 'ASSIGNED');
  const effectiveCapas = statusCount(capa, 'CLOSED_EFFECTIVE');
  const decidedCapas = effectiveCapas + statusCount(capa, 'INEFFECTIVE');

  return {
    totalRecords: sum(modules, 'total'),
    openRecords: sum(modules, 'open'),
    overdueRecords: sum(modules, 'overdue'),
    criticalRecords: sum(modules, 'critical'),
    trainingCompliancePercent: percentage(
      trainingCompleted,
      trainingApplicable,
    ),
    capaEffectivenessPercent: percentage(effectiveCapas, decidedCapas),
  };
}

function trendPoints(
  rows: AggregateRow[],
  modules: ReportModuleSummaryDto[],
  from: Date,
  toExclusive: Date,
): ReportTrendPointDto[] {
  const counts = new Map(
    rows
      .filter(
        (row): row is AggregateRow & { month: string } =>
          row.kind === 'TREND' && Boolean(row.month),
      )
      .map((row) => [`${row.month}:${row.module}`, row.total]),
  );
  const points: ReportTrendPointDto[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
  );
  while (cursor.getTime() < toExclusive.getTime()) {
    const month = isoDate(cursor).slice(0, 7);
    const values = modules.map(({ id }) => ({
      id,
      count: counts.get(`${month}:${id}`) ?? 0,
    }));
    points.push({
      month,
      total: values.reduce((total, item) => total + item.count, 0),
      modules: values,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return points;
}

interface ResolvedPeriod {
  from: Date;
  toExclusive: Date;
}

function precedingPeriod(period: ResolvedPeriod): ResolvedPeriod {
  const duration = period.toExclusive.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - duration),
    toExclusive: new Date(period.from),
  };
}

function publicPeriod(period: ResolvedPeriod): { from: string; to: string } {
  return {
    from: isoDate(period.from),
    to: isoDate(new Date(period.toExclusive.getTime() - dayMilliseconds)),
  };
}

function countComparison(current: number, previous: number) {
  return {
    previous,
    change:
      previous === 0
        ? current === 0
          ? 0
          : null
        : Math.round(((current - previous) / previous) * 1000) / 10,
    changeType: 'PERCENT' as const,
  };
}

function rateComparison(current: number | null, previous: number | null) {
  return {
    previous,
    change:
      current === null || previous === null
        ? null
        : Math.round((current - previous) * 10) / 10,
    changeType: 'POINTS' as const,
  };
}

function resolvePeriod(
  query: OperationalReportQueryDto,
  now: Date,
): ResolvedPeriod {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const defaultFrom = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1),
  );
  const from = query.from ? parseDate(query.from) : defaultFrom;
  const inclusiveTo = query.to ? parseDate(query.to) : today;
  const toExclusive = new Date(inclusiveTo.getTime() + dayMilliseconds);
  const maximumRange = 5 * 366 * dayMilliseconds;
  if (
    from.getTime() >= toExclusive.getTime() ||
    toExclusive.getTime() - from.getTime() > maximumRange
  ) {
    throw new BadRequestException(
      'The report period must be chronological and cannot exceed five years.',
    );
  }
  return { from, toExclusive };
}

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || isoDate(parsed) !== value) {
    throw new BadRequestException(
      'The report period contains an invalid date.',
    );
  }
  return parsed;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function statusCount(
  module: ReportModuleSummaryDto | undefined,
  status: string,
): number {
  return (
    module?.byStatus.find((bucket) => bucket.status === status)?.count ?? 0
  );
}

function percentage(value: number, total: number): number | null {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : null;
}

function sum<T extends Record<K, number>, K extends keyof T>(
  rows: readonly T[],
  key: K,
): number {
  return rows.reduce((total, row) => total + row[key], 0);
}
