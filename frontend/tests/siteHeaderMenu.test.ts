import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, ref } from 'vue'

const source = readFileSync(new URL('../app/components/SiteHeader.vue', import.meta.url), 'utf8')
const menuSource = source.match(/const menuItems = computed\(\(\) => \[[\s\S]*?\n\]\)/)?.[0]
assert.ok(menuSource)

const menuFor = (loggedIn: boolean, user: { paid_content_access: boolean, role: string } | null, paymentsEnabled = true) => (
  runInNewContext(`${menuSource}; menuItems.value`, {
    computed, isLoggedIn: ref(loggedIn), user: ref(user), PAYMENTS_ENABLED: paymentsEnabled,
  }) as Array<{ label: string, to: string, icon: string }>
)

test('membership menu uses the premium label without changing its destination', () => {
  for (const [loggedIn, user] of [
    [false, null],
    [true, { paid_content_access: false, role: 'user' }],
    [true, { paid_content_access: true, role: 'user' }],
  ] as const) {
    const membership = menuFor(loggedIn, user).find(item => item.to === '/premium')
    assert.equal(membership?.label, 'プレミアム会員')
  }
})

test('anonymous users have a login link in the mobile menu', () => {
  const items = menuFor(false, null)
  const login = items.filter(item => item.to === '/login')
  assert.equal(login.length, 1)
  assert.equal(login[0]?.label, 'ログイン')
  assert.equal(login[0]?.icon, 'i-lucide-log-in')
  assert.equal(items.some(item => item.to === '/account'), false)
})

test('authenticated menus retain their existing role-specific links without login', () => {
  for (const user of [
    { paid_content_access: false, role: 'user' },
    { paid_content_access: true, role: 'user' },
    { paid_content_access: true, role: 'admin' },
  ]) {
    const items = menuFor(true, user)
    assert.equal(items.some(item => item.to === '/login'), false)
    assert.equal(items.some(item => item.to === '/history'), true)
    assert.equal(items.some(item => item.to === '/account'), true)
    assert.equal(items.some(item => item.to === '/favorites'), user.paid_content_access)
    assert.equal(items.some(item => item.to === '/admin/questions'), user.role === 'admin')
  }
})

test('menu login is mobile-only while the desktop header link remains', () => {
  assert.match(source, /'mobile-login-link': item.to === '\/login'/)
  assert.match(source, /nav a\.mobile-login-link \{ display: none; \}/)
  assert.match(source, /@media \(max-width: 760px\) \{[\s\S]*nav a\.mobile-login-link \{ display: grid; \}/)
  assert.match(source, /v-if="!isLoggedIn" class="login-link" to="\/login"/)
  assert.match(source, /\.menu-drawer\s*\{[^}]*overflow-y: auto;/)
})

test('logout is an authenticated action available in both desktop and mobile menus', () => {
  assert.match(source, /<button v-if="isLoggedIn" class="logout-button" type="button" @click="handleLogout">/)
  assert.match(source, /<UIcon name="i-lucide-log-out" \/>/)
  const [sharedStyles, mobileStyles] = source.split('@media (max-width: 760px)')
  assert.match(sharedStyles!, /nav a, \.logout-button\s*\{[^}]*display: grid;/)
  assert.doesNotMatch(mobileStyles!, /\.logout-button[^}]*display: none/)
})

test('logout closes the menu, awaits server revocation and then returns home', async () => {
  const handler = source.match(/const handleLogout = async \(\) => \{[\s\S]*?\n\}/)?.[0]
  assert.ok(handler)
  const menuOpen = ref(true)
  let logoutCalls = 0
  const destinations: string[] = []
  let finishLogout!: () => void
  const action = runInNewContext(`${handler}; handleLogout()`, {
    menuOpen,
    logout: () => {
      assert.equal(menuOpen.value, false)
      logoutCalls += 1
      return new Promise<void>(resolve => { finishLogout = resolve })
    },
    navigateTo: async (path: string) => { destinations.push(path) },
  })
  assert.equal(logoutCalls, 1)
  assert.deepEqual(destinations, [])
  finishLogout()
  await action
  assert.deepEqual(destinations, ['/'])
})


test('free service mode hides purchase links and offers favorites to signed-in members', () => {
  const anonymous = menuFor(false, null, false)
  assert.equal(anonymous.some(item => item.to === '/premium'), false)
  assert.equal(anonymous.some(item => item.to === '/favorites'), false)
  const member = menuFor(true, { paid_content_access: false, role: 'user' }, false)
  assert.equal(member.some(item => item.to === '/premium'), false)
  assert.equal(member.some(item => item.to === '/favorites'), true)
})
