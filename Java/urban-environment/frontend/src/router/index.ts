import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      redirect: '/dashboard'
    },
    {
      path: '/test',
      name: 'test', 
      component: () => import('../views/TestView.vue'),
      meta: { title: '系统测试页面' }
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../views/AdvancedDashboard.vue'),
      meta: { title: '智慧城市环境监测仪表板' }
    },
    {
      path: '/map',
      name: 'map',
      component: () => import('../views/GoogleMapView.vue'),
      meta: { title: '智慧城市地图 - 环境监测可视化' }
    }
  ],
})

// 全局导航守卫，用于设置页面标题
router.beforeEach((to, from, next) => {
  console.log(`路由导航: 从 ${from.path} 到 ${to.path}`)
  // 设置页面标题
  document.title = to.meta.title as string || '智慧城市环境监测分析平台'
  next()
})

export default router
