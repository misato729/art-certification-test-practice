import assert from 'node:assert/strict'
import test from 'node:test'
import { safeRedirectPath } from '../app/utils/safeRedirectPath.ts'

test('site paths retain query parameters and fragments', () => {
  const path = '/favorites?page=2#saved'
  assert.equal(safeRedirectPath(path), path)
  assert.equal(safeRedirectPath('/premium/complete?session_id=example'), '/premium/complete?session_id=example')
})

test('missing or external redirects return home', () => {
  for (const path of [undefined, null, [], '', 'https://example.com', '//example.com', '/\\example.com', '/%5cexample.com', '/%2fexample.com', '/%0aexample.com', '/%zz']) {
    assert.equal(safeRedirectPath(path), '/')
  }
})

test('dot segments are normalized and custom defaults are supported', () => {
  assert.equal(safeRedirectPath('/admin/../favorites'), '/favorites')
  assert.equal(safeRedirectPath('//example.com', '/admin/questions'), '/admin/questions')
})
