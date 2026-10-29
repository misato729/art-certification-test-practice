/** Public session contract shared by the browser and Nitro; never contains password digests. */
export type FavoriteQuestion = { id: number, exam_number: number, question_number: number }
export type AuthUser = {
  id: number
  name: string
  email: string
  role: 'user' | 'admin'
  paid_content_access: boolean
  favorite_questions: FavoriteQuestion[]
  membership: { status: 'free' | 'active' | 'revoked', purchased_at: string | null, expires_at: null }
  verification_access?: { expires_at: string } | null
  created_at?: string
}
