-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "content_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "group_id" BIGINT,
ADD COLUMN     "group_question_number" INTEGER,
ADD COLUMN     "lock_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "answer_histories" ADD COLUMN     "question_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "exam_sets" (
    "exam_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "publication_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_sets_pkey" PRIMARY KEY ("exam_number")
);

-- CreateTable
CREATE TABLE "question_groups" (
    "id" BIGSERIAL NOT NULL,
    "exam_number" INTEGER NOT NULL,
    "group_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "planned_question_count" INTEGER NOT NULL,
    "publication_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_passages" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "content_blocks" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_passages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_passage_references" (
    "id" BIGSERIAL NOT NULL,
    "question_id" BIGINT NOT NULL,
    "group_id" BIGINT NOT NULL,
    "passage_id" BIGINT NOT NULL,
    "anchor_id" VARCHAR(100),
    "display_order" INTEGER NOT NULL,

    CONSTRAINT "question_passage_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "question_groups_id_exam_key" ON "question_groups"("id", "exam_number");

-- CreateIndex
CREATE UNIQUE INDEX "question_groups_exam_number_key" ON "question_groups"("exam_number", "group_number");

-- CreateIndex
CREATE UNIQUE INDEX "group_passages_id_group_key" ON "group_passages"("id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_passages_label_key" ON "group_passages"("group_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "group_passages_order_key" ON "group_passages"("group_id", "display_order");

-- CreateIndex
CREATE INDEX "question_passage_references_passage_idx" ON "question_passage_references"("passage_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_passage_references_order_key" ON "question_passage_references"("question_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "questions_id_group_key" ON "questions"("id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "questions_group_number_key" ON "questions"("group_id", "group_question_number");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_group_exam_fk" FOREIGN KEY ("group_id", "exam_number") REFERENCES "question_groups"("id", "exam_number") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "question_groups" ADD CONSTRAINT "question_groups_exam_fk" FOREIGN KEY ("exam_number") REFERENCES "exam_sets"("exam_number") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "group_passages" ADD CONSTRAINT "group_passages_group_fk" FOREIGN KEY ("group_id") REFERENCES "question_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "question_passage_references" ADD CONSTRAINT "question_passage_references_question_group_fk" FOREIGN KEY ("question_id", "group_id") REFERENCES "questions"("id", "group_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "question_passage_references" ADD CONSTRAINT "question_passage_references_passage_group_fk" FOREIGN KEY ("passage_id", "group_id") REFERENCES "group_passages"("id", "group_id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- Existing standalone questions retain IDs, content, timestamps and saved learning records.
-- Missing exam rows remain compatible with legacy direct writes; grouped questions
-- always have a parent through question_groups and its composite foreign key.
INSERT INTO exam_sets(exam_number, title, publication_status)
SELECT exam_number, '模擬試験 ' || exam_number,
 CASE WHEN bool_or(publication_status='published') THEN 'published' ELSE 'draft' END
FROM questions GROUP BY exam_number;

ALTER TABLE exam_sets ADD CONSTRAINT exam_sets_valid CHECK
 (exam_number > 0 AND lock_version >= 0 AND publication_status IN ('draft','published','private'));
ALTER TABLE question_groups ADD CONSTRAINT question_groups_valid CHECK
 (group_number > 0 AND planned_question_count > 0 AND lock_version >= 0 AND publication_status IN ('draft','published','private'));
ALTER TABLE group_passages ADD CONSTRAINT group_passages_order_positive CHECK (display_order > 0);
ALTER TABLE questions ADD CONSTRAINT questions_group_membership CHECK
 ((group_id IS NULL AND group_question_number IS NULL) OR
  (group_id IS NOT NULL AND group_question_number IS NOT NULL AND group_question_number > 0));
ALTER TABLE questions ADD CONSTRAINT questions_versions_valid CHECK (content_version > 0 AND lock_version >= 0);
ALTER TABLE answer_histories ADD CONSTRAINT answer_histories_version_positive CHECK (question_version > 0);
ALTER TABLE question_passage_references ADD CONSTRAINT question_passage_references_valid CHECK
 (display_order > 0 AND (anchor_id IS NULL OR anchor_id ~ '^[A-Za-z0-9_:-]{1,100}$'));
-- A null anchor denotes the whole passage, and may occur only once per question.
CREATE UNIQUE INDEX question_passage_references_target_key ON question_passage_references
 (question_id, passage_id, anchor_id) NULLS NOT DISTINCT;
