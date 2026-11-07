import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPLICATION_SECTION_TITLE, MATERIAL_RANDOM_UNIT,
  artSections, artQuestionSection, isApplicationQuestion, sectionQuestionNumbers,
  artSectionLinks, isArtSectionActive, shuffleArtPracticeSequence, applicationPeerNumbers,
  type ArtFormatConfiguration, type ArtCatalogEntry,
} from '../app/utils/artPracticeFormat.ts'
import { createPracticeSequence, shufflePracticeSequence, type PracticePosition } from '../app/utils/practiceSequence.ts'

const config: ArtFormatConfiguration = { exam: { sets: [1, 2].map(exam_number => ({
  exam_number, sections: [
    { title: '美術史問題', first: 1, last: 80 },
    { title: APPLICATION_SECTION_TITLE, first: 81, last: 85 },
  ],
})) } }
const catalog: ArtCatalogEntry[] = [1, 2].map(exam_number => ({
  exam_number, question_numbers: [1, 2, 3, 80, 81, 82, 83, 84, 85],
  groups: [
    { id: 1, group_number: 1, question_numbers: [1, 2, 3] },
    { id: 2, group_number: 2, question_numbers: [81, 82, 83] },
    { id: 3, group_number: 3, question_numbers: [84, 85] },
  ],
}))
const positions = createPracticeSequence([1, 2], [1, 2, 3, 80, 81, 82, 83, 84, 85], catalog)
const coordinate = (p: PracticePosition) => `${p.examNumber}:${p.questionNumber}`
const sortedCoordinates = (ps: readonly PracticePosition[]) => ps.map(coordinate).sort()

