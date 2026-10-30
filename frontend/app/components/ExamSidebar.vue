<script setup lang="ts">
import { FREE_EXAM_MAX, catalogExamLabel, catalogExamStartNumber, catalogGroupLabel, catalogGroupLinks, isCatalogGroupActive, type ExamCatalogEntry, type ExamCatalogGroup } from '~/utils/examCatalog'

const route = useRoute()
const openExam = ref<number | null>(null)
const mobileOpen = ref(false)
const mobileToggle = ref<HTMLButtonElement | null>(null)
const { user, authResolved, ensureCurrentUser } = useAuth()
const { data: publicCatalog, status: catalogStatus, error: catalogError, refresh: refreshCatalog } = await usePublicExamCatalog()
const accessStatus = ref<'ready' | 'pending' | 'error'>(
  authResolved.value ? 'ready' : 'pending',
)
let resolvingAccess = false

const exams = computed(() => (publicCatalog.value?.data ?? [])
  .filter(exam => catalogExamStartNumber(exam) !== undefined && exam.access !== 'paid_membership_required' && (hasFullExamAccess(user.value) || exam.exam_number <= FREE_EXAM_MAX))
  .map(exam => ({ ...exam, groupLinks: catalogGroupLinks(exam) })))
const isLoading = computed(() => accessStatus.value === 'pending' || catalogStatus.value === 'pending' || catalogStatus.value === 'idle')
const hasAccessError = computed(() => accessStatus.value === 'error' || Boolean(catalogError.value))
const retryCatalog = async () => { await resolveAccess(); await refreshCatalog() }

const resolveAccess = async () => {
  if (resolvingAccess) return

  if (authResolved.value && !user.value) {
    accessStatus.value = 'ready'
    return
  }

  if (user.value) {
    accessStatus.value = 'ready'
    return
  }

  resolvingAccess = true
  accessStatus.value = 'pending'

  const currentUser = await ensureCurrentUser()
  resolvingAccess = false

  if (currentUser) {
    accessStatus.value = 'ready'
  }
  else if (!authResolved.value) {
    accessStatus.value = 'error'
  }
  else {
    accessStatus.value = 'ready'
  }
}

onMounted(() => { void resolveAccess() })

watch(authResolved, () => { void resolveAccess() })
watch(user, (currentUser) => {
  if (!currentUser) return
  accessStatus.value = 'ready'
})

const toggleExam = (exam: number) => {
  openExam.value = openExam.value === exam ? null : exam
}

const closeMobileList = () => { mobileOpen.value = false }
const closeMobileOnEscape = () => {
  if (!mobileOpen.value) return
  closeMobileList()
  mobileToggle.value?.focus()
}

watch(() => route.fullPath, closeMobileList)

const isCurrentGroup = (exam: ExamCatalogEntry, group: ExamCatalogGroup) => route.path.startsWith('/practice/') && isCatalogGroupActive(exam, group, Number(route.params.examNumber), Number(route.params.questionNumber))
const examTarget = (exam: ExamCatalogEntry) => `/practice/${exam.exam_number}/${catalogExamStartNumber(exam)}`
</script>

