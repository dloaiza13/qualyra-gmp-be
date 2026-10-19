import type { Prisma } from '../../../generated/prisma/client.js';
import { CapaActionOverdueRuleEvaluator } from './capa-action-overdue-rule.evaluator.js';
import { EquipmentCalibrationOverdueRuleEvaluator } from './equipment-calibration-overdue-rule.evaluator.js';

const evaluatedAt = new Date('2026-10-19T12:00:00.000Z');

describe('deterministic compliance rule evaluators', () => {
  it('reports only open CAPA actions older than the configured threshold', async () => {
    let findManyArguments: unknown;
    const transaction = {
      capaAction: {
        count: () => Promise.resolve(3),
        findMany: (arguments_: unknown) => {
          findManyArguments = arguments_;
          return Promise.resolve([
            {
              id: '00000000-0000-4000-8000-000000000101',
              title: 'Verify corrective action',
              dueAt: new Date('2026-10-14T12:00:00.000Z'),
              assignedToUserId: '00000000-0000-4000-8000-000000000102',
              capa: {
                id: '00000000-0000-4000-8000-000000000103',
                code: 'CAPA-2026-001',
                title: 'Seal integrity investigation',
              },
            },
          ]);
        },
      },
    } as unknown as Prisma.TransactionClient;
    const evaluator = new CapaActionOverdueRuleEvaluator();

    const result = await evaluator.evaluate({
      transaction,
      tenantId: '00000000-0000-4000-8000-000000000001',
      evaluatedAt,
      configuration: { minimumDaysOverdue: 3 },
    });

    expect(findManyArguments).toMatchObject({
      where: {
        status: 'OPEN',
        dueAt: { lt: new Date('2026-10-16T12:00:00.000Z') },
      },
    });
    expect(result.scannedCount).toBe(3);
    expect(result.violations).toMatchObject([
      {
        subjectKey: 'CAPA_ACTION:00000000-0000-4000-8000-000000000101',
        sourceReference: 'CAPA-2026-001 · Verify corrective action',
        ownerUserId: '00000000-0000-4000-8000-000000000102',
        details: { daysOverdue: 5 },
      },
    ]);
  });

  it('reports overdue calibration only for active calibration-controlled equipment', async () => {
    let countArguments: unknown;
    const transaction = {
      equipment: {
        count: (arguments_: unknown) => {
          countArguments = arguments_;
          return Promise.resolve(2);
        },
        findMany: () =>
          Promise.resolve([
            {
              id: '00000000-0000-4000-8000-000000000201',
              code: 'EQ-001',
              name: 'Analytical balance',
              criticality: 'CRITICAL',
              nextCalibrationAt: new Date('2026-10-09T12:00:00.000Z'),
              ownerUserId: null,
            },
          ]),
      },
    } as unknown as Prisma.TransactionClient;
    const evaluator = new EquipmentCalibrationOverdueRuleEvaluator();

    const result = await evaluator.evaluate({
      transaction,
      tenantId: '00000000-0000-4000-8000-000000000001',
      evaluatedAt,
      configuration: { minimumDaysOverdue: 7 },
    });

    expect(countArguments).toMatchObject({
      where: {
        status: 'ACTIVE',
        calibrationRequired: true,
      },
    });
    expect(result.scannedCount).toBe(2);
    expect(result.violations[0]).toMatchObject({
      subjectKey: 'EQUIPMENT_CALIBRATION:00000000-0000-4000-8000-000000000201',
      sourceReference: 'EQ-001 · Analytical balance',
      details: { daysOverdue: 10 },
    });
  });

  it('rejects unknown or unsafe configuration values', () => {
    const evaluator = new EquipmentCalibrationOverdueRuleEvaluator();

    expect(() =>
      evaluator.normalizeConfiguration({ minimumDaysOverdue: 366 }),
    ).toThrow();
    expect(() =>
      evaluator.normalizeConfiguration({ minimumDaysOverdue: 0, extra: true }),
    ).toThrow();
  });
});
