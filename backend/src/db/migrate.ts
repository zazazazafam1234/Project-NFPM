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
await sql`ALTER TABLE master_emails ADD COLUMN IF NOT EXISTS account_pin_ciphertext TEXT`;
await sql`ALTER TABLE master_emails ADD COLUMN IF NOT EXISTS max_profiles INTEGER NOT NULL DEFAULT 5 CHECK (max_profiles > 0)`;
await sql`UPDATE master_emails SET package_id = NULL WHERE package_id IS NOT NULL`;
await sql`
  UPDATE master_emails
  SET master_expired_at = master_expired_at + INTERVAL '1 day' - INTERVAL '1 millisecond'
  WHERE master_expired_at::time = TIME '00:00:00'
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
  UPDATE profiles
  SET profile_expires_at = profile_expires_at + INTERVAL '1 day' - INTERVAL '1 millisecond'
  WHERE profile_expires_at IS NOT NULL
    AND profile_expires_at::time = TIME '00:00:00'
`;
await sql`
  UPDATE profiles p
  SET profile_expires_at = me.master_expired_at
  FROM master_emails me
  WHERE me.id = p.master_email_id
    AND p.profile_expires_at IS NULL
    AND p.deleted_at IS NULL
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
await sql`ALTER TABLE point_topups ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT`;
await sql`ALTER TABLE point_topups ADD COLUMN IF NOT EXISTS stripe_status TEXT`;
await sql`ALTER TABLE point_topups ADD COLUMN IF NOT EXISTS stripe_promptpay_hosted_url TEXT`;
await sql`ALTER TABLE point_topups DROP CONSTRAINT IF EXISTS point_topups_ref_decimal_check`;
await sql`ALTER TABLE point_topups ADD CONSTRAINT point_topups_ref_decimal_check CHECK (ref_decimal BETWEEN 0 AND 99)`;

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

await sql`
  CREATE TABLE IF NOT EXISTS page_views (
    id           BIGSERIAL PRIMARY KEY,
    visitor_id   TEXT NOT NULL,
    user_id      TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    path         TEXT NOT NULL,
    referrer     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
// Discount wallet ("เงินส่วนลด"), kept apart from points: the satang reference
// customers add to each PromptPay top-up is credited here instead of being lost.
await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0`;
await sql`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_discount_cents_non_negative') THEN
      ALTER TABLE "User" ADD CONSTRAINT user_discount_cents_non_negative CHECK (discount_cents >= 0);
    END IF;
  END $$;
`;
await sql`
  CREATE TABLE IF NOT EXISTS discount_ledger (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    amount_cents     INTEGER NOT NULL CHECK (amount_cents <> 0),
    balance_cents    INTEGER NOT NULL CHECK (balance_cents >= 0),
    kind             TEXT NOT NULL DEFAULT 'satang'
                     CHECK (kind IN ('satang', 'topup_promotion', 'streamer_code', 'purchase', 'admin')),
    reason           TEXT NOT NULL,
    topup_id         UUID REFERENCES point_topups(id) ON DELETE SET NULL,
    subscription_id  UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS discount_ledger_user_idx ON discount_ledger (user_id, created_at DESC)`;
await sql`DROP INDEX IF EXISTS discount_ledger_topup_unique`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS discount_ledger_topup_kind_unique ON discount_ledger (topup_id, kind) WHERE topup_id IS NOT NULL`;

// "เติมครบ X ได้ส่วนลด Y บาท/%": rewards go to the discount wallet when a top-up is paid.
await sql`
  CREATE TABLE IF NOT EXISTS topup_promotions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT NOT NULL,
    min_amount_cents   INTEGER NOT NULL CHECK (min_amount_cents > 0),
    reward_type        TEXT NOT NULL CHECK (reward_type IN ('fixed', 'percent')),
    reward_value       NUMERIC(10, 2) NOT NULL CHECK (reward_value > 0),
    max_reward_cents   INTEGER CHECK (max_reward_cents IS NULL OR max_reward_cents > 0),
    status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ
  )
`;

// Streamer referral codes: one use per customer, on their first top-up, up to max_uses customers.
await sql`
  CREATE TABLE IF NOT EXISTS streamers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT NOT NULL,
    link               TEXT,
    code               TEXT NOT NULL,
    reward_type        TEXT NOT NULL CHECK (reward_type IN ('fixed', 'percent')),
    reward_value       NUMERIC(10, 2) NOT NULL CHECK (reward_value > 0),
    max_reward_cents   INTEGER CHECK (max_reward_cents IS NULL OR max_reward_cents > 0),
    max_uses           INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ
  )
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS streamers_code_unique ON streamers (UPPER(code)) WHERE deleted_at IS NULL`;
await sql`
  CREATE TABLE IF NOT EXISTS streamer_redemptions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    streamer_id    UUID NOT NULL REFERENCES streamers(id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    topup_id       UUID REFERENCES point_topups(id) ON DELETE SET NULL,
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'void')),
    reward_cents   INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    redeemed_at    TIMESTAMPTZ
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS streamer_redemptions_user_unique
  ON streamer_redemptions (user_id) WHERE status IN ('pending', 'redeemed')
`;
await sql`CREATE INDEX IF NOT EXISTS streamer_redemptions_streamer_idx ON streamer_redemptions (streamer_id, status)`;
await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS referred_streamer_id UUID REFERENCES streamers(id) ON DELETE SET NULL`;
await sql`ALTER TABLE point_topups ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES topup_promotions(id) ON DELETE SET NULL`;
await sql`ALTER TABLE point_topups ADD COLUMN IF NOT EXISTS promotion_reward_cents INTEGER NOT NULL DEFAULT 0`;
// Promotion + streamer-code discount taken off the transfer when the QR is made.
await sql`ALTER TABLE point_topups ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0`;

// Decoy rooms: display-only full rooms for the storefront. Kept apart from
// master_emails/profiles so they never touch real accounts, stock or sales.
await sql`
  CREATE TABLE IF NOT EXISTS decoy_rooms (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service      TEXT NOT NULL DEFAULT 'netflix',
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS decoy_slots (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id      UUID NOT NULL REFERENCES decoy_rooms(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS app_settings (
    key          TEXT PRIMARY KEY,
    value        JSONB NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
await sql`
  INSERT INTO app_settings (key, value)
  VALUES ('min_topup_points', '10'::jsonb)
  ON CONFLICT (key) DO NOTHING
`;

// Repair: a profile with a running rental is always "rented".
await sql`
  UPDATE profiles p
  SET status = 'rented', updated_at = NOW()
  WHERE p.status <> 'rented'
    AND p.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.profile_id = p.id AND s.status IN ('pending', 'active') AND s.expires_at > NOW()
    )
`;
await sql`CREATE INDEX IF NOT EXISTS page_views_created_idx ON page_views (created_at)`;
await sql`CREATE INDEX IF NOT EXISTS subscriptions_created_idx ON subscriptions (created_at)`;
await sql`CREATE INDEX IF NOT EXISTS point_topups_paid_idx ON point_topups (paid_at) WHERE status = 'paid'`;

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
  WHERE status = 'pending' AND payment_method = 'promptpay'
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS point_topups_stripe_intent_unique ON point_topups (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL`;
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
// Package length is stored in minutes (supports hourly/minute promotions);
// duration_days is kept in sync (rounded up, min 1) for older readers.
await sql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS duration_minutes INTEGER`;
await sql`UPDATE packages SET duration_minutes = duration_days * 1440 WHERE duration_minutes IS NULL`;
await sql`
  CREATE OR REPLACE FUNCTION packages_sync_duration() RETURNS trigger AS $$
  BEGIN
    IF NEW.duration_minutes IS NULL
      OR (TG_OP = 'UPDATE'
          AND NEW.duration_days IS DISTINCT FROM OLD.duration_days
          AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes) THEN
      NEW.duration_minutes := NEW.duration_days * 1440;
    END IF;
    NEW.duration_days := GREATEST(1, CEIL(NEW.duration_minutes / 1440.0))::int;
    RETURN NEW;
  END $$ LANGUAGE plpgsql
`;
await sql`DROP TRIGGER IF EXISTS packages_sync_duration ON packages`;
await sql`
  CREATE TRIGGER packages_sync_duration
  BEFORE INSERT OR UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION packages_sync_duration()
`;
await sql`ALTER TABLE packages ALTER COLUMN duration_minutes SET NOT NULL`;
await sql`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_duration_minutes_positive') THEN
      ALTER TABLE packages ADD CONSTRAINT packages_duration_minutes_positive CHECK (duration_minutes > 0);
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
  ON CONFLICT (slug) DO NOTHING
`;

console.log("Migration completed");
await sql.end();
