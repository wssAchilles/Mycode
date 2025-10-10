<template>
  <div class="test-container">
    <h1>🎯 测试页面</h1>
    <p>如果您能看到这个页面，说明Vue应用运行正常！</p>
    <div class="test-info">
      <div class="info-item">
        <strong>当前时间：</strong> {{ currentTime }}
      </div>
      <div class="info-item">
        <strong>路由路径：</strong> {{ $route.path }}
      </div>
      <div class="info-item">
        <strong>Vue版本：</strong> Vue 3
      </div>
    </div>
    <div class="test-actions">
      <button @click="testClick" class="test-btn">
        点击测试 ({{ clickCount }} 次)
      </button>
      <router-link to="/dashboard" class="test-btn">
        前往仪表盘
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const currentTime = ref('')
const clickCount = ref(0)

function updateTime() {
  currentTime.value = new Date().toLocaleString('zh-CN')
}

function testClick() {
  clickCount.value++
  console.log('测试点击', clickCount.value)
}

onMounted(() => {
  console.log('TestView 组件已挂载')
  updateTime()
  setInterval(updateTime, 1000)
})
</script>

<style scoped>
.test-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  text-align: center;
  padding: 2rem;
}

h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
  text-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

p {
  font-size: 1.2rem;
  margin-bottom: 2rem;
  opacity: 0.9;
}

.test-info {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 2rem;
  margin: 2rem 0;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.info-item {
  margin: 1rem 0;
  font-size: 1.1rem;
}

.test-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  justify-content: center;
}

.test-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  text-decoration: none;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-block;
}

.test-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

@media (max-width: 768px) {
  h1 {
    font-size: 2rem;
  }
  
  .test-container {
    padding: 1rem;
  }
  
  .test-actions {
    flex-direction: column;
    align-items: center;
  }
}
</style>
