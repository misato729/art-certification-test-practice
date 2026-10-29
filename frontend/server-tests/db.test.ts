import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUniqueViolation, Prisma, query, record, type Database } from '../server/core/db.ts'

test('database records keep numeric API IDs, nested JSON and UTC Date values', () => {
  const instant = new Date('2020-02-03T04:05:06.789Z')
  const input = { id: 12n, created_at: instant, choices: [{ id: 34n, content_blocks: [{ type: 'text', text: '問題' }] }], missing: null }
  const output = record(input)
  assert.deepEqual(output, { id: 12, created_at: instant, choices: [{ id: 34, content_blocks: [{ type: 'text', text: '問題' }] }], missing: null })
  assert.equal(output.created_at, instant)
  assert.equal(input.id, 12n)
  assert.equal(JSON.parse(JSON.stringify(output)).created_at, '2020-02-03T04:05:06.789Z')
  assert.equal(JSON.parse(JSON.stringify(output)).choices[0].id, 34)
})

test('database records reject integer rounding outside the supported API range', () => {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER)
  assert.deepEqual(record([maximum, -maximum]), [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])
  assert.throws(() => record({ id: maximum + 1n }), /safe range/)
  assert.throws(() => record({ count: -maximum - 1n }), /safe range/)
})

const rawError = (meta: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError('Synthetic database failure', {
  code: 'P2010', clientVersion: '7.10.1', meta,
})
const rejectsRaw = (error: Error) => ({ $executeRawUnsafe: async () => { throw error } }) as unknown as Database

test('Prisma adapter raw violations retain PostgreSQL constraint SQLSTATEs', async () => {
  for (const code of ['23505', '23503', '23514']) {
    const error = rawError({ driverAdapterError: { cause: { originalCode: code } } })
    await assert.rejects(query('UPDATE synthetic SET value=$1', [1], rejectsRaw(error)), caught => caught === error && error.code === code)
  }
  const legacy = rawError({ code: '23505' })
  await assert.rejects(query('UPDATE synthetic SET value=1', [], rejectsRaw(legacy)), caught => caught === legacy && legacy.code === '23505')
})

test('unsupported raw errors keep their Prisma code and identity', async () => {
  const error = rawError({ driverAdapterError: { cause: { kind: 'UnsupportedNativeDataType' } } })
  await assert.rejects(query('UPDATE synthetic SET value=1', [], rejectsRaw(error)), caught => caught === error && error.code === 'P2010')
})

test('unique violations recognize Prisma, PostgreSQL and wrapped adapter errors without matching other failures', () => {
  for (const error of [{ code: 'P2002' }, { code: '23505' }, { cause: { code: 'P2002' } },
    rawError({ driverAdapterError: { cause: { originalCode: '23505' } } }), rawError({ code: '23505' })]) assert.equal(isUniqueViolation(error), true)
  const cycle: { cause?: unknown } = {}
  cycle.cause = { cause: cycle }
  for (const error of [null, undefined, '23505', { code: '23503' }, { code: 'P2003' }, cycle]) assert.equal(isUniqueViolation(error), false)
})
