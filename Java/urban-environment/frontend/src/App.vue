<script setup lang="ts">
import { RouterView } from 'vue-router'
import { onMounted } from 'vue'

onMounted(() => {
  console.log('App组件已挂载')
  console.log('当前路径:', window.location.pathname)
})
</script>

<template>
  <div class="app-container">
    <RouterView />
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
</style>


