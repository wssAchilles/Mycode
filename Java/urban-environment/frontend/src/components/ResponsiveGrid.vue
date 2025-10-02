<template>
  <div class="responsive-grid" :class="gridClasses">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  columns?: number | 'auto' | 'fill'
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  responsive?: boolean
  minItemWidth?: string
  alignItems?: 'stretch' | 'start' | 'center' | 'end'
  justifyItems?: 'stretch' | 'start' | 'center' | 'end'
  autoRows?: string
  dense?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  columns: 'auto',
  gap: 'md',
  responsive: true,
  minItemWidth: '320px',
  alignItems: 'stretch',
  justifyItems: 'stretch',
  autoRows: 'auto',
  dense: false
})

const gridClasses = computed(() => {
  const classes = []
  
  if (props.responsive) {
    classes.push('responsive')
  }
  
  if (typeof props.columns === 'number') {
    classes.push(`columns-${props.columns}`)
  } else {
    classes.push(`columns-${props.columns}`)
  }
  
  classes.push(`gap-${props.gap}`)
  classes.push(`align-${props.alignItems}`)
  classes.push(`justify-${props.justifyItems}`)
  
  if (props.dense) {
    classes.push('dense')
  }
  
  return classes
})
</script>

<style scoped>
.responsive-grid {
  display: grid;
  width: 100%;
  grid-auto-rows: v-bind(autoRows);
}

/* === 列数配置 === */
.columns-1 {
  grid-template-columns: 1fr;
}

.columns-2 {
  grid-template-columns: repeat(2, 1fr);
}

.columns-3 {
  grid-template-columns: repeat(3, 1fr);
}

.columns-4 {
  grid-template-columns: repeat(4, 1fr);
}

.columns-5 {
  grid-template-columns: repeat(5, 1fr);
}

.columns-6 {
  grid-template-columns: repeat(6, 1fr);
}

.columns-auto {
  grid-template-columns: repeat(auto-fit, minmax(v-bind(minItemWidth), 1fr));
}

.columns-fill {
  grid-template-columns: repeat(auto-fill, minmax(v-bind(minItemWidth), 1fr));
}

/* === 间距配置（使用设计系统间距标记） === */
.gap-xs {
  gap: var(--spacing-2);
}

.gap-sm {
  gap: var(--spacing-3);
}

.gap-md {
  gap: var(--spacing-5);
}

.gap-lg {
  gap: var(--spacing-6);
}

.gap-xl {
  gap: var(--spacing-8);
}

.gap-2xl {
  gap: var(--spacing-12);
}

/* === 对齐方式 === */
.align-stretch {
  align-items: stretch;
}

.align-start {
  align-items: start;
}

.align-center {
  align-items: center;
}

.align-end {
  align-items: end;
}

.justify-stretch {
  justify-items: stretch;
}

.justify-start {
  justify-items: start;
}

.justify-center {
  justify-items: center;
}

.justify-end {
  justify-items: end;
}

/* === 密集布局 === */
.dense {
  grid-auto-flow: dense;
}

/* === 响应式断点配置 === */
/* 超大屏幕 (1400px+) */
@media (min-width: 1400px) {
  .responsive.columns-auto {
    grid-template-columns: repeat(auto-fit, minmax(min(v-bind(minItemWidth), 280px), 1fr));
  }
}

/* 大屏幕 (1200px-1399px) */
@media (max-width: 1399px) {
  .responsive.columns-6 {
    grid-template-columns: repeat(5, 1fr);
  }
  
  .responsive.columns-5 {
    grid-template-columns: repeat(4, 1fr);
  }
}

/* 中等屏幕 (992px-1199px) */
@media (max-width: 1199px) {
  .responsive.columns-6,
  .responsive.columns-5 {
    grid-template-columns: repeat(3, 1fr);
  }
  
  .responsive.columns-4 {
    grid-template-columns: repeat(3, 1fr);
  }
  
  .gap-2xl {
    gap: var(--spacing-8);
  }
  
  .gap-xl {
    gap: var(--spacing-6);
  }
}

/* 平板屏幕 (768px-991px) */
@media (max-width: 991px) {
  .responsive.columns-6,
  .responsive.columns-5,
  .responsive.columns-4,
  .responsive.columns-3 {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .gap-2xl,
  .gap-xl {
    gap: var(--spacing-5);
  }
  
  .gap-lg {
    gap: var(--spacing-4);
  }
}

/* 手机屏幕 (576px-767px) */
@media (max-width: 767px) {
  .responsive.columns-6,
  .responsive.columns-5,
  .responsive.columns-4,
  .responsive.columns-3,
  .responsive.columns-2 {
    grid-template-columns: 1fr;
  }
  
  .gap-2xl,
  .gap-xl,
  .gap-lg {
    gap: var(--spacing-4);
  }
  
  .gap-md {
    gap: var(--spacing-3);
  }
}

/* 小屏手机 (最大575px) */
@media (max-width: 575px) {
  .gap-2xl,
  .gap-xl,
  .gap-lg,
  .gap-md {
    gap: var(--spacing-3);
  }
  
  .gap-sm {
    gap: var(--spacing-2);
  }
  
  .gap-xs {
    gap: var(--spacing-1);
  }
}

/* === 特殊布局支持 === */
/* 卡片网格优化 */
.responsive-grid:has(.card),
.responsive-grid:has(.stat-card),
.responsive-grid:has(.anomaly-card) {
  align-items: stretch;
}

/* 仪表板布局优化 */
.responsive-grid:has(.dashboard-widget) {
  grid-auto-rows: minmax(200px, auto);
}

/* 表单布局优化 */
.responsive-grid:has(.form-group),
.responsive-grid:has(.input-group) {
  align-items: start;
}
</style>