// Section names/ranges are app configuration, not assumptions about a real exam.
test('ordinary section contains 1 and 80, application contains 81 and 85', () => {
  assert.equal(artQuestionSection(config, 1, 1)?.title, '美術史問題')
  assert.equal(artQuestionSection(config, 1, 80)?.title, '美術史問題')
  assert.equal(isApplicationQuestion(config, 1, 81), true)
  assert.equal(isApplicationQuestion(config, 1, 85), true)
  assert.equal(isApplicationQuestion(config, 1, 80), false)
})
test('unknown and invalid positions never invent a section', () => {
  for (const q of [-1, 0, 1.5, 86, NaN, Infinity]) assert.equal(artQuestionSection(config, 1, q), undefined)
  assert.equal(artQuestionSection(config, 3, 1), undefined)
  assert.deepEqual(artSections({ exam: {} }, 1), [])
})
test('section boundaries are not hard-coded to 80/85', () => {
  const c = { exam: { sets: [{ exam_number: 1, sections: [{ title: APPLICATION_SECTION_TITLE, first: 10, last: 12 }] }] } }
  assert.equal(isApplicationQuestion(c, 1, 10), true)
  assert.equal(isApplicationQuestion(c, 1, 81), false)
})
test('a similarly named section is not silently classified as application', () => {
  const c = { exam: { sets: [{ exam_number: 1, sections: [{ title: '実践問題', first: 1, last: 10 }] }] } }
  assert.equal(isApplicationQuestion(c, 1, 1), false)
})
test('section lookup returns only actual published numbers, sorted and unique', () => {
  assert.deepEqual(sectionQuestionNumbers(config, 1, 2, [85, 80, 81, 81, 83, 86]), [81, 83, 85])
})
test('empty published section differs from an invalid section', () => {
  assert.deepEqual(sectionQuestionNumbers(config, 1, 2, [1, 2]), [])
  for (const n of [0, -1, 1.5, 3, NaN]) assert.equal(sectionQuestionNumbers(config, 1, n, []), null)
})
test('static navigation checks publication at the start route', () => {
  const links = artSectionLinks({ exam_number: 1, question_numbers: [], isStatic: true }, config)
  assert.equal(links.length, 2)
  assert.equal(links[0]?.to, '/practice/start?exams=1&section=1')
  assert.equal(links[1]?.to, '/practice/start?exams=1&section=2')
  assert.equal(links[1]?.label, '知識・情報の活用問題（問81〜85）')
  assert.ok(links.every(link => !link.label.includes('大問')))
})
test('dynamic navigation starts at a real sparse position and limits the range', () => {
  const links = artSectionLinks({ exam_number: 1, question_numbers: [5, 10, 82, 85] }, config)
  assert.equal(links[0]?.to, '/practice/1/5?exams=1&questions=5,10')
  assert.equal(links[1]?.to, '/practice/1/82?exams=1&questions=82,85')
})
test('unpublished sections are omitted after the catalog is loaded', () => {
  assert.equal(artSectionLinks({ exam_number: 1, question_numbers: [1, 2] }, config).length, 1)
  assert.deepEqual(artSectionLinks({ exam_number: 1, question_numbers: [] }, config), [])
})
test('locked navigation retains the paywall target', () => {
  assert.ok(artSectionLinks({ exam_number: 1, question_numbers: [], isStatic: true, access: 'paid_membership_required' }, config).every(link => link.to === '/premium'))
})
test('section active state excludes the other exam and adjacent ranges', () => {
  const link = artSectionLinks({ exam_number: 1, question_numbers: [], isStatic: true }, config)[1]!
  assert.equal(isArtSectionActive(link, 1, 81), true)
  assert.equal(isArtSectionActive(link, 2, 81), false)
  assert.equal(isArtSectionActive(link, 1, 80), false)
  assert.equal(isArtSectionActive(link, 1, 86), false)
})
test('no section configuration yields no fake navigation', () => {
  assert.deepEqual(artSectionLinks(catalog[0]!, { exam: {} }), [])
})
test('singleton sections use a one-question label', () => {
  const c = { exam: { sets: [{ exam_number: 1, sections: [{ title: '資料問題', first: 1, last: 1 }] }] } }
  assert.equal(artSectionLinks({ exam_number: 1, question_numbers: [1] }, c)[0]?.label, '資料問題（問1）')
})
test('generic shuffle retains the exact old numeric algorithm', () => {
  const legacy = (items: readonly PracticePosition[], seed: number) => {
    const out = [...items]; let state = seed >>> 0
    const random = () => { state = (state + 0x6D2B79F5) >>> 0; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 0x100000000 }
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!] }
    return out
  }
  for (const seed of [0, 1, 42, 0xffffffff]) assert.deepEqual(shufflePracticeSequence(positions, seed), legacy(positions, seed))
})
test('new ordering is deterministic and independent of caller input order', () => {
  const a = shuffleArtPracticeSequence(positions, 42, catalog, config)
  assert.deepEqual(a, shuffleArtPracticeSequence([...positions].reverse(), 42, catalog, config))
})
test('no positions are lost or added for 100 different seeds', () => {
  for (let seed = 0; seed < 100; seed++) {
    assert.deepEqual(sortedCoordinates(shuffleArtPracticeSequence(positions, seed, catalog, config)), sortedCoordinates(positions))
  }
})
test('application groups stay contiguous and preserve API child order for 100 seeds', () => {
  for (let seed = 0; seed < 100; seed++) {
    const out = shuffleArtPracticeSequence(positions, seed, catalog, config).map(coordinate)
    for (const exam of [1, 2]) {
      const i = out.indexOf(`${exam}:81`)
      assert.deepEqual(out.slice(i, i + 3), [81, 82, 83].map(q => `${exam}:${q}`))
      const j = out.indexOf(`${exam}:84`)
      assert.deepEqual(out.slice(j, j + 2), [84, 85].map(q => `${exam}:${q}`))
    }
  }
})
test('ordinary stored groups do not force unrelated questions to stay together', () => {
  const noOrdinaryGroups = catalog.map(exam => ({ ...exam, groups: exam.groups?.filter(g => g.group_number !== 1) }))
  for (const seed of [1, 9, 31]) assert.deepEqual(shuffleArtPracticeSequence(positions, seed, catalog, config), shuffleArtPracticeSequence(positions, seed, noOrdinaryGroups, config))
})
test('groups with the same ID in different exams never merge', () => {
  const out = shuffleArtPracticeSequence(positions, 1234, catalog, config).map(coordinate)
  for (const exam of [1, 2]) assert.deepEqual(out.slice(out.indexOf(`${exam}:81`), out.indexOf(`${exam}:81`) + 3), [81, 82, 83].map(q => `${exam}:${q}`))
})
test('a subset never expands to unselected siblings', () => {
  const subset = positions.filter(p => p.examNumber === 1 && [2, 81, 83].includes(p.questionNumber))
  const out = shuffleArtPracticeSequence(subset, 8, catalog, config)
  assert.deepEqual(sortedCoordinates(out), sortedCoordinates(subset))
  assert.equal(out.some(p => p.questionNumber === 82), false)
})
test('application singleton groups are not combined into a fabricated five-question group', () => {
  const one = [{ exam_number: 1, question_numbers: [81, 82], groups: [{ id: 1, group_number: 1, question_numbers: [81] }, { id: 2, group_number: 2, question_numbers: [82] }] }]
  const input = [{ examNumber: 1, questionNumber: 81 }, { examNumber: 1, questionNumber: 82 }]
  const variants = new Set(Array.from({ length: 20 }, (_, seed) => shuffleArtPracticeSequence(input, seed, one, config).map(p => p.questionNumber).join(',')))
  assert.equal(variants.size, 2)
})
test('non-numeric API child order is retained within an application group', () => {
  const one = [{ exam_number: 1, question_numbers: [81, 82, 83], groups: [{ id: 1, group_number: 1, question_numbers: [83, 81, 82] }] }]
  assert.deepEqual(shuffleArtPracticeSequence([81, 82, 83].map(questionNumber => ({ examNumber: 1, questionNumber })), 1, one, config).map(p => p.questionNumber), [83, 81, 82])
})
test('catalog-only and unpublished positions are never inserted', () => {
  const input = [{ examNumber: 1, questionNumber: 81 }]
  assert.deepEqual(shuffleArtPracticeSequence(input, 2, catalog, config), input)
})
test('no group or no configuration still supports singleton random exercise', () => {
  assert.equal(shuffleArtPracticeSequence(positions, 2, [], config).length, positions.length)
  assert.equal(shuffleArtPracticeSequence(positions, 2, catalog, { exam: {} }).length, positions.length)
})
test('empty sequence works', () => {
  assert.deepEqual(shuffleArtPracticeSequence([], 0, catalog, config), [])
})
test('duplicate input positions cannot duplicate a question', () => {
  const out = shuffleArtPracticeSequence([...positions, positions[0]!], 3, catalog, config)
  assert.equal(out.length, positions.length)
})
test('input data is not mutated', () => {
  const before = JSON.stringify({ positions, catalog, config })
  shuffleArtPracticeSequence(positions, 3, catalog, config)
  artSectionLinks(catalog[0]!, config)
  assert.equal(JSON.stringify({ positions, catalog, config }), before)
})
test('peer navigation only includes selected questions from this application group', () => {
  const q = { exam_number: 1, question_number: 81, group: { id: 2, question_numbers: [81, 82, 83] }, shared_passages: [{ id: 5 }] }
  assert.deepEqual(applicationPeerNumbers(q, positions.filter(p => p.questionNumber !== 82), config), [81, 83])
})
test('ordinary questions never acquire a big-question peer navigation', () => {
  const q = { exam_number: 1, question_number: 1, group: { id: 1, question_numbers: [1, 2] }, shared_passages: [{ id: 5 }] }
  assert.deepEqual(applicationPeerNumbers(q, positions, config), [])
})
test('missing materials, group or question yields no shared navigation', () => {
  assert.deepEqual(applicationPeerNumbers(null, positions, config), [])
  assert.deepEqual(applicationPeerNumbers({ exam_number: 1, question_number: 81 }, positions, config), [])
  assert.deepEqual(applicationPeerNumbers({ exam_number: 1, question_number: 81, group: { id: 2, question_numbers: [81, 82] }, shared_passages: [] }, positions, config), [])
})
test('peer navigation never introduces siblings from another section', () => {
  assert.deepEqual(applicationPeerNumbers({ exam_number: 1, question_number: 81, group: { id: 2, question_numbers: [80, 81, 82] }, shared_passages: [{ id: 1 }] }, positions, config), [81, 82])
})
test('algorithm URL marker is versioned for saved links', () => {
  assert.equal(MATERIAL_RANDOM_UNIT, 'materials-v1')
})
