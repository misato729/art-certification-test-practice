import { hasPaidAccess, type User } from '../core/auth.ts'
import { configuration, freeExamMax } from '../core/config.ts'
import { getDatabase, type Database } from '../core/db.ts'
import { fail } from '../core/errors.ts'
import { publicQuestionWhere } from './learning.ts'

export async function listIncorrectReviewQuestions(user: User | null, db: Database = getDatabase()) {
  if (!user) return fail(401, 'unauthorized', 'ログインが必要です')
  const fullAccess = await hasPaidAccess(user, db)
  const questions = await db.question.findMany({
    where: { ...(await publicQuestionWhere(db)),
      AND: [{ exam_number: { gte: 1, lte: fullAccess ? configuration.exam.set_count : freeExamMax } }],
      histories: { some: { user_id: user.id } } },
    select: { id: true, exam_number: true, question_number: true, content_version: true },
    orderBy: [{ exam_number: 'asc' }, { question_number: 'asc' }],
  })
  if (!questions.length) return { data: [], meta: { total_count: 0 } }
  // Decide the latest answer first. Older errors never resurrect after a correct answer.
  const latest = await db.answerHistory.findMany({
    where: { user_id: user.id, question_id: { in: questions.map(question => question.id) } },
    distinct: ['question_id'], orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: { question_id: true, question_version: true, is_correct: true },
  })
  const histories = new Map(latest.map(history => [String(history.question_id), history]))
  const data = questions.flatMap(question => {
    const history = histories.get(String(question.id))
    return history && !history.is_correct && history.question_version === question.content_version
      ? [{ question_id: Number(question.id), exam_number: question.exam_number, question_number: question.question_number }]
      : []
  })
  return { data, meta: { total_count: data.length } }
}
