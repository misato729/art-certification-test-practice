-- Adopt the existing PostgreSQL schema without rebuilding tables or changing IDs.
-- Rails bookkeeping tables are deliberately retained when present.
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY, name varchar(100) NOT NULL, email varchar(255) NOT NULL,
  password_digest varchar NOT NULL, role varchar(20) NOT NULL DEFAULT 'user',
  created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id bigserial PRIMARY KEY, exam_number integer NOT NULL, question_number integer NOT NULL,
  major_category_code varchar(50) NOT NULL, category_code varchar(100) NOT NULL,
  content_blocks jsonb NOT NULL DEFAULT '[]'::jsonb, explanation_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_text text, publication_status varchar(20) NOT NULL DEFAULT 'draft',
  created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS question_choices (
  id bigserial PRIMARY KEY, question_id bigint NOT NULL, choice_label varchar(10) NOT NULL,
  content_blocks jsonb NOT NULL DEFAULT '[]'::jsonb, is_correct boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL, created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS answer_histories (
  id bigserial PRIMARY KEY, user_id bigint NOT NULL, question_id bigint NOT NULL,
  selected_choice_id bigint NOT NULL, is_correct boolean NOT NULL,
  created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  id bigserial PRIMARY KEY, user_id bigint NOT NULL, question_id bigint NOT NULL,
  created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id bigserial PRIMARY KEY, user_id bigint, stripe_checkout_session_id varchar NOT NULL,
  stripe_payment_intent_id varchar, stripe_charge_id varchar, stripe_price_id varchar NOT NULL,
  amount integer NOT NULL DEFAULT 500, refunded_amount integer NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'jpy', status varchar(30) NOT NULL DEFAULT 'pending',
  paid_at timestamp(6), refunded_at timestamp(6), created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL,
  stripe_dispute_id varchar, dispute_status varchar(30), dispute_closed_at timestamp(6),
  last_refund_failure_reason varchar(100), last_refund_failed_at timestamp(6)
);
CREATE TABLE IF NOT EXISTS memberships (
  id bigserial PRIMARY KEY, user_id bigint NOT NULL, source_payment_id bigint NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active', activated_at timestamp(6) NOT NULL,
  revoked_at timestamp(6), revocation_reason varchar(30), created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id bigserial PRIMARY KEY, stripe_event_id varchar NOT NULL, event_type varchar NOT NULL,
  livemode boolean NOT NULL, processed_at timestamp(6) NOT NULL,
  created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_access_grants (
  id bigserial PRIMARY KEY, user_id bigint NOT NULL, reason varchar(255) NOT NULL, granted_by varchar(100) NOT NULL,
  expires_at timestamp(6) NOT NULL, revoked_at timestamp(6), created_at timestamp(6) NOT NULL, updated_at timestamp(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
  key varchar(64) PRIMARY KEY, request_count bigint NOT NULL, expires_at timestamp(6) NOT NULL
);

-- This also accepts templates created before the audit-field migration.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_dispute_id varchar;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS dispute_status varchar(30);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS dispute_closed_at timestamp(6);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_refund_failure_reason varchar(100);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_refund_failed_at timestamp(6);

CREATE UNIQUE INDEX IF NOT EXISTS index_users_on_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS index_questions_on_exam_number_and_question_number ON questions(exam_number, question_number);
CREATE INDEX IF NOT EXISTS index_questions_for_practice ON questions(exam_number, publication_status, question_number);
CREATE INDEX IF NOT EXISTS index_questions_on_major_category_code ON questions(major_category_code);
CREATE INDEX IF NOT EXISTS index_questions_on_category_code ON questions(category_code);
CREATE INDEX IF NOT EXISTS index_questions_on_publication_status_and_id ON questions(publication_status, id);
CREATE INDEX IF NOT EXISTS index_question_choices_on_question_id ON question_choices(question_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_question_choices_on_question_id_and_choice_label ON question_choices(question_id, choice_label);
CREATE UNIQUE INDEX IF NOT EXISTS index_question_choices_on_question_id_and_display_order ON question_choices(question_id, display_order);
CREATE UNIQUE INDEX IF NOT EXISTS index_question_choices_one_correct_answer ON question_choices(question_id) WHERE is_correct = true;
CREATE INDEX IF NOT EXISTS index_answer_histories_on_user_id ON answer_histories(user_id);
CREATE INDEX IF NOT EXISTS index_answer_histories_on_question_id ON answer_histories(question_id);
CREATE INDEX IF NOT EXISTS index_answer_histories_on_selected_choice_id ON answer_histories(selected_choice_id);
CREATE INDEX IF NOT EXISTS index_answer_histories_on_user_id_and_question_id ON answer_histories(user_id, question_id);
CREATE INDEX IF NOT EXISTS index_answer_histories_on_user_id_and_created_at ON answer_histories(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS index_favorites_on_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS index_favorites_on_question_id ON favorites(question_id);
CREATE INDEX IF NOT EXISTS index_favorites_on_user_id_and_created_at ON favorites(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS index_favorites_on_user_id_and_question_id ON favorites(user_id, question_id);
CREATE INDEX IF NOT EXISTS index_payments_on_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS index_payments_on_user_id_and_created_at ON payments(user_id, created_at);
CREATE INDEX IF NOT EXISTS index_payments_on_status_and_updated_at ON payments(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS index_payments_on_stripe_checkout_session_id ON payments(stripe_checkout_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_payments_on_stripe_payment_intent_id ON payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS index_payments_on_stripe_charge_id ON payments(stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS index_payments_on_stripe_dispute_id ON payments(stripe_dispute_id) WHERE stripe_dispute_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS index_payments_one_pending_per_user ON payments(user_id) WHERE status = 'pending' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS index_memberships_on_user_id ON memberships(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_memberships_on_source_payment_id ON memberships(source_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_stripe_webhook_events_on_stripe_event_id ON stripe_webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS index_stripe_webhook_events_on_event_type_and_processed_at ON stripe_webhook_events(event_type, processed_at);
CREATE UNIQUE INDEX IF NOT EXISTS index_verification_access_grants_on_user_id ON verification_access_grants(user_id);
CREATE INDEX IF NOT EXISTS index_api_rate_limit_buckets_on_expires_at ON api_rate_limit_buckets(expires_at);

-- Retire fixed 20-question / 4-choice upper bounds only; keep positive bounds.
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_number_range;
ALTER TABLE question_choices DROP CONSTRAINT IF EXISTS question_choices_display_order_range;
DO $constraints$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('users', 'users_role_valid', $$role IN ('user', 'admin')$$),
    ('questions', 'questions_exam_number_positive', 'exam_number >= 1'),
    ('questions', 'questions_question_number_positive', 'question_number >= 1'),
    ('question_choices', 'question_choices_display_order_positive', 'display_order >= 1'),
    ('payments', 'payments_amount_positive', 'amount > 0'),
    ('payments', 'payments_currency_valid', $$currency = 'jpy'$$),
    ('payments', 'payments_refunded_amount_range', 'refunded_amount >= 0 AND refunded_amount <= amount'),
    ('payments', 'payments_status_valid', $$status IN ('pending', 'paid', 'expired', 'partially_refunded', 'refunded', 'disputed')$$),
    ('memberships', 'memberships_status_valid', $$status IN ('active', 'revoked')$$),
    ('verification_access_grants', 'verification_access_grants_audit_required', 'char_length(btrim(reason)) > 0 AND char_length(btrim(granted_by)) > 0'),
    ('verification_access_grants', 'verification_access_grants_limited_duration', $$expires_at > created_at AND expires_at <= created_at + interval '7 days'$$),
    ('api_rate_limit_buckets', 'api_rate_limit_count_positive', 'request_count > 0')
  ) AS rules(table_name, constraint_name, expression)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass(item.table_name) AND conname = item.constraint_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', item.table_name, item.constraint_name, item.expression);
    END IF;
  END LOOP;
END $constraints$;

-- Detect existing Rails FKs by table and column, retaining their original names.
DO $foreign_keys$
DECLARE item record; column_number smallint;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('question_choices', 'question_id', 'questions', 'fk_choices_question', 'CASCADE'),
    ('answer_histories', 'user_id', 'users', 'fk_histories_user', 'CASCADE'),
    ('answer_histories', 'question_id', 'questions', 'fk_histories_question', 'CASCADE'),
    ('answer_histories', 'selected_choice_id', 'question_choices', 'fk_histories_choice', 'NO ACTION'),
    ('favorites', 'user_id', 'users', 'fk_favorites_user', 'CASCADE'),
    ('favorites', 'question_id', 'questions', 'fk_favorites_question', 'CASCADE'),
    ('payments', 'user_id', 'users', 'fk_payments_user', 'SET NULL'),
    ('memberships', 'user_id', 'users', 'fk_memberships_user', 'CASCADE'),
    ('memberships', 'source_payment_id', 'payments', 'fk_memberships_payment', 'NO ACTION'),
    ('verification_access_grants', 'user_id', 'users', 'fk_verification_user', 'CASCADE')
  ) AS rules(table_name, column_name, target_table, constraint_name, delete_action)
  LOOP
    SELECT attnum INTO column_number FROM pg_attribute WHERE attrelid = to_regclass(item.table_name) AND attname = item.column_name;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass(item.table_name) AND contype = 'f' AND conkey = ARRAY[column_number] AND confrelid = to_regclass(item.target_table)) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s', item.table_name, item.constraint_name, item.column_name, item.target_table, item.delete_action);
    END IF;
  END LOOP;
END $foreign_keys$;
