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
  ['audit.read', 'View audit information.'],
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
