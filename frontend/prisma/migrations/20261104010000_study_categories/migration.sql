-- CreateTable
CREATE TABLE "study_categories" (
    "code" VARCHAR(100) NOT NULL,
    "scheme" VARCHAR(30) NOT NULL,
    "parent_code" VARCHAR(100),
    "number" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "subtitle" VARCHAR(200),
    "source_page" INTEGER,
    "reference_page" INTEGER,

    CONSTRAINT "study_categories_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "study_categories_scheme_parent_code_sort_order_idx" ON "study_categories"("scheme", "parent_code", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "study_categories_code_scheme_key" ON "study_categories"("code", "scheme");

-- CreateIndex
CREATE UNIQUE INDEX "study_categories_scheme_parent_code_number_key" ON "study_categories"("scheme", "parent_code", "number") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "study_categories_scheme_parent_code_sort_order_key" ON "study_categories"("scheme", "parent_code", "sort_order") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "study_categories" ADD CONSTRAINT "study_categories_parent_code_scheme_fkey" FOREIGN KEY ("parent_code", "scheme") REFERENCES "study_categories"("code", "scheme") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- Generic catalog constraints; source labels are imported locally, never embedded here.
ALTER TABLE study_categories
  ADD CONSTRAINT study_categories_scheme_valid CHECK (scheme IN ('exam_scope','study_outline')),
  ADD CONSTRAINT study_categories_positive CHECK (number > 0 AND sort_order > 0 AND (source_page IS NULL OR source_page > 0) AND (reference_page IS NULL OR reference_page > 0)),
  ADD CONSTRAINT study_categories_label_valid CHECK (length(btrim(label)) > 0),
  ADD CONSTRAINT study_categories_parent_valid CHECK (parent_code IS NULL OR (scheme='study_outline' AND parent_code<>code));
