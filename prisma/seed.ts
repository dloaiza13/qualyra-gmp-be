import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const permissions = [
  ['users.read', 'View users in the current organization.'],
  ['users.invite', 'Invite users to the current organization.'],
  ['users.change_status', 'Change user status.'],
  ['users.assign_roles', 'Assign roles to users.'],
  ['roles.read', 'View roles.'],
  ['roles.create', 'Create roles.'],
  ['roles.update', 'Update roles.'],
  ['roles.assign', 'Assign roles.'],
  ['sessions.read_self', 'View personal sessions.'],
  ['sessions.revoke_self', 'Revoke personal sessions.'],
  ['security.events.read', 'View security events.'],
  ['notifications.read', 'View notification delivery status.'],
  ['notifications.retry', 'Retry dead-letter notification deliveries.'],
  ['help_guides.read', 'View contextual system and organization help guides.'],
  ['help_guides.manage', 'Create and edit organization help guide drafts.'],
  ['help_guides.publish', 'Publish and retire organization help guides.'],
  ['reports.read', 'View organization-wide quality reports and analytics.'],
  ['reports.export', 'Export traceable organization-wide quality reports.'],
  [
    'compliance.read',
    'View the organization compliance foundation and findings.',
  ],
  [
    'compliance.manage',
    'Manage compliance controls and evidence relationships.',
  ],
  ['compliance.evaluate', 'Run deterministic compliance evaluations.'],
  ['compliance.findings.manage', 'Create and manage compliance findings.'],
  [
    'compliance.frameworks.read',
    'View adopted compliance frameworks and requirements.',
  ],
  [
    'compliance.frameworks.manage',
    'Manage adopted compliance frameworks and requirements.',
  ],
  ['tenants.read', 'View organization settings.'],
  ['tenants.update', 'Update organization settings.'],
  ['documents.read', 'View documents.'],
  ['documents.create', 'Create documents.'],
  ['documents.update', 'Update documents.'],
  ['documents.review', 'Review documents.'],
  ['documents.approve', 'Approve documents.'],
  ['documents.release', 'Release documents.'],
  ['training.read', 'View training records.'],
  ['training.assign', 'Assign training.'],
  ['training.complete', 'Complete assigned training.'],
  ['deviations.read', 'View deviations.'],
  ['deviations.create', 'Report deviations.'],
  ['deviations.triage', 'Triage and cancel reported deviations.'],
  ['deviations.investigate', 'Complete assigned deviation investigations.'],
  ['capas.read', 'View CAPA plans and action evidence.'],
  ['capas.create', 'Create CAPA plans from completed investigations.'],
  ['capas.execute', 'Complete assigned CAPA actions.'],
  [
    'capas.schedule_effectiveness',
    'Schedule independent CAPA effectiveness reviews.',
  ],
  [
    'capas.verify_effectiveness',
    'Complete assigned CAPA effectiveness reviews.',
  ],
  [
    'capas.create_follow_up',
    'Create controlled actions after an ineffective CAPA review.',
  ],
  [
    'capas.approve_extensions',
    'Approve authenticated CAPA action due-date extensions.',
  ],
  ['audit.read', 'View audit information.'],
  ['audits.read', 'View GMP audits, findings, and signed evidence.'],
  ['audits.plan', 'Plan GMP audits and assign independent participants.'],
  ['audits.execute', 'Execute assigned audits and complete signed reports.'],
  ['audits.respond', 'Submit authenticated responses to assigned findings.'],
  ['audits.review', 'Review finding responses independently.'],
  ['audits.close', 'Sign independent GMP audit closure.'],
  ['risks.read', 'View quality risk assessments and signed FMEA evidence.'],
  ['risks.create', 'Create controlled quality risk assessments.'],
  ['risks.mitigate', 'Complete and sign assigned risk mitigations.'],
  ['risks.review', 'Independently review and sign residual risk decisions.'],
  [
    'suppliers.read',
    'View suppliers, qualifications, decisions, and SCAR evidence.',
  ],
  ['suppliers.create', 'Create controlled supplier master records.'],
  ['suppliers.assess', 'Complete and sign supplier qualification assessments.'],
  ['suppliers.approve', 'Independently approve or disqualify suppliers.'],
  ['suppliers.scar', 'Issue SCARs and sign supplier responses.'],
  [
    'suppliers.review_scar',
    'Independently review and sign SCAR response decisions.',
  ],
  [
    'equipment.read',
    'View GMP equipment, calibration, and maintenance evidence.',
  ],
  ['equipment.create', 'Create controlled GMP equipment master records.'],
  ['equipment.calibrate', 'Complete and sign equipment calibration records.'],
  ['equipment.maintain', 'Complete and sign equipment maintenance records.'],
  [
    'equipment.verify',
    'Independently review calibration and maintenance records.',
  ],
  ['equipment.retire', 'Independently sign equipment retirement.'],
  ['complaints.read', 'View product quality complaints and signed evidence.'],
  ['complaints.create', 'Register controlled product quality complaints.'],
  ['complaints.triage', 'Triage and assign product quality complaints.'],
  ['complaints.investigate', 'Complete assigned complaint investigations.'],
  ['complaints.review', 'Independently decide and close complaints.'],
  ['complaints.cancel', 'Cancel invalid complaints before triage.'],
  ['recalls.read', 'View controlled recalls and field-action evidence.'],
  ['recalls.create', 'Report controlled recalls and field actions.'],
  ['recalls.assess', 'Complete and sign field-action risk assessments.'],
  ['recalls.approve', 'Independently approve or reject field actions.'],
  [
    'recalls.execute',
    'Record append-only execution and reconciliation evidence.',
  ],
  [
    'recalls.close',
    'Independently sign field-action reconciliation and closure.',
  ],
  ['recalls.cancel', 'Cancel invalid field-action records before assessment.'],
  ['product_reviews.read', 'View product quality reviews and trend snapshots.'],
  [
    'product_reviews.create',
    'Create controlled product quality review scopes.',
  ],
  [
    'product_reviews.prepare',
    'Prepare and sign product quality review assessments.',
  ],
  ['product_reviews.approve', 'Independently approve product quality reviews.'],
  [
    'product_reviews.cancel',
    'Cancel invalid product review scopes before assessment.',
  ],
  ['photo_evidence.read', 'View controlled photographic evidence.'],
  [
    'photo_evidence.upload',
    'Capture and upload controlled photographic evidence.',
  ],
  ['changes.read', 'View GMP change controls.'],
  ['changes.create', 'Propose GMP change controls.'],
  ['changes.assess', 'Assess change impact, risk, and implementation plans.'],
  ['changes.approve', 'Approve or reject independently assessed changes.'],
  ['changes.implement', 'Complete assigned change implementation tasks.'],
  ['changes.verify', 'Verify change effectiveness independently.'],
] as const;

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;

