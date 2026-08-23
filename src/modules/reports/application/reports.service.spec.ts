import { jest } from '@jest/globals';
import type { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { ReportsService } from './reports.service.js';

describe('ReportsService', () => {
  const principal = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    tokenVersion: 0,
  };

  it('returns zero-filled authorized modules and derives management KPIs', async () => {
    const transaction = {
      $queryRaw: jest.fn(() =>
        Promise.resolve([
          {
            kind: 'SUMMARY',
            module: 'documents',
            status: 'EFFECTIVE',
            month: null,
            total: 4,
            open: 0,
            overdue: 0,
            critical: 0,
          },
          {
            kind: 'SUMMARY',
            module: 'documents',
            status: 'DRAFT',
            month: null,
            total: 1,
            open: 1,
            overdue: 0,
            critical: 0,
          },
          {
            kind: 'SUMMARY',
            module: 'training',
            status: 'COMPLETED',
            month: null,
            total: 8,
            open: 0,
            overdue: 0,
            critical: 0,
          },
          {
            kind: 'SUMMARY',
            module: 'training',
            status: 'ASSIGNED',
            month: null,
            total: 2,
            open: 2,
            overdue: 1,
            critical: 0,
          },
          {
            kind: 'TREND',
            module: 'documents',
            status: null,
            month: '2026-08',
            total: 5,
            open: 0,
            overdue: 0,
            critical: 0,
          },
        ]),
      ),
    };
    const tenantUnitOfWork = {
      execute: jest.fn(
        (_tenantId: string, work: (value: unknown) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const service = new ReportsService(
      tenantUnitOfWork as unknown as TenantUnitOfWork,
    );

    const report = await service.operational(
      principal,
      new Set([
        'reports.read',
        'documents.read_all',
        'training.assign',
        'capas.read_all',
      ]),
      { from: '2026-08-01', to: '2026-08-31' },
    );

    expect(report.period).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(report.kpis).toMatchObject({
      totalRecords: 15,
      openRecords: 3,
      overdueRecords: 1,
      criticalRecords: 0,
      trainingCompliancePercent: 80,
      capaEffectivenessPercent: null,
    });
    expect(report.modules.map(({ id }) => id)).toEqual([
      'documents',
      'training',
      'capas',
    ]);
    expect(report.modules.at(-1)).toMatchObject({ total: 0, byStatus: [] });
    expect(report.trend).toEqual([
      {
        month: '2026-08',
        total: 5,
        modules: [
          { id: 'documents', count: 5 },
          { id: 'training', count: 0 },
          { id: 'capas', count: 0 },
        ],
      },
    ]);
    expect(tenantUnitOfWork.execute).toHaveBeenCalledWith(
      principal.tenantId,
      expect.any(Function),
    );
  });

  it('rejects inverted or excessive periods before querying the tenant', () => {
    const tenantUnitOfWork = { execute: jest.fn() };
    const service = new ReportsService(
      tenantUnitOfWork as unknown as TenantUnitOfWork,
    );

    expect(() =>
      service.operational(principal, new Set(['reports.read']), {
        from: '2026-09-01',
        to: '2026-08-01',
      }),
    ).toThrow('cannot exceed five years');
    expect(tenantUnitOfWork.execute).not.toHaveBeenCalled();
  });
});
