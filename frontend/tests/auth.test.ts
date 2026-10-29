import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { computed, ref } from 'vue'
import { EXAM_CONFIG } from '../app/utils/examConfig.ts'
import { useAuth, type AuthUser } from '../app/composables/useAuth.ts'
import { useFavorites } from '../app/composables/useFavorites.ts'

const initialPaymentMode = EXAM_CONFIG.payments.enabled
beforeEach(() => { EXAM_CONFIG.payments.enabled = true })
afterEach(() => { EXAM_CONFIG.payments.enabled = initialPaymentMode })
const globals = globalThis as any
globals.computed = computed
globals.useAuth = useAuth
const user: AuthUser = {
  id: 1, name: 'Test User', email: 'test@example.invalid', role: 'user', paid_content_access: false,
  membership: { status: 'free', purchased_at: null, expires_at: null }, favorite_questions: [],
}
const createAuth = (api: (...args: any[]) => Promise<unknown>, actions: {
  signIn?: (...args: any[]) => Promise<unknown>, signUp?: (...args: any[]) => Promise<unknown>, signOut?: (...args: any[]) => Promise<unknown>,
} = {}) => {
  const states = new Map()
  const app = { $api: api, $authClient: {
    signIn: { email: actions.signIn || (async () => ({ data: {} })) },
    signUp: { email: actions.signUp || (async () => ({ data: {} })) },
    signOut: actions.signOut || (async () => ({ data: {} })),
  } }
  globals.useNuxtApp = () => app
  globals.useCookie = () => { throw new Error('Authentication must never read or write browser cookies') }
  globals.useState = (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, ref(init()))
    return states.get(key)
  }
  return { auth: useAuth(), states }
}

test('initial identity comes from a credentialed server check rather than a readable cookie', async () => {
  const calls: unknown[][] = []
  const { auth } = createAuth(async (...args) => { calls.push(args); return { data: user } })
  assert.equal(auth.isLoggedIn.value, false)
  assert.equal(auth.authResolved.value, false)
  assert.deepEqual(await auth.ensureCurrentUser(), user)
  assert.equal(auth.isLoggedIn.value, true)
  assert.deepEqual(calls, [['/api/v1/me', { credentials: 'include', retry: 0 }]])
  assert.deepEqual(auth.authHeaders.value, {})
})

test('an anonymous 401 is checked once and force can discover a newly established session', async () => {
  let requests = 0
  const { auth } = createAuth(async () => { requests += 1; if (requests === 1) throw { status: 401 }; return { data: user } })
  assert.equal(await auth.ensureCurrentUser(), null)
  assert.equal(await auth.ensureCurrentUser(), null)
  assert.equal(auth.authResolved.value, true)
  assert.equal(requests, 1)
  assert.deepEqual(await auth.ensureCurrentUser(true), user)
})

test('composables deduplicate concurrent session checks and reuse the hydrated application user', async () => {
  let requests = 0
  let resolve!: (response: unknown) => void
  const { auth } = createAuth(async () => { requests += 1; return new Promise(done => { resolve = done }) })
  const other = useAuth()
  const first = auth.ensureCurrentUser()
  const second = other.ensureCurrentUser()
  assert.equal(requests, 1)
  resolve({ data: user })
  assert.deepEqual(await first, user)
  assert.deepEqual(await second, user)
  assert.deepEqual(await other.ensureCurrentUser(), user)
  assert.equal(requests, 1)
})

test('clearing local authentication prevents an old in-flight response from restoring it', async () => {
  let resolve!: (response: unknown) => void
  const { auth } = createAuth(async () => new Promise(done => { resolve = done }))
  const pending = auth.ensureCurrentUser()
  auth.clearCurrentUser()
  resolve({ data: user })
  assert.equal(await pending, null)
  assert.equal(auth.user.value, null)
  assert.deepEqual(useFavorites().favoriteIds.value, [])
})

