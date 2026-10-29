import { z } from 'zod'

const nonblank = z.string().regex(/\S/, 'must contain non-whitespace text')
const categoryCode = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/)
const category = z.object({ value: categoryCode, label: nonblank }).passthrough()
const count = z.number().int().min(1).max(10000)

/** The source of truth for runtime, CLI, TypeScript and generated editor hints. */
export const examConfigurationSchema = z.object({
  schema_version: z.literal(1),
  site: z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    name: nonblank,
    short_name: nonblank,
    exam_name: nonblank,
    description: nonblank,
    tagline: nonblank,
    logo_path: z.string().regex(/^\/(?!\/)(?!\.\.(?:\/|$))(?!.*\/\.\.(?:\/|$))[A-Za-z0-9_./-]+$/, 'must be a local absolute asset path'),
    primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB'),
    contact_email: z.string().regex(/^(?:|[^\s@]+@[^\s@]+\.[^\s@]+)$/, 'must be empty or a valid email'),
    overview: z.array(z.object({ title: nonblank, body: nonblank }).passthrough()),
  }).passthrough(),
  exam: z.object({
    set_count: count,
    questions_per_exam: count,
    choice_labels: z.array(nonblank.max(10)).min(2).max(10),
  }).passthrough(),
  categories: z.object({
    major: z.array(category).min(1),
    minor: z.array(category.extend({ major_category_value: categoryCode })).min(1),
  }).passthrough(),
  payments: z.object({
    enabled: z.boolean(),
    free_exam_count: z.number().int().min(0),
    amount: z.number().int().min(1),
    currency: z.string().regex(/^jpy$/),
  }).passthrough(),
}).passthrough().superRefine((config, ctx) => {
  const unique = (values: string[], path: (string | number)[]) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path, message: 'values must be unique' })
  }
  unique(config.exam.choice_labels, ['exam', 'choice_labels'])
  unique(config.categories.major.map(item => item.value), ['categories', 'major'])
  unique(config.categories.minor.map(item => item.value), ['categories', 'minor'])
  for (const [index, item] of config.categories.minor.entries()) {
    if (!config.categories.major.some(major => major.value === item.major_category_value)) {
      ctx.addIssue({ code: 'custom', path: ['categories', 'minor', index, 'major_category_value'], message: 'must reference an existing major category' })
    }
  }
  if (config.payments.free_exam_count > config.exam.set_count) {
    ctx.addIssue({ code: 'custom', path: ['payments', 'free_exam_count'], message: 'must not exceed set_count' })
  }
})

export type ExamConfiguration = z.infer<typeof examConfigurationSchema>

export function parseExamConfig(input: unknown): ExamConfiguration {
  const result = examConfigurationSchema.safeParse(input)
  if (result.success) return structuredClone(result.data)
  // Only schema-controlled messages and field paths; never echo configuration values.
  throw new Error(`Invalid exam configuration: ${result.error.issues.map(issue => `${issue.path.join('.') || 'configuration'}: ${issue.message}`).join('; ')}`)
}

export function examConfigurationJsonSchema() {
  return { ...z.toJSONSchema(examConfigurationSchema, { target: 'draft-2020-12', io: 'input' }), title: 'Exam practice template configuration' }
}
