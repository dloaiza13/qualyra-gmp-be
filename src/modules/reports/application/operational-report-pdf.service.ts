import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type {
  OperationalReportResponseDto,
  ReportMetricComparisonDto,
  ReportModuleId,
} from './dto/report-response.dto.js';

interface PdfInput {
  report: OperationalReportResponseDto;
  reportId: string;
  dataSha256: string;
  locale: 'es' | 'en';
  tenant: { name: string; slug: string };
  user: { displayName: string; email: string };
}

const colors = {
  ink: '#071A2C',
  muted: '#59708F',
  border: '#D7E1EC',
  surface: '#F4F8FB',
  cyan: '#19C9D8',
  teal: '#00A889',
  amber: '#C87900',
  red: '#C9344C',
  white: '#FFFFFF',
};

const moduleNames: Record<'es' | 'en', Record<ReportModuleId, string>> = {
  es: {
    documents: 'Documentos',
    training: 'Capacitaciones',
    deviations: 'Desviaciones',
    capas: 'CAPA',
    changes: 'Control de cambios',
    audits: 'Auditorías',
    risks: 'Riesgos de calidad',
    suppliers: 'Proveedores',
    equipment: 'Equipos',
    complaints: 'Reclamaciones',
    recalls: 'Retiros y acciones de campo',
    productReviews: 'PQR / APR',
  },
  en: {
    documents: 'Documents',
    training: 'Training',
    deviations: 'Deviations',
    capas: 'CAPA',
    changes: 'Change control',
    audits: 'Audits',
    risks: 'Quality risks',
    suppliers: 'Suppliers',
    equipment: 'Equipment',
    complaints: 'Complaints',
    recalls: 'Recalls and field actions',
    productReviews: 'PQR / APR',
  },
};

const spanishStatusNames: Record<string, string> = {
  ACTIVE: 'Activo',
  APPROVED: 'Aprobado',
  ASSIGNED: 'Asignado',
  ASSESSED: 'Evaluado',
  CANCELLED: 'Cancelado',
  CLOSED: 'Cerrado',
  CLOSED_EFFECTIVE: 'Cerrado y efectivo',
  COMPLETED: 'Completado',
  CONDITIONALLY_APPROVED: 'Aprobado con condiciones',
  DISQUALIFIED: 'Descalificado',
  DRAFT: 'Borrador',
  EFFECTIVE: 'Vigente',
  EFFECTIVENESS_REVIEW: 'Revisión de efectividad',
  FOLLOW_UP: 'Seguimiento',
  FOLLOW_UP_REQUIRED: 'Requiere seguimiento',
  IMPLEMENTATION_COMPLETED: 'Implementación completada',
  IMPLEMENTING: 'En implementación',
  INEFFECTIVE: 'Inefectivo',
  IN_PROGRESS: 'En progreso',
  IN_REVIEW: 'En revisión',
  OUT_OF_SERVICE: 'Fuera de servicio',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  PENDING_QUALIFICATION: 'Pendiente de calificación',
  PENDING_REVIEW: 'Pendiente de revisión',
  PLANNED: 'Planificado',
  PROPOSED: 'Propuesto',
  READY_FOR_CLOSURE: 'Listo para cierre',
  REJECTED: 'Rechazado',
  REPORTED: 'Reportado',
  RESIDUAL_RISK_NOT_ACCEPTED: 'Riesgo residual no aceptado',
  RETIRED: 'Retirado',
  UNDER_INVESTIGATION: 'En investigación',
  VERIFICATION_FAILED: 'Verificación fallida',
};

@Injectable()
export class OperationalReportPdfService {
  render(input: PdfInput): Promise<Buffer> {
    const document = new PDFDocument({
      size: 'A4',
      margins: { top: 52, right: 42, bottom: 54, left: 42 },
      bufferPages: true,
      info: {
        Title:
          input.locale === 'es'
            ? 'Reporte operacional de calidad'
            : 'Operational quality report',
        Author: input.tenant.name,
        Subject: `Qualyra GMP - ${input.report.period.from} / ${input.report.period.to}`,
        Keywords: 'GMP, quality, operational report, Qualyra',
      },
    });
    const chunks: Buffer[] = [];
    const completed = new Promise<Buffer>((resolve, reject) => {
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });

    drawReport(document, input);
    addFooters(document, input);
    document.end();
    return completed;
  }
}

