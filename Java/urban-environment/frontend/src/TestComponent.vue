<template>
  <div style="background: red; color: white; padding: 20px; min-height: 100vh; font-family: Arial, sans-serif;">
    <h1>🚀 Vue应用成功运行！</h1>
    <p>✅ {{ message }}</p>
    <p>⏰ 当前时间: {{ currentTime }}</p>
    <div style="margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 8px;">
      <h3>系统状态检查:</h3>
      <ul>
        <li>✅ HTML文档加载成功</li>
        <li>✅ Vue 3应用创建成功</li>
        <li>✅ 单文件组件工作正常</li>
        <li>✅ 响应式数据绑定正常</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const message = ref('单文件组件测试成功!')
const currentTime = ref(new Date().toLocaleString())

onMounted(() => {
  console.log('TestComponent组件已挂载')
  
  setInterval(() => {
    currentTime.value = new Date().toLocaleString()
  }, 1000)
})
</script>