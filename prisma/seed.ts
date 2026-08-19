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
