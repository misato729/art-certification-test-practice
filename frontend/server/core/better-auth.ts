import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { AUTH_PASSWORD_MIN_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from '../../shared/schemas/auth.ts'
import { getDatabase, type Database } from './db.ts'
import { authBaseURL, authSecret, authTrustedOrigins, configuration } from './config.ts'
import { consumeAuthRateLimit, rules } from './rate-limit.ts'

export const SESSION_LIFETIME = 86400
export const AUTH_BASE_PATH = '/api/auth'
// The H3 boundary always replaces this value with the trusted socket/Fly IP.
export const AUTH_CLIENT_IP_HEADER = 'x-template-client-ip'

export function createAuth(database?: Database) {
  return betterAuth({
    appName: configuration.site.name,
    baseURL: authBaseURL(),
    basePath: AUTH_BASE_PATH,
    secret: authSecret(),
    database: prismaAdapter(database ?? getDatabase(), { provider: 'postgresql', transaction: !database }),
    trustedOrigins: authTrustedOrigins(),
    rateLimit: {
      enabled: true,
      // Better Auth owns path matching and admission before any auth mutation.
      // Its official custom storage hook shares the atomic PostgreSQL store used
      // by application limits and keeps IP addresses out of stored keys.
      customStorage: { consume: consumeAuthRateLimit },
      customRules: {
        '/sign-up/email': { window: rules.signup.period, max: rules.signup.limit },
        '/sign-in/email': { window: rules.login.period, max: rules.login.limit },
        '/get-session': false,
        '/sign-out': false,
        '**': false,
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: AUTH_PASSWORD_MIN_LENGTH,
      maxPasswordLength: AUTH_PASSWORD_MAX_LENGTH,
    },
    user: {
      modelName: 'user',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
      additionalFields: { role: { type: ['user', 'admin'], required: false, defaultValue: 'user', input: false } },
      deleteUser: { enabled: false },
      changeEmail: { enabled: false },
    },
    session: {
      modelName: 'authSession',
      fields: { userId: 'user_id', expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at',
        ipAddress: 'ip_address', userAgent: 'user_agent' },
      expiresIn: SESSION_LIFETIME,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'authAccount',
      fields: { userId: 'user_id', providerId: 'provider_id', accountId: 'account_id', accessToken: 'access_token',
        refreshToken: 'refresh_token', idToken: 'id_token', accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
      accountLinking: { enabled: false },
    },
    verification: {
      modelName: 'authVerification',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: [AUTH_CLIENT_IP_HEADER], ipv6Subnet: 128 },
      database: { generateId: 'serial' },
      cookiePrefix: `${configuration.site.id}-auth`,
      useSecureCookies: authBaseURL().startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    databaseHooks: {
      user: {
        create: {
          before: async user => {
            const name = user.name.trim()
            if (!name || Array.from(name).length > 100 || user.email.length > 255) {
              throw new APIError('BAD_REQUEST', { code: 'INVALID_USER_INPUT', message: '名前は1〜100文字、メールアドレスは255文字以内で入力してください' })
            }
            return { data: { ...user, name } }
          },
        },
      },
    },
    // These flows are outside the template's scope. HTTP also uses an allowlist.
    disabledPaths: ['/delete-user', '/delete-user/callback', '/request-password-reset', '/reset-password',
      '/reset-password/:token', '/change-email', '/change-password', '/set-password', '/update-user',
      '/send-verification-email', '/verify-email', '/sign-in/social', '/link-social', '/unlink-account'],
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      // Library errors can contain SQL/user input: keep diagnostic categories only.
      log: level => { console.error(JSON.stringify({ category: 'authentication', level })) },
    },
  })
}

export type TemplateAuth = ReturnType<typeof createAuth>
let instance: TemplateAuth | undefined
export function getAuth(): TemplateAuth { return instance ??= createAuth() }
