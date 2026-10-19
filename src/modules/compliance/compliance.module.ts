import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ComplianceService } from './application/compliance.service.js';
import { ComplianceEvaluationService } from './application/compliance-evaluation.service.js';
import { ComplianceRuleRegistry } from './application/compliance-rule-registry.js';
import { COMPLIANCE_RULE_EVALUATORS } from './domain/compliance-rule.js';
import { ComplianceEvidenceSourceResolver } from './domain/compliance-evidence-source.js';
import { CapaActionOverdueRuleEvaluator } from './infrastructure/capa-action-overdue-rule.evaluator.js';
import { EquipmentCalibrationOverdueRuleEvaluator } from './infrastructure/equipment-calibration-overdue-rule.evaluator.js';
import { PrismaComplianceEvidenceSourceResolver } from './infrastructure/prisma-compliance-evidence-source-resolver.js';
import { ComplianceController } from './presentation/compliance.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [ComplianceController],
  providers: [
    ComplianceService,
    ComplianceEvaluationService,
    ComplianceRuleRegistry,
    CapaActionOverdueRuleEvaluator,
    EquipmentCalibrationOverdueRuleEvaluator,
    {
      provide: COMPLIANCE_RULE_EVALUATORS,
      useFactory: (
        capaActionOverdue: CapaActionOverdueRuleEvaluator,
        equipmentCalibrationOverdue: EquipmentCalibrationOverdueRuleEvaluator,
      ) => [capaActionOverdue, equipmentCalibrationOverdue],
      inject: [
        CapaActionOverdueRuleEvaluator,
        EquipmentCalibrationOverdueRuleEvaluator,
      ],
    },
    {
      provide: ComplianceEvidenceSourceResolver,
      useClass: PrismaComplianceEvidenceSourceResolver,
    },
  ],
})
export class ComplianceModule {}