function drawReport(document: PDFKit.PDFDocument, input: PdfInput): void {
  const { report, locale } = input;
  drawCoverHeader(document, input);
  sectionTitle(
    document,
    locale === 'es' ? 'Resumen ejecutivo' : 'Executive summary',
  );
  drawInsights(document, input);
  drawKpis(document, input);

  sectionTitle(
    document,
    locale === 'es' ? 'Tendencia de registros' : 'Record creation trend',
  );
  drawTrend(document, input);

  sectionTitle(
    document,
    locale === 'es'
      ? 'Prioridades que requieren acción'
      : 'Priorities requiring action',
  );
  drawPriorities(document, input);

  ensureSpace(document, 92);
  sectionTitle(
    document,
    locale === 'es' ? 'Detalle por proceso' : 'Process detail',
  );
  drawModuleTable(document, input);

  ensureSpace(document, 92);
  sectionTitle(
    document,
    locale === 'es' ? 'Distribución por estado' : 'Status distribution',
  );
  drawStatusDetails(document, input);

  ensureSpace(document, 105);
  document
    .roundedRect(42, document.y, 511, 92, 7)
    .fillAndStroke(colors.surface, colors.border);
  const metadataY = document.y + 13;
  document
    .fillColor(colors.ink)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(locale === 'es' ? 'TRAZABILIDAD' : 'TRACEABILITY', 56, metadataY);
  document
    .fillColor(colors.muted)
    .font('Helvetica')
    .fontSize(7)
    .text(`Report ID: ${input.reportId}`, 56, metadataY + 17)
    .text(`Data SHA-256: ${input.dataSha256}`, 56, metadataY + 31, {
      width: 480,
    })
    .text(
      locale === 'es'
        ? `Generado por ${input.user.displayName} (${input.user.email}) el ${formatDateTime(report.generatedAt, locale)}.`
        : `Generated by ${input.user.displayName} (${input.user.email}) on ${formatDateTime(report.generatedAt, locale)}.`,
      56,
      metadataY + 55,
      { width: 480 },
    );
}

function drawCoverHeader(document: PDFKit.PDFDocument, input: PdfInput): void {
  const { locale, report, tenant } = input;
  document.rect(0, 0, document.page.width, 164).fill(colors.ink);
  document.roundedRect(42, 28, 34, 34, 9).fill(colors.cyan);
  document
    .fillColor(colors.ink)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Q', 52, 37, { width: 14, align: 'center' });
  document
    .fillColor(colors.white)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('Qualyra', 86, 31)
    .fillColor(colors.cyan)
    .fontSize(7)
    .text('GMP', 86, 49, { characterSpacing: 2 });
  document
    .fillColor(colors.cyan)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text(
      locale === 'es' ? 'INTELIGENCIA DE CALIDAD' : 'QUALITY INTELLIGENCE',
      42,
      82,
      { characterSpacing: 1.5 },
    );
  document
    .fillColor(colors.white)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text(
      locale === 'es'
        ? 'Reporte operacional de calidad'
        : 'Operational quality report',
      42,
      97,
      { width: 350 },
    );
  document
    .fillColor('#B6C6D8')
    .font('Helvetica')
    .fontSize(8)
    .text(tenant.name, 395, 84, { width: 158, align: 'right' })
    .text(
      `${formatDate(report.period.from, locale)} - ${formatDate(report.period.to, locale)}`,
      395,
      101,
      { width: 158, align: 'right' },
    )
    .text(locale === 'es' ? 'Comparado con' : 'Compared with', 395, 121, {
      width: 158,
      align: 'right',
    })
    .text(
      `${formatDate(report.comparison.period.from, locale)} - ${formatDate(report.comparison.period.to, locale)}`,
      395,
      135,
      { width: 158, align: 'right' },
    );
  document.y = 185;
}

function drawInsights(document: PDFKit.PDFDocument, input: PdfInput): void {
  const insights = executiveInsights(input);
  ensureSpace(document, 22 + insights.length * 20);
  const top = document.y;
  const height = 20 + insights.length * 20;
  document.roundedRect(42, top, 511, height, 7).fill(colors.surface);
  insights.forEach((insight, index) => {
    const y = top + 12 + index * 20;
    document.circle(56, y + 4, 3).fill(insight.color);
    document
      .fillColor(colors.ink)
      .font('Helvetica')
      .fontSize(8.5)
      .text(insight.text, 68, y, { width: 466 });
  });
  document.y = top + height + 14;
}

