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
export class CapaActionOverdueRuleEvaluator extends ComplianceRuleEvaluator {
  readonly definition = {
    implementationKey: 'CAPA_ACTION_OVERDUE_V1',
    name: 'Acciones CAPA vencidas',
    description:
      'Detecta acciones correctivas o preventivas abiertas cuya fecha objetivo ya venció.',
    sourceEntityType: 'CAPA',
    defaultCategory: 'CAPA',
    defaultSeverity: 'MAJOR',
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
      status: 'OPEN' as const,
    };
    const [scannedCount, actions] = await Promise.all([
      context.transaction.capaAction.count({ where }),
      context.transaction.capaAction.findMany({
        where: { ...where, dueAt: { lt: threshold } },
        orderBy: { dueAt: 'asc' },
        include: {
          capa: { select: { id: true, code: true, title: true } },
        },
      }),
    ]);

    return {
      scannedCount,
      violations: actions.map((action) => {
        const daysOverdue = elapsedDays(action.dueAt, context.evaluatedAt);
        return {
          subjectKey: `CAPA_ACTION:${action.id}`,
          sourceEntityType: 'CAPA',
          sourceEntityId: action.capa.id,
          sourceReference: `${action.capa.code} · ${action.title}`,
          title: `${action.capa.code}: acción CAPA vencida`,
          description: `La acción “${action.title}” permanece abierta y venció hace ${daysOverdue} día${daysOverdue === 1 ? '' : 's'}.`,
          dueAt: action.dueAt,
          ownerUserId: action.assignedToUserId,
          details: {
            capaId: action.capa.id,
            capaCode: action.capa.code,
            actionId: action.id,
            actionTitle: action.title,
            dueAt: action.dueAt.toISOString(),
            daysOverdue,
          },
        };
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
