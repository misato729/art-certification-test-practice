-- Up Migration
-- Keep numeric application user IDs and all question/history/payment relations.
-- Credentials and sessions are now managed by Better Auth; old bcrypt hashes
-- are deliberately not converted into the new authentication system.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE users DROP COLUMN IF EXISTS password_digest;

CREATE TABLE auth_sessions (
  id bigserial PRIMARY KEY,
  expires_at timestamp(6) NOT NULL,
  token text NOT NULL,
  created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address text,
  user_agent text,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX auth_sessions_token_unique ON auth_sessions(token);
CREATE INDEX auth_sessions_user_id_index ON auth_sessions(user_id);

CREATE TABLE auth_accounts (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp(6),
  refresh_token_expires_at timestamp(6),
  scope text,
  password text,
  created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX auth_accounts_provider_account_unique ON auth_accounts(provider_id,account_id);
CREATE INDEX auth_accounts_user_id_index ON auth_accounts(user_id);

CREATE TABLE auth_verifications (
  id bigserial PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamp(6) NOT NULL,
  created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX auth_verifications_identifier_index ON auth_verifications(identifier);

-- Credentials cannot be restored from deleted legacy hashes. This migration is
-- intentionally irreversible; node-pg-migrate rejects a down operation for it.
