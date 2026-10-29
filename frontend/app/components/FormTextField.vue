<script setup lang="ts">
defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{
  name: string
  label: string
  id: string
  type?: 'text' | 'email' | 'password' | 'number'
  admin?: boolean
  icon?: string
}>(), { type: 'text', admin: false })
const value = defineModel<string | number>({ required: true })
</script>

<template>
  <UFormField eager-validation :name="name" :label="label" :class="admin ? 'admin-field' : 'field'" :ui="{ error: 'form-field-error' }">
    <!-- @vue-generic {string | number, {}} -->
    <UInput :id="id" v-model="value" v-bind="$attrs" :type="type" :icon="icon" :class="{ 'admin-login-input': icon }" :ui="{ root: 'w-full', base: 'w-full ring-0' }" />
  </UFormField>
</template>
