-- AlterTable
ALTER TABLE "capa_notifications" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "outbox_messages" ALTER COLUMN "updated_at" DROP DEFAULT;