function executiveInsights(input: PdfInput): { text: string; color: string }[] {
  const { report, locale } = input;
  const insights: { text: string; color: string }[] = [];
  const largestOverdue = [...report.modules].sort(
    (left, right) => right.overdue - left.overdue,
  )[0];
  if (report.kpis.criticalRecords > 0) {
    insights.push({
      color: colors.red,
      text:
        locale === 'es'
          ? `${report.kpis.criticalRecords} registro(s) crítico(s) requieren evaluación prioritaria.`
          : `${report.kpis.criticalRecords} critical record(s) require priority assessment.`,
    });
  }
  if (report.kpis.overdueRecords > 0 && largestOverdue) {
    insights.push({
      color: colors.amber,
      text:
        locale === 'es'
          ? `${report.kpis.overdueRecords} registro(s) vencido(s); la mayor concentración está en ${moduleNames.es[largestOverdue.id]} (${largestOverdue.overdue}).`
          : `${report.kpis.overdueRecords} overdue record(s); the highest concentration is in ${moduleNames.en[largestOverdue.id]} (${largestOverdue.overdue}).`,
    });
  }
  if (
    report.kpis.trainingCompliancePercent !== null &&
    report.kpis.trainingCompliancePercent < 90
  ) {
    insights.push({
      color: colors.amber,
      text:
        locale === 'es'
          ? `Cumplimiento de capacitación en ${formatPercent(report.kpis.trainingCompliancePercent)}; se recomienda priorizar asignaciones pendientes.`
          : `Training compliance is ${formatPercent(report.kpis.trainingCompliancePercent)}; pending assignments should be prioritized.`,
    });
  }
  if (
    report.kpis.capaEffectivenessPercent !== null &&
    report.kpis.capaEffectivenessPercent < 85
  ) {
    insights.push({
      color: colors.amber,
      text:
        locale === 'es'
          ? `Efectividad CAPA en ${formatPercent(report.kpis.capaEffectivenessPercent)}; revise causas de ciclos inefectivos.`
          : `CAPA effectiveness is ${formatPercent(report.kpis.capaEffectivenessPercent)}; review causes of ineffective cycles.`,
    });
  }
  if (insights.length === 0) {
    insights.push({
      color: colors.teal,
      text:
        locale === 'es'
          ? 'No se identificaron alertas con los datos disponibles para el período.'
          : 'No alerts were identified from the data available for the period.',
    });
  }
  return insights;
}

function drawKpis(document: PDFKit.PDFDocument, input: PdfInput): void {
  const { report, locale } = input;
  const entries = [
    [
      'Registros',
      'Records',
      report.kpis.totalRecords,
      report.comparison.totalRecords,
    ],
    [
      'Abiertos',
      'Open',
      report.kpis.openRecords,
      report.comparison.openRecords,
    ],
    [
      'Vencidos',
      'Overdue',
      report.kpis.overdueRecords,
      report.comparison.overdueRecords,
    ],
    [
      'Críticos',
      'Critical',
      report.kpis.criticalRecords,
      report.comparison.criticalRecords,
    ],
    [
      'Cumplimiento de capacitación',
      'Training compliance',
      report.kpis.trainingCompliancePercent,
      report.comparison.trainingCompliancePercent,
    ],
    [
      'Efectividad CAPA',
      'CAPA effectiveness',
      report.kpis.capaEffectivenessPercent,
      report.comparison.capaEffectivenessPercent,
    ],
  ] as const;
  ensureSpace(document, 146);
  const top = document.y;
  entries.forEach(([spanish, english, value, comparison], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 42 + column * 173;
    const y = top + row * 67;
    document
      .roundedRect(x, y, 165, 59, 6)
      .fillAndStroke('#FFFFFF', colors.border);
    document
      .fillColor(colors.muted)
      .font('Helvetica')
      .fontSize(7.5)
      .text(locale === 'es' ? spanish : english, x + 11, y + 9, { width: 143 });
    document
      .fillColor(colors.ink)
      .font('Helvetica-Bold')
      .fontSize(17)
      .text(
        value === null
          ? locale === 'es'
            ? 'Sin datos'
            : 'No data'
          : typeof value === 'number' && index > 3
            ? formatPercent(value)
            : String(value),
        x + 11,
        y + 23,
        { width: 78 },
      );
    document
      .fillColor(comparisonColor(comparison, index))
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(comparisonLabel(comparison, locale), x + 91, y + 31, {
        width: 63,
        align: 'right',
      });
  });
  document.y = top + 146;
}

