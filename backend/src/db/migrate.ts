import sql from "../db";

await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`;

await sql`
  CREATE TABLE IF NOT EXISTS "User" (
    id          TEXT PRIMARY KEY,
    "googleId"  TEXT UNIQUE NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    image       TEXT,
    points      INTEGER NOT NULL DEFAULT 0,
    role        TEXT NOT NULL DEFAULT 'user',
    status      TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`;
await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`;
await sql`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'user_role_check'
    ) THEN
      ALTER TABLE "User"
      ADD CONSTRAINT user_role_check CHECK (role IN ('user', 'admin'));
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'user_status_check'
    ) THEN
      ALTER TABLE "User"
      ADD CONSTRAINT user_status_check CHECK (status IN ('active', 'suspended'));
    END IF;
  END $$;
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Room" (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    label    TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 4
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Plan" (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    price          INTEGER NOT NULL,
    duration       TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Order" (
    id              TEXT PRIMARY KEY,
    "userId"        TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    "roomId"        TEXT NOT NULL REFERENCES "Room"(id),
    "planId"        TEXT NOT NULL REFERENCES "Plan"(id),
    "paymentMethod" TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    "expiresAt"     TIMESTAMPTZ,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Transaction" (
    id          TEXT PRIMARY KEY,
    "userId"    TEXT NOT NULL REFERENCES "User"(id),
    "orderId"   TEXT REFERENCES "Order"(id) ON DELETE SET NULL,
    type        TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    description TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'Transaction'
        AND column_name = 'topUpId'
    ) THEN
      ALTER TABLE "Transaction"
      ADD COLUMN "topUpId" UUID;
    END IF;
  END $$;
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Category" (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    icon        TEXT NOT NULL DEFAULT '📦',
    "sortOrder" INTEGER NOT NULL DEFAULT 0
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Product" (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    badge        TEXT,
    "categoryId" TEXT NOT NULL REFERENCES "Category"(id),
    price        INTEGER NOT NULL,
    stock        INTEGER NOT NULL DEFAULT 0,
    "isActive"   BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  DO $$
  BEGIN
    CREATE TYPE package_status AS ENUM ('active', 'inactive', 'archived');
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END $$;
`;

await sql`
  DO $$
  BEGIN
    CREATE TYPE master_email_status AS ENUM ('active', 'inactive', 'expired', 'suspended');
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END $$;
`;

await sql`
  DO $$
  BEGIN
    CREATE TYPE profile_status AS ENUM ('available', 'rented', 'inactive', 'expired', 'reserved');
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END $$;
`;

await sql`
  DO $$
  BEGIN
    CREATE TYPE subscription_status AS ENUM ('pending', 'active', 'expired', 'cancelled', 'refunded');
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END $$;
`;

await sql`
  CREATE TABLE IF NOT EXISTS packages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    service         TEXT NOT NULL DEFAULT 'netflix',
    description     TEXT,
    duration_days   INTEGER NOT NULL CHECK (duration_days > 0),
    price_amount    INTEGER NOT NULL CHECK (price_amount >= 0),
    currency        TEXT NOT NULL DEFAULT 'THB',
    status          package_status NOT NULL DEFAULT 'active',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS master_emails (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id            UUID REFERENCES packages(id) ON DELETE SET NULL,
    service               TEXT NOT NULL DEFAULT 'netflix',
    email                 TEXT NOT NULL,
    password_ciphertext   TEXT NOT NULL,
    status                master_email_status NOT NULL DEFAULT 'active',
    purchased_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    master_expired_at     TIMESTAMPTZ NOT NULL,
    note                  TEXT,
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ,
    CONSTRAINT master_emails_valid_lifetime CHECK (master_expired_at > purchased_at)
  )
`;

await sql`ALTER TABLE master_emails ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages(id) ON DELETE SET NULL`;
await sql`
  UPDATE master_emails me
  SET package_id = (
    SELECT id
    FROM packages
    WHERE service = me.service
      AND deleted_at IS NULL
    ORDER BY status = 'active' DESC, sort_order, price_amount, created_at
    LIMIT 1
  )
  WHERE me.package_id IS NULL
`;

await sql`
  CREATE TABLE IF NOT EXISTS profiles (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_email_id          UUID NOT NULL REFERENCES master_emails(id) ON DELETE RESTRICT,
    profile_name             TEXT NOT NULL,
    profile_pin_ciphertext   TEXT,
    status                   profile_status NOT NULL DEFAULT 'available',
    profile_expires_at       TIMESTAMPTZ,
    note                     TEXT,
    metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at               TIMESTAMPTZ
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
    profile_id                UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    package_id                UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
    parent_subscription_id    UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    status                    subscription_status NOT NULL DEFAULT 'active',
    payment_method            TEXT NOT NULL DEFAULT 'points',
    price_paid                INTEGER NOT NULL CHECK (price_paid >= 0),
    started_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at                TIMESTAMPTZ NOT NULL,
    cancelled_at              TIMESTAMPTZ,
    metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT subscriptions_valid_lifetime CHECK (expires_at > started_at),
    CONSTRAINT subscriptions_valid_cancel CHECK (cancelled_at IS NULL OR cancelled_at >= started_at)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS subscription_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id   UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    actor_user_id     TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    event_type        TEXT NOT NULL,
    message           TEXT,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id   TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS payment_accounts (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                      TEXT NOT NULL,
    promptpay_id_ciphertext   TEXT NOT NULL,
    line_cookie_ciphertext    TEXT,
    status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'inactive')),
    is_default                BOOLEAN NOT NULL DEFAULT FALSE,
    topup_expires_minutes     INTEGER NOT NULL DEFAULT 15
                              CHECK (topup_expires_minutes BETWEEN 1 AND 1440),
    note                      TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                TIMESTAMPTZ
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS point_topups (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
    payment_account_id    UUID REFERENCES payment_accounts(id) ON DELETE SET NULL,
    points                INTEGER NOT NULL CHECK (points > 0),
    payment_method        TEXT NOT NULL DEFAULT 'promptpay',
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'failed')),
    base_amount_cents     INTEGER NOT NULL CHECK (base_amount_cents > 0),
    payable_amount_cents  INTEGER NOT NULL CHECK (payable_amount_cents > 0),
    ref_decimal           INTEGER NOT NULL CHECK (ref_decimal BETWEEN 1 AND 99),
    qr_payload            TEXT,
    expires_at            TIMESTAMPTZ NOT NULL,
    paid_at               TIMESTAMPTZ,
    matched_amount_cents  INTEGER,
    line_message          JSONB,
    note                  TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT point_topups_paid_has_paid_at CHECK (status <> 'paid' OR paid_at IS NOT NULL)
  )
`;

await sql`ALTER TABLE point_topups ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL`;

await sql`
  CREATE TABLE IF NOT EXISTS line_transfer_events (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_account_id         UUID REFERENCES payment_accounts(id) ON DELETE SET NULL,
    line_revision              BIGINT,
    incoming_amount_cents      INTEGER NOT NULL CHECK (incoming_amount_cents > 0),
    balance_cents              INTEGER,
    destination_account        TEXT,
    sender_name                TEXT,
    from_account               TEXT,
    transfer_type              TEXT,
    occurred_at                TIMESTAMPTZ,
    occurred_raw               TEXT,
    raw_message                JSONB NOT NULL DEFAULT '{}'::jsonb,
    status                     TEXT NOT NULL DEFAULT 'received'
                               CHECK (status IN ('received', 'matched', 'unmatched', 'ignored', 'failed')),
    matched_topup_id           UUID REFERENCES point_topups(id) ON DELETE SET NULL,
    match_reason               TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`CREATE INDEX IF NOT EXISTS packages_active_idx ON packages (service, sort_order, price_amount) WHERE status = 'active' AND deleted_at IS NULL`;
await sql`CREATE INDEX IF NOT EXISTS master_emails_package_idx ON master_emails (package_id, status, master_expired_at) WHERE deleted_at IS NULL`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS master_emails_email_active_unique ON master_emails (LOWER(email), service) WHERE deleted_at IS NULL`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS master_emails_email_package_unique ON master_emails (LOWER(email), package_id) WHERE package_id IS NOT NULL AND deleted_at IS NULL`;
await sql`CREATE INDEX IF NOT EXISTS master_emails_stock_idx ON master_emails (service, status, master_expired_at) WHERE deleted_at IS NULL`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS profiles_master_name_unique ON profiles (master_email_id, LOWER(profile_name)) WHERE deleted_at IS NULL`;
await sql`CREATE INDEX IF NOT EXISTS profiles_available_idx ON profiles (master_email_id, status, profile_expires_at) WHERE deleted_at IS NULL`;
await sql`CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (user_id, created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS subscriptions_profile_idx ON subscriptions (profile_id, expires_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS users_status_role_idx ON "User" (status, role, "createdAt" DESC)`;
await sql`CREATE INDEX IF NOT EXISTS users_email_search_idx ON "User" (LOWER(email))`;
await sql`CREATE INDEX IF NOT EXISTS payment_accounts_status_idx ON payment_accounts (status, is_default) WHERE deleted_at IS NULL`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_default_unique
  ON payment_accounts (is_default)
  WHERE is_default = TRUE
    AND deleted_at IS NULL
`;
await sql`CREATE INDEX IF NOT EXISTS point_topups_user_idx ON point_topups (user_id, created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS point_topups_status_expires_idx ON point_topups (status, expires_at)`;
await sql`CREATE INDEX IF NOT EXISTS line_transfer_events_created_idx ON line_transfer_events (created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS line_transfer_events_account_created_idx ON line_transfer_events (payment_account_id, created_at DESC)`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS line_transfer_events_revision_unique
  ON line_transfer_events (payment_account_id, line_revision)
  WHERE line_revision IS NOT NULL
`;
await sql`DROP INDEX IF EXISTS point_topups_pending_amount_unique`;
await sql`DROP INDEX IF EXISTS point_topups_pending_account_amount_unique`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS point_topups_pending_account_amount_unique
  ON point_topups (COALESCE(payment_account_id, '00000000-0000-0000-0000-000000000000'::uuid), payable_amount_cents)
  WHERE status = 'pending'
`;
await sql`CREATE INDEX IF NOT EXISTS transaction_topup_idx ON "Transaction" ("topUpId") WHERE "topUpId" IS NOT NULL`;
await sql`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'subscriptions_no_profile_time_overlap'
    ) THEN
      ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_no_profile_time_overlap
      EXCLUDE USING gist (
        profile_id WITH =,
        tstzrange(started_at, expires_at, '[)') WITH &&
      )
      WHERE (status IN ('pending', 'active'));
    END IF;
  END $$;
`;
await sql`CREATE INDEX IF NOT EXISTS subscription_events_subscription_idx ON subscription_events (subscription_id, created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS admin_audit_logs_entity_idx ON admin_audit_logs (entity_type, entity_id, created_at DESC)`;

await sql`
  INSERT INTO packages (slug, name, service, duration_days, price_amount, sort_order)
  VALUES
    ('netflix-day', 'Netflix รายวัน', 'netflix', 1, 10, 10),
    ('netflix-week', 'Netflix รายสัปดาห์', 'netflix', 7, 49, 20),
    ('netflix-month', 'Netflix รายเดือน', 'netflix', 30, 129, 30)
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    service = EXCLUDED.service,
    duration_days = EXCLUDED.duration_days,
    price_amount = EXCLUDED.price_amount,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW()
`;

console.log("Migration completed");
await sql.end();
