<template>
  <div class="loading-spinner" :class="{ small: size === 'small', large: size === 'large' }">
    <div class="spinner-ring"></div>
    <div class="loading-text" v-if="text">{{ text }}</div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  size?: 'small' | 'medium' | 'large'
  text?: string
}

defineProps<Props>()
</script>

<style scoped>
.loading-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.loading-spinner.small {
  padding: 10px;
}

.loading-spinner.large {
  padding: 40px;
}

.spinner-ring {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 123, 255, 0.2);
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-spinner.small .spinner-ring {
  width: 24px;
  height: 24px;
  border-width: 3px;
}

.loading-spinner.large .spinner-ring {
  width: 60px;
  height: 60px;
  border-width: 6px;
}

.loading-text {
  margin-top: 12px;
  color: #666;
  font-size: 14px;
  font-weight: 500;
}

.loading-spinner.small .loading-text {
  font-size: 12px;
  margin-top: 8px;
}

.loading-spinner.large .loading-text {
  font-size: 16px;
  margin-top: 16px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>