test('native email sign-in hydrates favorites and entitlement through me before returning', async () => {
  const calls: unknown[] = []
  const paid = { ...user, paid_content_access: true, favorite_questions: [{ id: 17, exam_number: 2, question_number: 3 }] }
  const { auth } = createAuth(async path => { calls.push(path); return { data: paid } }, {
    signIn: async input => { calls.push(input); return { data: { user: { id: 'auth-user' } } } },
  })
  const favorites = useFavorites()
  assert.deepEqual(await auth.login({ email: user.email, password: 'test-only' }), paid)
  assert.deepEqual(calls, [{ email: user.email, password: 'test-only' }, '/api/v1/me'])
  assert.equal(favorites.isFavoriteAt(2, 3), true)
  await auth.ensureCurrentUser()
  assert.equal(calls.length, 2)
})

test('native signup sends only Better Auth fields and awaits application-user hydration', async () => {
  const calls: unknown[] = []
  const { auth } = createAuth(async path => { calls.push(path); return { data: user } }, {
    signUp: async input => { calls.push(input); return { data: {} } },
  })
  await auth.signup({ name: user.name, email: user.email, password: 'test-only', password_confirmation: 'test-only' })
  assert.deepEqual(calls, [{ name: user.name, email: user.email, password: 'test-only' }, '/api/v1/me'])
  await assert.rejects(auth.signup({ name: user.name, email: user.email, password: 'test-only', password_confirmation: 'different' }))
  assert.equal(calls.length, 2)
})