function drawTrend(document: PDFKit.PDFDocument, input: PdfInput): void {
  const points = input.report.trend.slice(-12);
  ensureSpace(document, 150);
  const top = document.y;
  const x = 48;
  const width = 499;
  const height = 112;
  const max = Math.max(1, ...points.map(({ total }) => total));
  document
    .moveTo(x, top + height)
    .lineTo(x + width, top + height)
    .strokeColor(colors.border)
    .stroke();
  if (points.length === 0) {
    emptyMessage(document, input.locale, top + 38);
  } else {
    const slot = width / points.length;
    points.forEach((point, index) => {
      const barHeight = (point.total / max) * 82;
      const barWidth = Math.min(25, slot * 0.55);
      const barX = x + index * slot + (slot - barWidth) / 2;
      document
        .roundedRect(barX, top + height - barHeight, barWidth, barHeight, 2)
        .fill(colors.cyan);
      document
        .fillColor(colors.ink)
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(String(point.total), barX - 4, top + height - barHeight - 11, {
          width: barWidth + 8,
          align: 'center',
        });
      document
        .fillColor(colors.muted)
        .font('Helvetica')
        .fontSize(6.5)
        .text(point.month.slice(5), barX - 6, top + height + 6, {
          width: barWidth + 12,
          align: 'center',
        });
    });
  }
  document.y = top + 143;
}

function drawPriorities(document: PDFKit.PDFDocument, input: PdfInput): void {
  if (input.report.priorities.length === 0) {
    ensureSpace(document, 56);
    emptyMessage(document, input.locale, document.y + 12);
    document.y += 52;
    return;
  }
  drawPriorityHeader(document, input.locale);
  input.report.priorities.forEach((item) => {
    ensureSpace(document, 38);
    const y = document.y;
    if (y < 80) drawPriorityHeader(document, input.locale);
    const rowY = document.y;
    document
      .fillColor(colors.ink)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(item.code, 48, rowY + 7, { width: 72 })
      .font('Helvetica')
      .text(moduleNames[input.locale][item.module], 124, rowY + 7, {
        width: 88,
      })
      .text(item.title, 216, rowY + 7, { width: 190, height: 24 })
      .fillColor(item.level === 'CRITICAL' ? colors.red : colors.amber)
      .font('Helvetica-Bold')
      .text(
        item.level === 'CRITICAL'
          ? input.locale === 'es'
            ? 'CRITICO'
            : 'CRITICAL'
          : input.locale === 'es'
            ? `${item.daysOverdue ?? 0} d vencido`
            : `${item.daysOverdue ?? 0} d overdue`,
        414,
        rowY + 7,
        { width: 83 },
      )
      .fillColor(colors.muted)
      .font('Helvetica')
      .text(
        item.dueAt ? formatDate(item.dueAt, input.locale) : '-',
        500,
        rowY + 7,
        {
          width: 48,
          align: 'right',
        },
      );
    document
      .moveTo(42, rowY + 34)
      .lineTo(553, rowY + 34)
      .strokeColor(colors.border)
      .stroke();
    document.y = rowY + 35;
  });
  document.y += 12;
}

function drawPriorityHeader(
  document: PDFKit.PDFDocument,
  locale: 'es' | 'en',
): void {
  ensureSpace(document, 26);
  const labels =
    locale === 'es'
      ? ['Codigo', 'Proceso', 'Registro', 'Prioridad', 'Fecha']
      : ['Code', 'Process', 'Record', 'Priority', 'Date'];
  const top = document.y;
  document.rect(42, top, 511, 23).fill(colors.ink);
  const columns = [48, 124, 216, 414, 500];
  const widths = [72, 88, 190, 83, 48];
  labels.forEach((label, index) => {
    document
      .fillColor(colors.white)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(label, columns[index], top + 8, {
        width: widths[index],
        align: index === 4 ? 'right' : 'left',
      });
  });
  document.y = top + 23;
}

function drawModuleTable(document: PDFKit.PDFDocument, input: PdfInput): void {
  ensureSpace(document, 25);
  const locale = input.locale;
  const labels =
    locale === 'es'
      ? ['Proceso', 'Total', 'Abiertos', 'Vencidos', 'Críticos']
      : ['Process', 'Total', 'Open', 'Overdue', 'Critical'];
  const top = document.y;
  document.rect(42, top, 511, 23).fill(colors.ink);
  const columns = [48, 326, 380, 438, 497];
  const widths = [270, 50, 54, 55, 51];
  labels.forEach((label, index) => {
    document
      .fillColor(colors.white)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(label, columns[index], top + 8, {
        width: widths[index],
        align: index === 0 ? 'left' : 'right',
      });
  });
  document.y = top + 23;
  input.report.modules.forEach((module, index) => {
    ensureSpace(document, 26);
    const y = document.y;
    if (index % 2 === 0) document.rect(42, y, 511, 25).fill(colors.surface);
    const values = [
      moduleNames[locale][module.id],
      module.total,
      module.open,
      module.overdue,
      module.critical,
    ];
    values.forEach((value, valueIndex) => {
      document
        .fillColor(
          valueIndex === 3 && module.overdue > 0
            ? colors.amber
            : valueIndex === 4 && module.critical > 0
              ? colors.red
              : colors.ink,
        )
        .font(valueIndex === 0 ? 'Helvetica' : 'Helvetica-Bold')
        .fontSize(8)
        .text(String(value), columns[valueIndex], y + 8, {
          width: widths[valueIndex],
          align: valueIndex === 0 ? 'left' : 'right',
        });
    });
    document.y = y + 25;
  });
  document.y += 12;
}

