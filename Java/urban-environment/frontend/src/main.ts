import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'

// 导入现代设计系统
import './styles/design-system.css'

console.log('创建Vue应用')
const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
console.log('Vue应用挂载完成')