test('a failed native sign-in cannot create a logged-in application state', async () => {
  let checks = 0
  const { auth } = createAuth(async () => { checks += 1; return { data: user } }, {
    signIn: async () => ({ error: { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' } }),
  })
  await assert.rejects(auth.login({ email: user.email, password: 'wrong' }))
  assert.equal(auth.isLoggedIn.value, false)
  assert.equal(checks, 0)
})

test('known library auth failures retain the existing Japanese API error envelope without native details', async () => {
  const { auth } = createAuth(async () => ({ data: user }), {
    signIn: async () => ({ error: { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Native private detail' } }),
    signUp: async () => ({ error: { status: 422, code: 'USER_ALREADY_EXISTS', message: 'Native private detail' } }),
    signOut: async () => ({ error: { status: 429, message: 'Native private detail' } }),
  })
  for (const [operation, expected] of [
    [() => auth.login({ email: user.email, password: 'wrong' }), 'メールアドレスまたはパスワードが正しくありません'],
    [() => auth.signup({ name: user.name, email: user.email, password: 'test-password', password_confirmation: 'test-password' }), '入力内容を確認してください'],
    [() => auth.logout(), '操作が集中しています。しばらく待ってからお試しください'],
  ] as const) {
    await assert.rejects(operation(), (error: any) => {
      assert.equal(error.data.error.message, expected)
      assert.equal(JSON.stringify(error).includes('Native private detail'), false)
      return true
    })
  }
})

test('a successful identity change never retains another account when application hydration fails', async () => {
  const { auth } = createAuth(async () => { throw new Error('Offline') })
  auth.user.value = { ...user, role: 'admin', favorite_questions: [{ id: 17, exam_number: 2, question_number: 3 }] }
  await assert.rejects(auth.login({ email: 'another@example.invalid', password: 'test-only' }))
  assert.equal(auth.user.value, null)
  assert.equal(auth.authResolved.value, false)
  assert.deepEqual(useFavorites().favoriteIds.value, [])
})

test('logout awaits server-side session revocation and deduplicates concurrent clicks', async () => {
  let resolve!: (value: unknown) => void
  let signOuts = 0
  const { auth } = createAuth(async () => ({ data: user }), {
    signOut: async () => { signOuts += 1; return new Promise(done => { resolve = done }) },
  })
  await auth.ensureCurrentUser()
  const first = auth.logout(); const second = auth.logout()
  await Promise.resolve()
  assert.equal(auth.isLoggedIn.value, true)
  assert.equal(signOuts, 1)
  resolve({ data: { success: true } })
  await Promise.all([first, second])
  assert.equal(auth.isLoggedIn.value, false)
  assert.equal(auth.authResolved.value, true)
  assert.deepEqual(useFavorites().favoriteIds.value, [])
})

test('a failed server sign-out retains the known session and does not report a completed logout', async () => {
  const { auth } = createAuth(async () => ({ data: user }), { signOut: async () => ({ error: { status: 503 } }) })
  await auth.ensureCurrentUser()
  await assert.rejects(auth.logout())
  assert.equal(auth.user.value?.id, user.id)
})

test('a user request from before logout cannot restore the signed-out user', async () => {
  let resolve!: (response: unknown) => void
  const { auth } = createAuth(async () => new Promise(done => { resolve = done }))
  const pending = auth.ensureCurrentUser()
  await auth.logout()
  resolve({ data: user })
  assert.equal(await pending, null)
  assert.equal(auth.user.value, null)
})

test('transient session-check failure is retryable without caching an anonymous identity', async () => {
  let checks = 0
  const { auth } = createAuth(async () => { if (++checks === 1) throw new Error('Offline'); return { data: user } })
  assert.equal(await auth.ensureCurrentUser(), null)
  assert.equal(auth.authResolved.value, false)
  assert.deepEqual(await auth.ensureCurrentUser(), user)
  assert.equal(checks, 2)
})

test('initial me hydrates favorites and mutations only use PUT or DELETE', async () => {
  const calls: Array<[string, string | undefined]> = []
  const question = { id: 23, exam_number: 3, question_number: 8 }
  const paid = { ...user, paid_content_access: true, favorite_questions: [] }
  const { auth } = createAuth(async (path, options) => {
    calls.push([path, options?.method]); return path === '/api/v1/me' ? { data: paid } : { data: { question } }
  })
  await auth.ensureCurrentUser()
  const favorites = useFavorites(); const other = useFavorites()
  await favorites.toggleFavorite(question)
  assert.equal(other.isFavoriteAt(3, 8), true)
  await other.toggleFavorite(question)
  assert.equal(favorites.isFavoriteAt(3, 8), false)
  assert.deepEqual(calls, [['/api/v1/me', undefined], ['/api/v1/questions/23/favorite', 'PUT'], ['/api/v1/questions/23/favorite', 'DELETE']])
})

test('verification access uses the application entitlement without inventing a purchase', async () => {
  const verification = { ...user, paid_content_access: true, verification_access: { expires_at: '2026-10-20T00:00:00Z' }, favorite_questions: [{ id: 61, exam_number: 6, question_number: 1 }] }
  const { auth } = createAuth(async () => ({ data: verification }))
  await auth.ensureCurrentUser()
  assert.equal(auth.user.value?.membership.status, 'free')
  assert.equal(auth.user.value?.membership.purchased_at, null)
  assert.equal(useFavorites().isFavoriteAt(6, 1), true)
})

test('anonymous and unpaid members cannot mutate premium favorites', async () => {
  let calls = 0
  const { auth } = createAuth(async () => { calls += 1; return { data: user } })
  const favorites = useFavorites(); const question = { id: 1, exam_number: 1, question_number: 1 }
  await assert.rejects(favorites.toggleFavorite(question))
  await auth.ensureCurrentUser()
  await assert.rejects(favorites.toggleFavorite(question))
  assert.equal(calls, 1)
})

test('a stale favorite mutation cannot modify a replacement session, even for the same user', async () => {
  let resolve!: (response: unknown) => void
  const question = { id: 8, exam_number: 1, question_number: 8 }
  const { auth } = createAuth(async () => new Promise(done => { resolve = done }))
  auth.user.value = { ...user, paid_content_access: true, favorite_questions: [] }
  const favorites = useFavorites(); const mutation = favorites.toggleFavorite(question)
  auth.clearCurrentUser()
  auth.user.value = { ...user, paid_content_access: true, favorite_questions: [] }
  resolve({ data: { question } })
  await mutation
  assert.equal(favorites.isFavorite(question.id), false)
})

test('failed favorite mutations retain colors while permission loss removes them', async () => {
  const question = { id: 8, exam_number: 1, question_number: 8 }
  let denied = false
  const { auth } = createAuth(async () => { if (denied) throw { data: { error: { code: 'paid_membership_required' } } }; throw new Error('Offline') })
  auth.user.value = { ...user, paid_content_access: true, favorite_questions: [question] }
  const favorites = useFavorites()
  await assert.rejects(favorites.toggleFavorite(question))
  assert.equal(favorites.isFavoriteAt(1, 8), true)
  denied = true
  await assert.rejects(favorites.toggleFavorite(question))
  assert.equal(favorites.canUseFavorites.value, false)
  assert.deepEqual(favorites.favoriteIds.value, [])
})

test('application identities are isolated between Nuxt request instances', async () => {
  const first = createAuth(async () => ({ data: user })).auth
  const second = createAuth(async () => ({ data: { ...user, id: 2 } })).auth
  await first.ensureCurrentUser(); await second.ensureCurrentUser(); await first.logout()
  assert.equal(first.user.value, null)
  assert.equal(second.user.value?.id, 2)
})

test('free-service mode permits logged-in favorites without paid access', async () => {
  EXAM_CONFIG.payments.enabled = false
  const question = { id: 1, exam_number: 1, question_number: 1 }
  const { auth } = createAuth(async () => ({ data: { question } }))
  auth.user.value = { ...user, favorite_questions: [] }
  const favorites = useFavorites()
  assert.equal(favorites.canUseFavorites.value, true)
  await favorites.toggleFavorite(question)
  assert.equal(favorites.isFavoriteAt(1, 1), true)
  await auth.logout()
  assert.equal(favorites.canUseFavorites.value, false)
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const flushActions = () => new Promise<void>(done => setImmediate(done))

test('overlapping logins serialize native cookie writes and their own me hydration', async () => {
  const alpha = { ...user, id: 101, email: 'alpha@example.invalid', paid_content_access: true, favorite_questions: [{ id: 101, exam_number: 1, question_number: 1 }] }
  const beta = { ...user, id: 202, email: 'beta@example.invalid', paid_content_access: true, favorite_questions: [{ id: 202, exam_number: 2, question_number: 2 }] }
  const nativeAlpha = deferred<void>(); const nativeBeta = deferred<void>()
  let cookieIdentity: AuthUser | null = null
  const nativeCalls: string[] = []
  const reads: { identity: AuthUser | null, response: ReturnType<typeof deferred<{ data: AuthUser }>> }[] = []
  const { auth } = createAuth(async () => {
    const response = deferred<{ data: AuthUser }>()
    reads.push({ identity: cookieIdentity, response })
    return response.promise
  }, { signIn: async ({ email }) => {
    nativeCalls.push(email)
    await (email === alpha.email ? nativeAlpha.promise : nativeBeta.promise)
    cookieIdentity = email === alpha.email ? alpha : beta
    return { data: {} }
  } })
  const other = useAuth()
  const first = auth.login({ email: alpha.email, password: 'test-password' })
  const second = other.login({ email: beta.email, password: 'test-password' })
  await flushActions()
  assert.deepEqual(nativeCalls, [alpha.email])
  nativeAlpha.resolve(); await flushActions()
  assert.equal(reads.length, 1)
  assert.equal(reads[0]!.identity?.id, alpha.id)
  nativeBeta.resolve(); await flushActions()
  assert.equal(cookieIdentity?.id, alpha.id)
  assert.equal(reads.length, 1)
  reads[0]!.response.resolve({ data: alpha })
  assert.equal((await first).id, alpha.id)
  await flushActions()
  assert.deepEqual(nativeCalls, [alpha.email, beta.email])
  assert.equal(reads.length, 2)
  assert.equal(reads[1]!.identity?.id, beta.id)
  reads[1]!.response.resolve({ data: beta })
  assert.equal((await second).id, beta.id)
  assert.equal(cookieIdentity?.id, beta.id)
  assert.equal(auth.user.value?.id, beta.id)
  assert.deepEqual(useFavorites().favoriteIds.value, [202])
})

test('signup followed immediately by logout revokes the newly established cookie after hydration', async () => {
  const nativeSignup = deferred<void>(); const nativeLogout = deferred<void>()
  const read = deferred<{ data: AuthUser }>()
  const nativeCalls: string[] = []
  let cookieIdentity: AuthUser | null = null
  const { auth } = createAuth(async () => read.promise, {
    signUp: async () => { nativeCalls.push('signup'); await nativeSignup.promise; cookieIdentity = user; return { data: {} } },
    signOut: async () => { nativeCalls.push('logout'); await nativeLogout.promise; cookieIdentity = null; return { data: {} } },
  })
  const signup = auth.signup({ name: user.name, email: user.email, password: 'test-password', password_confirmation: 'test-password' })
  const logout = auth.logout(); const duplicateLogout = useAuth().logout()
  await flushActions()
  assert.deepEqual(nativeCalls, ['signup'])
  nativeSignup.resolve(); await flushActions()
  assert.deepEqual(nativeCalls, ['signup'])
  assert.equal(cookieIdentity?.id, user.id)
  read.resolve({ data: user }); await signup; await flushActions()
  assert.deepEqual(nativeCalls, ['signup', 'logout'])
  assert.equal(auth.user.value?.id, user.id)
  nativeLogout.resolve(); await Promise.all([logout, duplicateLogout])
  assert.equal(cookieIdentity, null)
  assert.equal(auth.user.value, null)
  assert.equal(auth.authResolved.value, true)
})

test('sign-in hydration cannot reuse a me request predating the native mutation', async () => {
  const native = deferred<void>(); const oldRead = deferred<{ data: AuthUser }>(); const newRead = deferred<{ data: AuthUser }>()
  let reads = 0
  const replacement = { ...user, id: 2 }
  const { auth } = createAuth(async () => (++reads === 1 ? oldRead.promise : newRead.promise), {
    signIn: async () => { await native.promise; return { data: {} } },
  })
  const old = auth.ensureCurrentUser(true)
  const login = auth.login({ email: user.email, password: 'test-password' })
  await flushActions()
  native.resolve(); await flushActions()
  assert.equal(reads, 2)
  oldRead.resolve({ data: user })
  newRead.resolve({ data: replacement })
  assert.equal((await old)?.id, replacement.id)
  assert.equal((await login).id, replacement.id)
  assert.equal(auth.user.value?.id, replacement.id)
})

test('cleared operation generations reject a late sign-in hydration instead of returning a stale user', async () => {
  const read = deferred<{ data: AuthUser }>()
  const { auth } = createAuth(async () => read.promise)
  const login = auth.login({ email: user.email, password: 'test-password' })
  const rejected = assert.rejects(login)
  await flushActions()
  auth.clearCurrentUser()
  read.resolve({ data: user })
  await rejected
  assert.equal(auth.user.value, null)
})

test('a failed auth mutation releases the queue for the next login', async () => {
  const calls: string[] = []
  const { auth } = createAuth(async () => ({ data: user }), {
    signIn: async ({ email }) => { calls.push(email); return email === 'invalid@example.invalid' ? { error: { status: 401 } } : { data: {} } },
  })
  const failed = auth.login({ email: 'invalid@example.invalid', password: 'wrong' })
  const successful = auth.login({ email: user.email, password: 'test-password' })
  await Promise.all([assert.rejects(failed), successful])
  assert.deepEqual(calls, ['invalid@example.invalid', user.email])
  assert.equal(auth.user.value?.id, user.id)
})

test('sidebar identity checks wait for native signup instead of rejecting its old anonymous cookie', async () => {
  const native = deferred<void>()
  let cookieEstablished = false
  let reads = 0
  const { auth } = createAuth(async () => {
    reads += 1
    if (!cookieEstablished) throw { status: 401 }
    return { data: user }
  }, { signUp: async () => { await native.promise; cookieEstablished = true; return { data: {} } } })
  const signup = auth.signup({ name: user.name, email: user.email, password: 'test-password', password_confirmation: 'test-password' })
  const signupOutcome = signup.then(value => ({ value }), error => ({ error }))
  await flushActions()
  const sidebarCheck = auth.ensureCurrentUser()
  await flushActions()
  const readsBeforeCookie = reads
  native.resolve()
  const outcome = await signupOutcome
  const current = await sidebarCheck
  assert.equal(readsBeforeCookie, 0)
  assert.equal('error' in outcome, false)
  assert.equal(current?.id, user.id)
  assert.equal(auth.user.value?.id, user.id)
  assert.equal(reads, 1)
})

test('account deletion, logout and replacement login share one queue of cookie writes', async () => {
  const remove = deferred<void>(); const notify = deferred<void>()
  const replacement = { ...user, id: 2, email: 'replacement@example.invalid', paid_content_access: true, favorite_questions: [{ id: 202, exam_number: 2, question_number: 2 }] }
  let cookieIdentity: AuthUser | null = user
  let notifications = 0
  const calls: string[] = []
  const { auth } = createAuth(async (_path, options) => {
    if (options?.method === 'DELETE') {
      calls.push('delete')
      assert.deepEqual(options.body, { current_password: 'current-password' })
      await remove.promise
      cookieIdentity = null
      return undefined
    }
    calls.push('me')
    return { data: cookieIdentity }
  }, {
    signOut: async () => {
      calls.push('signOut')
      if (++notifications === 1) await notify.promise
      cookieIdentity = null
      return { data: {} }
    },
    signIn: async () => { calls.push('login'); cookieIdentity = replacement; return { data: {} } },
  })
  auth.user.value = user
  const deletion = auth.deleteAccount('current-password')
  const logout = auth.logout()
  const login = auth.login({ email: replacement.email, password: 'new-password' })
  await flushActions()
  assert.deepEqual(calls, ['delete'])
  assert.equal(cookieIdentity?.id, user.id)
  remove.resolve(); await flushActions()
  assert.deepEqual(calls, ['delete', 'signOut'])
  notify.resolve()
  await Promise.all([deletion, logout, login])
  assert.deepEqual(calls, ['delete', 'signOut', 'signOut', 'login', 'me'])
  assert.equal(cookieIdentity?.id, replacement.id)
  assert.equal(auth.user.value?.id, replacement.id)
  assert.deepEqual(useFavorites().favoriteIds.value, [202])
})

test('a rejected account deletion preserves the session and does not notify sign-out', async () => {
  let notifications = 0
  const rejected = { status: 422, data: { error: { message: '現在のパスワードが正しくありません' } } }
  const { auth } = createAuth(async () => { throw rejected }, {
    signOut: async () => { notifications += 1; return { data: {} } },
  })
  auth.user.value = user
  await assert.rejects(auth.deleteAccount('wrong-password'), error => error === rejected)
  assert.equal(notifications, 0)
  assert.equal(auth.user.value?.id, user.id)
})

test('completed deletion stays successful when best-effort native session notification fails', async () => {
  for (const fails of ['response', 'network']) {
    const calls: unknown[] = []
    const { auth } = createAuth(async (...args) => { calls.push(args); return undefined }, {
      signOut: async options => {
        assert.deepEqual(options, { fetchOptions: { timeout: 3000 } })
        if (fails === 'network') throw new Error('Offline')
        return { error: { status: 503 } }
      },
    })
    auth.user.value = user
    await auth.deleteAccount('current-password')
    assert.deepEqual(calls, [['/api/v1/me', { method: 'DELETE', credentials: 'include', retry: 0, body: { current_password: 'current-password' } }]])
    assert.equal(auth.user.value, null)
    assert.equal(auth.authResolved.value, true)
  }
})