<template>
  <aside
    class="exam-sidebar"
    :class="{ 'mobile-open': mobileOpen }"
    aria-label="模擬試験一覧"
    @keydown.esc="closeMobileOnEscape"
  >
    <div class="sidebar-heading">
      <UIcon name="i-lucide-files" />
      <span>模擬試験</span>
    </div>

    <button
      ref="mobileToggle"
      class="mobile-exam-toggle"
      type="button"
      :aria-expanded="mobileOpen"
      aria-controls="exam-sidebar-content"
      :title="mobileOpen ? '模擬試験を閉じる' : '模擬試験を開く'"
      @click="mobileOpen = !mobileOpen"
    >
      <UIcon name="i-lucide-files" />
      <span>模擬試験</span>
      <UIcon :name="mobileOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
    </button>

    <div id="exam-sidebar-content" class="sidebar-content">
      <div v-if="isLoading" class="sidebar-loading" role="status" aria-live="polite">
        <UIcon class="loading-spinner" name="i-lucide-loader-circle" />
        <span>模擬試験を読み込んでいます</span>
      </div>

      <div v-else-if="hasAccessError" class="sidebar-loading sidebar-error" role="alert">
        <UIcon name="i-lucide-circle-alert" />
        <span>利用資格を確認できません</span>
        <button type="button" @click="retryCatalog">再確認</button>
      </div>

      <div v-else class="exam-groups" :class="{ 'single-set': exams.length === 1 }">
        <section
          v-for="exam in exams"
          :key="exam.exam_number"
          class="exam-group"
        >
          <div
            class="exam-row"
            :class="{ current: route.path.startsWith(`/practice/${exam.exam_number}/`) }"
          >
            <NuxtLink class="exam-link" :to="examTarget(exam)" @click="closeMobileList">
              {{ catalogExamLabel(exam.exam_number) }}
            </NuxtLink>
            <button
              type="button"
              :aria-expanded="openExam === exam.exam_number"
              :aria-controls="`exam-${exam.exam_number}-groups`"
              :title="openExam === exam.exam_number ? `${catalogExamLabel(exam.exam_number)}を閉じる` : `${catalogExamLabel(exam.exam_number)}を開く`"
              @click="toggleExam(exam.exam_number)"
            >
              <UIcon
                :name="openExam === exam.exam_number ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              />
              <span class="sr-only">
                {{ openExam === exam.exam_number ? `${catalogExamLabel(exam.exam_number)}を閉じる` : `${catalogExamLabel(exam.exam_number)}を開く` }}
              </span>
            </button>
          </div>

          <Transition name="groups">
            <nav v-if="openExam === exam.exam_number && exam.groupLinks.length" :id="`exam-${exam.exam_number}-groups`" class="group-list" :aria-label="`${catalogExamLabel(exam.exam_number)}の大問一覧`">
              <NuxtLink v-for="entry in exam.groupLinks" :key="entry.group.id" :to="entry.to" :class="{ active: isCurrentGroup(exam, entry.group) }" :aria-current="isCurrentGroup(exam, entry.group) ? 'location' : undefined" @click="closeMobileList">{{ catalogGroupLabel(entry.group) }}</NuxtLink>
            </nav>
          </Transition>
        </section>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.exam-sidebar {
  width: 260px;
  min-height: calc(100vh - var(--header-height));
  padding: 22px 16px;
  border-right: 1px solid #cdd9dc;
  background: #e3e9e9;
}

.sidebar-heading {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px 10px;
  color: #53676e;
  font-size: 13px;
  font-weight: 800;
}

.mobile-exam-toggle { display: none; }

.sidebar-loading {
  min-height: 120px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: #53676e;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
}

.loading-spinner {
  width: 28px;
  height: 28px;
  color: var(--teal-dark);
  animation: sidebar-spin 1s linear infinite;
}

