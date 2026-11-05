<script setup lang="ts">
import { artworkImagePathSchema, nonblank } from '../../shared/schemas/content'

const props = defineProps<{ src?: string; alt?: string; label?: string }>()
const safeSource = computed(() => artworkImagePathSchema.safeParse(props.src).success ? props.src : undefined)
const imageAlt = computed(() => nonblank(props.alt) ? props.alt : '図版')
const imageLabel = computed(() => nonblank(props.label) ? props.label : '図版')
const imageDialog = useTemplateRef<HTMLDialogElement>('imageDialog')
const detail = ref(false)
const failed = ref(false)

const openImage = () => {
  if (safeSource.value && !failed.value) imageDialog.value?.showModal()
}
const closeImage = () => imageDialog.value?.close()
const closeOnBackdrop = (event: MouseEvent) => {
  if (event.target === imageDialog.value) closeImage()
}
watch(() => props.src, () => { failed.value = false; closeImage() })
onBeforeUnmount(closeImage)
</script>

<template>
  <figure v-if="safeSource" class="artwork-figure">
    <figcaption v-if="label">{{ label }}</figcaption>
    <img class="artwork-thumbnail" :src="safeSource" :alt="imageAlt" decoding="async" @error="failed = true">
    <p v-if="failed" class="artwork-error" role="status">図版を読み込めませんでした。</p>
    <button class="artwork-enlarge" type="button" :disabled="failed" :aria-label="`${imageLabel}を拡大`" @click.stop.prevent="openImage">拡大して見る</button>
    <Teleport to="#teleports">
      <dialog ref="imageDialog" class="artwork-dialog" :aria-label="`${imageLabel}の拡大表示`" @click="closeOnBackdrop" @close="detail = false">
        <header class="artwork-dialog-toolbar">
          <strong>{{ imageLabel }}</strong>
          <div>
            <button type="button" :aria-pressed="detail" @click="detail = !detail">細部を拡大</button>
            <button type="button" aria-label="閉じる" @click="closeImage">閉じる</button>
          </div>
        </header>
        <div class="artwork-dialog-stage" :class="{ 'is-detail': detail }" tabindex="0" aria-label="図版の表示領域">
          <img class="artwork-full" :src="safeSource" :alt="imageAlt" decoding="async">
        </div>
      </dialog>
    </Teleport>
  </figure>
  <p v-else class="artwork-error">図版の保存先を確認してください。</p>
</template>

<style scoped>
.artwork-figure { min-width: 0; display: grid; justify-items: center; gap: 12px; margin: 0; }
.artwork-figure > figcaption { justify-self: start; color: var(--teal, #356f91); font-size: 16px; font-weight: 800; }
.artwork-thumbnail { display: block; max-width: 100%; max-height: 560px; width: auto; height: auto; object-fit: contain; }
.artwork-enlarge,
.artwork-dialog button { min-height: 40px; padding: 8px 14px; border: 1px solid #7294a6; border-radius: 6px; background: #fff; color: #234b60; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
.artwork-enlarge:focus-visible,
.artwork-dialog button:focus-visible,
.artwork-dialog-stage:focus-visible { outline: 3px solid #356f91; outline-offset: 3px; }
.artwork-enlarge:disabled { opacity: .5; cursor: default; }
.artwork-error { margin: 0; color: #7b4545; font-size: 14px; }
.artwork-dialog { box-sizing: border-box; width: min(96vw, 1400px); height: 94dvh; max-width: 96vw; max-height: 94dvh; padding: 16px; overflow: hidden; border: 1px solid #7294a6; border-radius: 10px; background: #fff; color: #243746; }
.artwork-dialog[open] { display: flex; flex-direction: column; }
.artwork-dialog::backdrop { background: rgb(18 35 47 / 75%); }
.artwork-dialog-toolbar { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.artwork-dialog-toolbar > div { display: flex; flex-wrap: wrap; gap: 8px; }
.artwork-dialog-toolbar button[aria-pressed="true"] { background: #d8ecf6; }
.artwork-dialog-stage { flex: 1 1 auto; min-height: 0; min-width: 0; max-width: 100%; overflow: auto; background: #f3f6f8; outline-offset: -3px; }
.artwork-full { display: block; width: 100%; height: 100%; object-fit: contain; }
.artwork-dialog-stage.is-detail .artwork-full { width: auto; height: auto; max-width: none; max-height: none; }
@media (max-width: 600px) {
  .artwork-dialog { padding: 12px; }
}
</style>
