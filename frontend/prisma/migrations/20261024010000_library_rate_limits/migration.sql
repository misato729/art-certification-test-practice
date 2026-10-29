BEGIN;
CREATE TABLE "rate_limiter_flexible" (
  "key" varchar(255) PRIMARY KEY,
  "points" integer NOT NULL DEFAULT 0,
  "expire" bigint
);
CREATE INDEX "index_rate_limiter_flexible_on_expire" ON "rate_limiter_flexible"("expire");

-- Preserve active hashed buckets during deployment; no account/question data changes.
-- Exhausted buckets stay above every limit, with room for further atomic increments.
INSERT INTO "rate_limiter_flexible" ("key", "points", "expire")
SELECT "key", LEAST("request_count", 1000000)::integer,
       (EXTRACT(EPOCH FROM "expires_at" AT TIME ZONE 'UTC') * 1000)::bigint
FROM "api_rate_limit_buckets"
WHERE "expires_at" > CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
COMMIT;