.sidebar-error :deep(svg) { width: 25px; height: 25px; color: #b54a3b; }
.sidebar-error button {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid #aebfc3;
  border-radius: 5px;
  background: #fff;
  color: var(--teal-dark);
  font-weight: 800;
  cursor: pointer;
}
.sidebar-error button:hover { background: #f2f7f7; }

@keyframes sidebar-spin {
  to { transform: rotate(360deg); }
}

.exam-group + .exam-group {
  margin-top: 10px;
}

.exam-row {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 10px 10px 16px;
  border: 1px solid #c2ced1;
  border-radius: 6px;
  background: #fff;
}

.exam-link {
  min-width: 0;
  align-self: stretch;
  flex: 1;
  display: flex;
  align-items: center;
  color: var(--ink);
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  overflow-wrap: anywhere;
  line-height: 1.4;
}

.exam-link:hover {
  color: var(--teal-dark);
}

.exam-row.current {
  border-color: var(--teal);
}

.exam-row button {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: #e7f2f2;
  color: var(--teal-dark);
  font-size: 21px;
  cursor: pointer;
}

.exam-row button:hover {
  background: #d5ebeb;
}

.group-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 5px;
  padding: 10px 6px 4px;
}

.group-list a {
  min-height: 36px;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 8px 10px;
  overflow-wrap: anywhere;
  border-radius: 5px;
  color: #40545b;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.group-list a:hover,
.group-list a.active {
  background: #cce8e8;
  color: var(--teal-dark);
}

.group-list a.favorite { border-color: #d5b043; background: #fff3bf; color: #715310; }
.group-list a.favorite:hover { background: #ffe89a; }
.group-list a.active { box-shadow: inset 0 0 0 2px var(--teal-dark); }
.group-list a:focus-visible { outline: 2px solid var(--teal-dark); outline-offset: 2px; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.groups-enter-active,
.groups-leave-active {
  transition: opacity 150ms ease, transform 180ms ease;
}

.groups-enter-from,
.groups-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (min-width: 761px) {
  .exam-sidebar {
    position: absolute;
    top: 100%;
    left: 0;
    height: calc(100vh - var(--header-height));
    overflow-y: auto;
  }
}

@media (max-width: 760px) {
  .exam-sidebar {
    position: relative;
    width: 100%;
    min-height: auto;
    padding: 0;
    border-right: 0;
    border-bottom: 1px solid #cdd9dc;
  }

  .sidebar-heading {
    display: none;
  }

  .mobile-exam-toggle {
    width: 100%;
    height: var(--exam-toggle-height);
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) 20px;
    align-items: center;
    gap: 9px;
    padding: 0 16px;
    border: 0;
    background: transparent;
    color: var(--teal-dark);
    font-size: 14px;
    font-weight: 800;
    text-align: left;
    cursor: pointer;
  }

  .mobile-exam-toggle:hover { background: #d8e5e5; }
  .mobile-exam-toggle > :first-child,
  .mobile-exam-toggle > :last-child { width: 20px; height: 20px; }

  .sidebar-content {
    --exam-row-height: 56px;
    --exam-grid-gap: 8px;
    display: none;
    position: absolute;
    inset: 100% 0 auto;
    max-height: min(calc(var(--exam-row-height) * 3 + var(--exam-grid-gap) * 2 + 25px), calc(100vh - var(--site-navigation-height) - 12px));
    max-height: min(calc(var(--exam-row-height) * 3 + var(--exam-grid-gap) * 2 + 25px), calc(100dvh - var(--site-navigation-height) - 12px));
    padding: 12px;
    overflow-y: auto;
    scrollbar-gutter: stable;
    overscroll-behavior-y: contain;
    border-bottom: 1px solid #cdd9dc;
    background: #e3e9e9;
    box-shadow: 0 10px 16px rgba(18, 42, 48, .12);
  }

  .mobile-open .sidebar-content { display: block; }

  .exam-groups {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: var(--exam-grid-gap);
  }

  .exam-groups.single-set { grid-template-columns: minmax(0, 1fr); }
  .exam-groups.single-set .group-list { width: 100%; }
  .exam-group + .exam-group { margin-top: 0; }
  .exam-group { min-width: 0; }

  .sidebar-loading {
    min-height: 76px;
  }

  .exam-row {
    height: var(--exam-row-height);
    min-height: var(--exam-row-height);
    gap: 4px;
    padding: 5px 6px;
  }

  .exam-link { font-size: 13px; }

  .exam-row button {
    width: 44px;
    height: 44px;
    flex-basis: 44px;
  }

  /* Keep both exam controls in place while questions span the row. */
  .group-list {
    width: calc(200% + var(--exam-grid-gap));
    grid-template-columns: minmax(0, 1fr);
  }

  .exam-group:nth-child(even) .group-list {
    margin-left: calc(-100% - var(--exam-grid-gap));
  }
}
</style>
