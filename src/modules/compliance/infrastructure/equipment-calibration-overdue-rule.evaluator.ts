import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  ComplianceRuleEvaluator,
  type ComplianceRuleEvaluation,
  type ComplianceRuleEvaluationContext,
} from '../domain/compliance-rule.js';

const configurationSchema = z
  .object({
    minimumDaysOverdue: z.coerce.number().int().min(0).max(365).default(0),
  })
  .strict()
  .default({ minimumDaysOverdue: 0 });

@Injectable()
export class EquipmentCalibrationOverdueRuleEvaluator extends ComplianceRuleEvaluator {
  readonly definition = {
    implementationKey: 'EQUIPMENT_CALIBRATION_OVERDUE_V1',
    name: 'Calibraciones vencidas',
    description:
      'Detecta equipos activos que requieren calibración y tienen una fecha de próxima calibración vencida.',
    sourceEntityType: 'EQUIPMENT',
    defaultCategory: 'Equipment / Calibration',
    defaultSeverity: 'CRITICAL',
    configurationFields: [
      {
        key: 'minimumDaysOverdue',
        label: 'Días mínimos de atraso',
        description: 'Ignora atrasos menores a este número de días calendario.',
        type: 'INTEGER',
        minimum: 0,
        maximum: 365,
        defaultValue: 0,
      },
    ],
  } as const;

  normalizeConfiguration(configuration: unknown): Prisma.InputJsonObject {
    return configurationSchema.parse(configuration ?? {});
  }

  async evaluate(
    context: ComplianceRuleEvaluationContext,
  ): Promise<ComplianceRuleEvaluation> {
    const configuration = configurationSchema.parse(
      context.configuration ?? {},
    );
    const threshold = new Date(
      context.evaluatedAt.getTime() -
        configuration.minimumDaysOverdue * millisecondsPerDay,
    );
    const where = {
      tenantId: context.tenantId,
      status: 'ACTIVE' as const,
      calibrationRequired: true,
    };
    const [scannedCount, equipment] = await Promise.all([
      context.transaction.equipment.count({ where }),
      context.transaction.equipment.findMany({
        where: { ...where, nextCalibrationAt: { lt: threshold } },
        orderBy: { nextCalibrationAt: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          criticality: true,
          nextCalibrationAt: true,
          ownerUserId: true,
        },
      }),
    ]);

    return {
      scannedCount,
      violations: equipment.flatMap((item) => {
        if (!item.nextCalibrationAt) return [];
        const daysOverdue = elapsedDays(
          item.nextCalibrationAt,
          context.evaluatedAt,
        );
        return [
          {
            subjectKey: `EQUIPMENT_CALIBRATION:${item.id}`,
            sourceEntityType: 'EQUIPMENT' as const,
            sourceEntityId: item.id,
            sourceReference: `${item.code} · ${item.name}`,
            title: `${item.code}: calibración vencida`,
            description: `El equipo “${item.name}” requiere calibración y su fecha objetivo venció hace ${daysOverdue} día${daysOverdue === 1 ? '' : 's'}.`,
            dueAt: item.nextCalibrationAt,
            ownerUserId: item.ownerUserId,
            details: {
              equipmentId: item.id,
              equipmentCode: item.code,
              equipmentName: item.name,
              criticality: item.criticality,
              dueAt: item.nextCalibrationAt.toISOString(),
              daysOverdue,
            },
          },
        ];
      }),
    };
  }
}

const millisecondsPerDay = 86_400_000;

function elapsedDays(dueAt: Date, evaluatedAt: Date): number {
  return Math.max(
    1,
    Math.floor((evaluatedAt.getTime() - dueAt.getTime()) / millisecondsPerDay),
  );
}
