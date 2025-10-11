# 📚 文档部署指南

本项目提供多种文档部署方案,根据你的需求选择最适合的方式。

## 🎯 方案对比

| 方案 | 优势 | 劣势 | 适用场景 |
|------|------|------|---------|
| **VitePress + GitHub Pages** | 免费、自动部署、SEO友好 | 需要Node.js环境 | ✅ 推荐 |
| **Firebase Hosting** | 与项目集成、国内访问较快 | 需要Firebase账号 | 已有Firebase项目 |
| **LaTeX → PDF** | 专业排版、适合打印 | 不利于在线阅读 | 学术论文、打印版 |
| **Docsify** | 极简、无需构建 | 功能较少 | 快速启动 |

## 🚀 推荐方案: VitePress + GitHub Pages

### 优势
- ✅ 完全免费
- ✅ 自动部署(推送即发布)
- ✅ 支持全文搜索
- ✅ 响应式设计
- ✅ 暗黑模式
- ✅ SEO优化
- ✅ 版本控制

### 快速开始

#### 1. 安装依赖

```powershell
cd docs
npm install
```

#### 2. 本地开发

```powershell
npm run docs:dev
```

访问 http://localhost:5173 预览文档

#### 3. 构建文档

```powershell
npm run docs:build
```

#### 4. 启用GitHub Pages

1. 进入GitHub仓库设置
2. 找到 Pages 选项
3. Source 选择 "GitHub Actions"
4. 推送代码到main分支即可自动部署

```powershell
git add .
git commit -m "docs: add documentation site"
git push origin main
```

#### 5. 访问文档

部署完成后,访问:
```
https://wssAchilles.github.io/ml_platform/
```

## 📝 文档编写指南

### 目录结构

```text
docs/
├── .vitepress/
│   ├── config.js          # 配置文件
│   └── theme/             # 自定义主题(可选)
├── guide/
│   ├── getting-started.md # 快速开始
│   ├── features.md        # 功能介绍
│   └── faq.md             # 常见问题
├── api/
│   ├── index.md           # API概述
│   ├── algorithms.md      # 算法API
│   ├── os-simulator.md    # OS模拟器API
│   └── ml-service.md      # ML服务API
├── development/
│   ├── architecture.md    # 架构设计
│   ├── contributing.md    # 贡献指南
│   ├── code-style.md      # 代码规范
│   └── release.md         # 发布流程
└── README.md              # 首页
```

### Markdown增强功能

VitePress支持的特殊语法:

#### 1. 提示框

```markdown
::: tip 提示
这是一个提示
:::

::: warning 警告
这是一个警告
:::

::: danger 危险
这是一个危险提示
:::

::: info 信息
这是一条信息
:::
```

#### 2. 代码组

```markdown
::: code-group
```dart [Flutter]
void main() {
  print('Hello Flutter!');
}
\```

```python [Python]
def main():
    print("Hello Python!")
\```
:::
```

#### 3. 自定义容器

```markdown
::: details 点击查看详情
这是隐藏的详细内容
:::
```

## 🔄 方案二: Firebase Hosting

如果你想将文档和Web应用部署在同一域名下:

### 配置firebase.json

```json
{
  "hosting": [
    {
      "target": "app",
      "public": "build/web",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [
        {
          "source": "**",
          "destination": "/index.html"
        }
      ]
    },
    {
      "target": "docs",
      "public": "docs/.vitepress/dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
    }
  ]
}
```

### .firebaserc配置

```json
{
  "projects": {
    "default": "408-experiment-platform"
  },
  "targets": {
    "408-experiment-platform": {
      "hosting": {
        "app": ["ml-platform-app"],
        "docs": ["ml-platform-docs"]
      }
    }
  }
}
```

### 部署

```powershell
# 构建文档
cd docs
npm run docs:build

# 部署到Firebase
cd ..
firebase deploy --only hosting:docs
```

访问: https://ml-platform-docs.web.app

## 📄 方案三: LaTeX → PDF

如果需要学术论文格式的文档:

### 1. 创建LaTeX项目

```powershell
mkdir paper
cd paper
```

### 2. 创建main.tex

```latex
\documentclass[12pt,a4paper]{article}
\usepackage[UTF8]{ctex}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage{listings}
\usepackage{xcolor}

\title{ML Platform: 计算机408可视化学习平台}
\author{许子祺}
\date{\today}

\begin{document}

\maketitle
\tableofcontents
\newpage

\section{项目概述}
ML Platform是一个面向计算机考研的可视化学习平台...

\section{系统设计}
\subsection{整体架构}
系统采用Flutter + Firebase的云端架构...

\section{核心功能}
\subsection{算法可视化}
支持10+种排序算法的动态可视化...

\end{document}
```

### 3. 编译PDF

使用在线编辑器(推荐):
- [Overleaf](https://www.overleaf.com/) - 最流行的在线LaTeX编辑器
- [TeXPage](https://www.texpage.com/) - 国内可访问

本地编译:
```powershell
# 安装MiKTeX (Windows)
# 然后运行
xelatex main.tex
```

### 4. 上传到GitHub Release

```powershell
# 标记版本
git tag v1.0.0

# 推送标签
git push origin v1.0.0

# 在GitHub上创建Release并上传PDF
```

## 🎨 方案四: Docsify (最轻量)

无需构建步骤,直接渲染Markdown:

### 1. 初始化

```powershell
npm i docsify-cli -g
docsify init ./docs
```

### 2. 本地预览

```powershell
docsify serve docs
```

### 3. 部署

直接推送到GitHub,在Pages设置中选择docs目录即可。

## 📊 方案选择建议

### 选择VitePress,如果你:
- ✅ 想要现代化的文档站点
- ✅ 需要全文搜索功能
- ✅ 希望自动化部署
- ✅ 关注SEO和访问体验

### 选择Firebase Hosting,如果你:
- ✅ 已经在使用Firebase
- ✅ 想要统一的域名管理
- ✅ 国内用户访问为主

### 选择LaTeX,如果你:
- ✅ 需要打印版文档
- ✅ 用于学术论文
- ✅ 需要严格的排版控制

### 选择Docsify,如果你:
- ✅ 想要最快速的启动
- ✅ 不想配置构建工具
- ✅ 文档结构简单

## 🔗 相关资源

- [VitePress官方文档](https://vitepress.dev/)
- [Firebase Hosting文档](https://firebase.google.com/docs/hosting)
- [GitHub Pages文档](https://docs.github.com/pages)
- [Docsify文档](https://docsify.js.org/)
- [Overleaf教程](https://www.overleaf.com/learn)

## 💡 最佳实践

1. **版本控制**: 文档和代码一起管理,保持同步
2. **自动化**: 使用GitHub Actions自动部署
3. **多语言**: 如果面向国际用户,考虑i18n
4. **SEO优化**: 配置meta标签和sitemap
5. **持续更新**: 随着功能迭代更新文档

## 🎯 下一步

我已经为你创建了完整的VitePress文档框架,包括:

- ✅ 文档目录结构
- ✅ VitePress配置
- ✅ GitHub Actions自动部署
- ✅ 示例文档页面

现在你可以:

1. 运行 `cd docs && npm install` 安装依赖
2. 运行 `npm run docs:dev` 预览文档
3. 编辑Markdown文件添加内容
4. 推送到GitHub自动部署

**推荐**: 使用VitePress + GitHub Pages方案,免费、强大、易维护!