if (!migrationDatabaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL is required to seed permissions.');
}

const adapter = new PrismaPg({
  connectionString: migrationDatabaseUrl,
  connectionTimeoutMillis: 5_000,
});
const prisma = new PrismaClient({ adapter });

async function seedPermissions(): Promise<void> {
  for (const [code, description] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, description },
      update: { description },
    });
  }
}

async function seedComplianceDemo(): Promise<boolean> {
  const tenantId = process.env.COMPLIANCE_DEMO_TENANT_ID;
  if (!tenantId) return false;

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const creator = await transaction.user.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!creator) {
      throw new Error(
        'COMPLIANCE_DEMO_TENANT_ID must identify a tenant with an active user.',
      );
    }
    const framework = await transaction.complianceFramework.upsert({
      where: {
        tenantId_code_version: {
          tenantId,
          code: 'ISO-13485',
          version: '2016',
        },
      },
      create: {
        tenantId,
        code: 'ISO-13485',
        name: 'ISO 13485',
        version: '2016',
        description:
          'Demo framework for validating medical-device quality-system mappings. Contains original summaries only.',
        jurisdiction: 'International',
        active: true,
        createdByUserId: creator.id,
      },
      update: {},
      select: { id: true },
    });
    const requirements = [
      [
        '4.2.4',
        'Document control',
        'Maintain approved, current and traceable quality-system documents.',
      ],
      [
        '6.2',
        'Personnel competence',
        'Ensure personnel are competent through appropriate education, training and experience.',
      ],
      [
        '7.4',
        'Purchasing controls',
        'Apply risk-appropriate controls to suppliers and purchased product.',
      ],
      [
        '7.6',
        'Monitoring and measuring equipment',
        'Control equipment used to demonstrate product conformity.',
      ],
      [
        '8.2.4',
        'Internal audits',
        'Plan and perform independent audits of the quality management system.',
      ],
      [
        '8.5.2',
        'Corrective action',
        'Eliminate causes of detected nonconformities and verify effective action.',
      ],
    ] as const;
    const requirementIds = new Map<string, string>();
    for (const [code, title, description] of requirements) {
      const requirement = await transaction.complianceRequirement.upsert({
        where: {
          tenantId_frameworkId_code: {
            tenantId,
            frameworkId: framework.id,
            code,
          },
        },
        create: {
          tenantId,
          frameworkId: framework.id,
          code,
          title,
          description,
          severity: 'MAJOR',
          weight: 1,
          mandatory: true,
          createdByUserId: creator.id,
        },
        update: {},
        select: { id: true },
      });
      requirementIds.set(code, requirement.id);
    }
    const rules = [
      {
        key: 'CAPA-ACTION-OVERDUE',
        name: 'Acciones CAPA vencidas',
        description:
          'Detecta acciones correctivas o preventivas abiertas cuya fecha objetivo ya venció.',
        implementationKey: 'CAPA_ACTION_OVERDUE_V1',
        category: 'CAPA',
        severity: 'MAJOR' as const,
        requirementCode: '8.5.2',
      },
      {
        key: 'EQUIPMENT-CALIBRATION-OVERDUE',
        name: 'Calibraciones vencidas',
        description:
          'Detecta equipos activos que requieren calibración y cuya próxima fecha de calibración ya venció.',
        implementationKey: 'EQUIPMENT_CALIBRATION_OVERDUE_V1',
        category: 'Equipment / Calibration',
        severity: 'CRITICAL' as const,
        requirementCode: '7.6',
      },
    ];
    for (const rule of rules) {
      const requirementId = requirementIds.get(rule.requirementCode);
      if (!requirementId) {
        throw new Error(`Missing demo requirement ${rule.requirementCode}.`);
      }
      await transaction.complianceRule.upsert({
        where: { tenantId_key: { tenantId, key: rule.key } },
        create: {
          tenantId,
          key: rule.key,
          name: rule.name,
          description: rule.description,
          implementationKey: rule.implementationKey,
          category: rule.category,
          severity: rule.severity,
          requirementId,
          enabled: true,
          configuration: { minimumDaysOverdue: 0 },
          createdByUserId: creator.id,
        },
        // Re-running a demo seed must not overwrite a tenant's configured rule.
        update: {},
      });
    }
    await transaction.complianceReadinessPolicy.upsert({
      where: { tenantId },
      create: {
        tenantId,
        createdByUserId: creator.id,
        updatedByUserId: creator.id,
      },
      update: {},
    });
  });
  return true;
}

async function seed(): Promise<void> {
  await seedPermissions();
  const complianceDemo = await seedComplianceDemo();
  process.stdout.write(
    `Seeded ${permissions.length} permissions${
      complianceDemo ? ' and the optional compliance demo' : ''
    }.\n`,
  );
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : 'Unknown seed error'}\n`,
    );
    await prisma.$disconnect();
    process.exitCode = 1;
  });
