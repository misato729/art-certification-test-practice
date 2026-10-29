import assert from 'node:assert/strict'
import test from 'node:test'
import { isSellerInformationComplete, type SellerInformation } from '../app/utils/sellerInformation.ts'

const seller: SellerInformation = {
  name: 'Seller', representative: 'Representative', address: 'Synthetic address',
  phone: '00-0000-0000', email: 'seller@example.invalid',
}

test('public and legacy disclosure require both a published address and phone', () => {
  assert.equal(isSellerInformationComplete(seller), true)
  assert.equal(isSellerInformationComplete({ ...seller, contact_disclosure_mode: 'public' }), true)
  assert.equal(isSellerInformationComplete({ ...seller, address: ' ' }), false)
  assert.equal(isSellerInformationComplete({ ...seller, phone: '' }), false)
})

test('on-request disclosure requires explicit operational readiness instead of public contacts', () => {
  const onRequest: SellerInformation = { ...seller, address: '', phone: '', contact_disclosure_mode: 'on_request' }
  assert.equal(isSellerInformationComplete(onRequest), false)
  assert.equal(isSellerInformationComplete({ ...onRequest, contact_disclosure_ready: false }), false)
  assert.equal(isSellerInformationComplete({ ...onRequest, contact_disclosure_ready: true }), true)
  for (const field of ['name', 'representative', 'email']) {
    assert.equal(isSellerInformationComplete({ ...onRequest, contact_disclosure_ready: true, [field]: ' ' }), false)
  }
})

test('invalid disclosure mode remains unconfigured even with all contact fields present', () => {
  assert.equal(isSellerInformationComplete({ ...seller, contact_disclosure_mode: 'unconfigured', contact_disclosure_ready: true }), false)
})