function drawStatusDetails(
  document: PDFKit.PDFDocument,
  input: PdfInput,
): void {
  const modules = input.report.modules.filter(
    (module) => module.byStatus.length > 0,
  );
  if (modules.length === 0) {
    ensureSpace(document, 56);
    emptyMessage(document, input.locale, document.y + 12);
    document.y += 52;
    return;
  }
  modules.forEach((module) => {
    const lines = module.byStatus.length;
    const height = 34 + lines * 14;
    ensureSpace(document, height + 8);
    const top = document.y;
    document.roundedRect(42, top, 511, height, 6).stroke(colors.border);
    document
      .fillColor(colors.ink)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(moduleNames[input.locale][module.id], 54, top + 11, { width: 220 });
    module.byStatus.forEach((bucket, index) => {
      const y = top + 29 + index * 14;
      document
        .fillColor(colors.muted)
        .font('Helvetica')
        .fontSize(7.5)
        .text(statusName(bucket.status, input.locale), 54, y, { width: 400 })
        .fillColor(colors.ink)
        .font('Helvetica-Bold')
        .text(String(bucket.count), 500, y, { width: 38, align: 'right' });
    });
    document.y = top + height + 8;
  });
}

function sectionTitle(document: PDFKit.PDFDocument, title: string): void {
  ensureSpace(document, 40);
  const top = document.y;
  document
    .fillColor(colors.cyan)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text('QUALYRA GMP', 42, top, { characterSpacing: 1.4 });
  document
    .fillColor(colors.ink)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(title, 42, top + 13);
  document.y = top + 38;
}

function ensureSpace(document: PDFKit.PDFDocument, height: number): void {
  if (document.y + height > document.page.height - 82) {
    document.addPage();
    document.y = 56;
  }
}

function emptyMessage(
  document: PDFKit.PDFDocument,
  locale: 'es' | 'en',
  y: number,
): void {
  document
    .fillColor(colors.muted)
    .font('Helvetica')
    .fontSize(8.5)
    .text(
      locale === 'es'
        ? 'No hay datos disponibles para esta sección y período.'
        : 'No data is available for this section and period.',
      42,
      y,
      { width: 511, align: 'center' },
    );
}

function addFooters(document: PDFKit.PDFDocument, input: PdfInput): void {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    document
      .moveTo(42, document.page.height - 70)
      .lineTo(553, document.page.height - 70)
      .strokeColor(colors.border)
      .stroke();
    document
      .fillColor(colors.muted)
      .font('Helvetica')
      .fontSize(6.5)
      .text(
        `${input.tenant.name} | ${input.report.period.from} - ${input.report.period.to}`,
        42,
        document.page.height - 62,
        { width: 390, lineBreak: false },
      )
      .text(
        `${input.locale === 'es' ? 'Pagina' : 'Page'} ${index + 1} / ${range.count}`,
        443,
        document.page.height - 62,
        { width: 110, align: 'right', lineBreak: false },
      );
  }
}

function comparisonLabel(
  comparison: ReportMetricComparisonDto,
  locale: 'es' | 'en',
): string {
  if (comparison.change === null)
    return locale === 'es' ? 'Sin base' : 'No baseline';
  const prefix = comparison.change > 0 ? '+' : '';
  return comparison.changeType === 'POINTS'
    ? `${prefix}${comparison.change} pp`
    : `${prefix}${comparison.change}%`;
}

function comparisonColor(
  comparison: ReportMetricComparisonDto,
  index: number,
): string {
  if (comparison.change === null || comparison.change === 0 || index === 0) {
    return colors.muted;
  }
  const improvement = index > 3 ? comparison.change > 0 : comparison.change < 0;
  return improvement ? colors.teal : colors.red;
}

function formatDate(value: string, locale: 'es' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-GT' : 'en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatDateTime(value: string, locale: 'es' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-GT' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatPercent(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function humanizeStatus(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function statusName(status: string, locale: 'es' | 'en'): string {
  return locale === 'es'
    ? (spanishStatusNames[status] ?? humanizeStatus(status))
    : humanizeStatus(status);
}
