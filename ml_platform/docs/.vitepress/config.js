export default {
  title: 'ML Platform',
  description: '计算机408可视化学习平台 - 让理论变得具象',
  
  // 主题配置
  themeConfig: {
    // 导航栏
    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/getting-started' },
      { text: '功能', link: '/guide/features' },
      { text: 'API', link: '/api/index' },
      { text: '开发', link: '/development/index' },
      { 
        text: '在线Demo', 
        link: 'https://experiment-platform-cc91e.web.app' 
      },
      { 
        text: 'GitHub', 
        link: 'https://github.com/wssAchilles/ml_platform' 
      }
    ],

    // 侧边栏
    sidebar: {
      '/guide/': [
        {
          text: '入门指南',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '核心功能', link: '/guide/features' },
            { text: '文档部署', link: '/guide/deployment' },
            { text: '常见问题', link: '/guide/faq' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API参考',
          items: [
            { text: '概述', link: '/api/index' },
            { text: '算法API', link: '/api/algorithms' },
            { text: 'OS模拟器API', link: '/api/os-simulator' },
            { text: 'ML服务API', link: '/api/ml-service' }
          ]
        }
      ],
      '/development/': [
        {
          text: '开发文档',
          items: [
            { text: '项目架构', link: '/development/architecture' },
            { text: '贡献指南', link: '/development/contributing' },
            { text: '代码规范', link: '/development/code-style' },
            { text: '发布流程', link: '/development/release' }
          ]
        }
      ]
    },

    // 社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/wssAchilles/ml_platform' }
    ],

    // 页脚
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Xu Ziqi'
    },

    // 搜索
    search: {
      provider: 'local'
    },

    // 编辑链接
    editLink: {
      pattern: 'https://github.com/wssAchilles/ml_platform/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页'
    },

    // 最后更新时间
    lastUpdated: {
      text: '最后更新',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    }
  },

  // Markdown配置
  markdown: {
    lineNumbers: true, // 代码块显示行号
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },

  // 站点配置
  base: '/Mycode/', // GitHub仓库名称
  lang: 'zh-CN',
  
  // Head标签
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
    ['meta', { name: 'keywords', content: 'Flutter, 408考研, 算法可视化, 机器学习, 操作系统' }]
  ]
}
