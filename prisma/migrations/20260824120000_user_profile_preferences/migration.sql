CREATE TYPE "UserThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');
CREATE TYPE "UserLocalePreference" AS ENUM ('ES', 'EN');

ALTER TABLE "users"
ADD COLUMN "theme_preference" "UserThemePreference" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN "locale_preference" "UserLocalePreference" NOT NULL DEFAULT 'ES',
ADD COLUMN "avatar_object_key" VARCHAR(1000),
ADD COLUMN "avatar_storage_driver" VARCHAR(50),
ADD COLUMN "avatar_content_type" VARCHAR(100),
ADD COLUMN "avatar_size_bytes" INTEGER,
ADD COLUMN "avatar_sha256" CHAR(64),
ADD COLUMN "avatar_updated_at" TIMESTAMPTZ(3);

ALTER TABLE "users"
ADD CONSTRAINT "users_avatar_metadata_consistency" CHECK (
  (
    "avatar_object_key" IS NULL AND
    "avatar_storage_driver" IS NULL AND
    "avatar_content_type" IS NULL AND
    "avatar_size_bytes" IS NULL AND
    "avatar_sha256" IS NULL AND
    "avatar_updated_at" IS NULL
  ) OR (
    "avatar_object_key" IS NOT NULL AND
    "avatar_storage_driver" IS NOT NULL AND
    "avatar_content_type" IS NOT NULL AND
    "avatar_size_bytes" IS NOT NULL AND
    "avatar_size_bytes" > 0 AND
    "avatar_sha256" IS NOT NULL AND
    "avatar_updated_at" IS NOT NULL
  )
);
