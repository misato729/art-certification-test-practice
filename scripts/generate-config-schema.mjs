import { readFile, writeFile } from 'node:fs/promises'
import { examConfigurationJsonSchema } from '../frontend/shared/schemas/exam.ts'

const path = new URL('../config/exam.schema.json', import.meta.url)
const expected = `${JSON.stringify(examConfigurationJsonSchema(), null, 2)}\n`
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== expected) {
    console.error('Generated config/exam.schema.json is outdated. Run npm run schema:generate in frontend/.')
    process.exitCode = 1
  } else console.log('Generated configuration JSON Schema is current.')
} else {
  await writeFile(path, expected)
  console.log('Generated config/exam.schema.json from the shared Zod schema.')
}
