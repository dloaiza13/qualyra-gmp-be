import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type { OperationalReportQueryDto } from './dto/report-request.dto.js';
import {
  type OperationalReportResponseDto,
  type ReportModuleId,
  type ReportModuleSummaryDto,
  type ReportTrendPointDto,
} from './dto/report-response.dto.js';

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
  constructor(private readonly tenantUnitOfWork: TenantUnitOfWork) {}

  operational(
    principal: AuthenticatedPrincipal,
    permissions: ReadonlySet<string>,
    query: OperationalReportQueryDto,
  ): Promise<OperationalReportResponseDto> {
    const generatedAt = new Date();
    const period = resolvePeriod(query, generatedAt);
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
        return buildResponse(rows, allowed, period, generatedAt);
      },
    );
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

function buildResponse(
  rows: AggregateRow[],
  allowed: Record<ReportModuleId, boolean>,
  period: ResolvedPeriod,
  generatedAt: Date,
): OperationalReportResponseDto {
  const modules = modulePermissions
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
  const trend = trendPoints(rows, modules, period.from, period.toExclusive);
  const training = modules.find(({ id }) => id === 'training');
  const capa = modules.find(({ id }) => id === 'capas');
  const trainingCompleted = statusCount(training, 'COMPLETED');
  const trainingApplicable =
    trainingCompleted + statusCount(training, 'ASSIGNED');
  const effectiveCapas = statusCount(capa, 'CLOSED_EFFECTIVE');
  const decidedCapas = effectiveCapas + statusCount(capa, 'INEFFECTIVE');

  return {
    generatedAt: generatedAt.toISOString(),
    period: {
      from: isoDate(period.from),
      to: isoDate(new Date(period.toExclusive.getTime() - dayMilliseconds)),
    },
    kpis: {
      totalRecords: sum(modules, 'total'),
      openRecords: sum(modules, 'open'),
      overdueRecords: sum(modules, 'overdue'),
      criticalRecords: sum(modules, 'critical'),
      trainingCompliancePercent: percentage(
        trainingCompleted,
        trainingApplicable,
      ),
      capaEffectivenessPercent: percentage(effectiveCapas, decidedCapas),
    },
    modules,
    trend,
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
