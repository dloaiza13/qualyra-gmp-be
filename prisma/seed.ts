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

seedPermissions()
  .then(async () => {
    process.stdout.write(`Seeded ${permissions.length} permissions.\n`);
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : 'Unknown seed error'}\n`,
    );
    await prisma.$disconnect();
    process.exitCode = 1;
  });
