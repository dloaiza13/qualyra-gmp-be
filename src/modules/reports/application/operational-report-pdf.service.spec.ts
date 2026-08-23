import { OperationalReportPdfService } from './operational-report-pdf.service.js';

describe('OperationalReportPdfService', () => {
  it('renders a formal multi-section PDF document', async () => {
    const service = new OperationalReportPdfService();
    const bytes = await service.render({
      locale: 'es',
      reportId: '11111111-1111-4111-8111-111111111111',
      dataSha256: 'a'.repeat(64),
      tenant: { name: 'Qualyra QA', slug: 'qualyra-demo' },
      user: { displayName: 'Administrador QA', email: 'admin@qualyra.local' },
      report: {
        generatedAt: '2026-08-22T16:00:00.000Z',
        period: { from: '2026-01-01', to: '2026-08-22' },
        comparison: {
          period: { from: '2025-05-12', to: '2025-12-31' },
          totalRecords: { previous: 8, change: 50, changeType: 'PERCENT' },
          openRecords: { previous: 3, change: 0, changeType: 'PERCENT' },
          overdueRecords: { previous: 2, change: -50, changeType: 'PERCENT' },
          criticalRecords: { previous: 0, change: null, changeType: 'PERCENT' },
          trainingCompliancePercent: {
            previous: 80,
            change: 10,
            changeType: 'POINTS',
          },
          capaEffectivenessPercent: {
            previous: null,
            change: null,
            changeType: 'POINTS',
          },
        },
        kpis: {
          totalRecords: 12,
          openRecords: 3,
          overdueRecords: 1,
          criticalRecords: 1,
          trainingCompliancePercent: 90,
          capaEffectivenessPercent: null,
        },
        modules: [
          {
            id: 'deviations',
            total: 12,
            open: 3,
            overdue: 1,
            critical: 1,
            byStatus: [
              { status: 'REPORTED', count: 2 },
              { status: 'CLOSED', count: 10 },
            ],
          },
        ],
        trend: [
          {
            month: '2026-08',
            total: 12,
            modules: [{ id: 'deviations', count: 12 }],
          },
        ],
        priorities: [
          {
            module: 'deviations',
            id: '22222222-2222-4222-8222-222222222222',
            code: 'DEV-2026-001',
            title: 'Desviacion critica de temperatura',
            status: 'INVESTIGATION',
            dueAt: '2026-08-10T00:00:00.000Z',
            daysOverdue: 12,
            level: 'CRITICAL',
          },
        ],
      },
    });

    expect(bytes.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(5_000);
  });
});
