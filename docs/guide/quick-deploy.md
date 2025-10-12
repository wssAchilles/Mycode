# 🚀 GitHub Pages 部署速查�?

快速参考指�?- 5分钟完成文档部署!

## �?部署前检查清�?

```bash
# 1. 检�?Node.js
node --version  # 应该 >= 16.0.0

# 2. 检�?npm
npm --version

# 3. 检�?Git
git --version

# 4. 检查远程仓�?
git remote -v
```

## 📦 一键部署命�?

```powershell
# 在项目根目录执行

# 1. 安装依赖 (仅首�?
cd docs; npm install; cd ..

# 2. 本地预览
cd docs; npm run docs:dev

# 3. 提交并推�?
git add .
git commit -m "docs: deploy documentation"
git push origin main
```

## ⚙️ GitHub 配置步骤

### 1. 启用 GitHub Pages

1. 仓库 Settings �?Pages
2. Source 选择: **GitHub Actions**
3. Save

### 2. 配置 Actions 权限

1. Settings �?Actions �?General
2. Workflow permissions: **Read and write permissions**
3. 勾�? **Allow GitHub Actions to create and approve pull requests**
4. Save

## 🔗 访问地址

```
https://wssAchilles.github.io/Mycode/
```

## 🐛 快速排�?

| 问题 | 解决方案 |
|------|---------|
| 404 错误 | 检�?`base: '/Mycode/'` 配置 |
| 样式丢失 | 同上,检�?base 配置 |
| Actions 失败 | 查看 Actions 日志,检查权�?|
| 无法访问 | 等待 5-10 分钟,清除缓存 |

## 📁 关键文件

```text
docs/
├── .vitepress/
�?  └── config.js          �?base: '/Mycode/'
├── package.json           �?依赖配置
└── index.md              �?首页

.github/
└── workflows/
    └── deploy-docs.yml    �?自动部署配置
```

## 🔄 更新文档

```powershell
# 1. 编辑 Markdown 文件
code docs/guide/getting-started.md

# 2. 本地预览
cd docs; npm run docs:dev

# 3. 提交推�?
git add docs/
git commit -m "docs: update content"
git push origin main

# 4. 等待 1-3 分钟自动部署
```

## 💡 常用命令

```powershell
# 开发服务器
npm run docs:dev

# 构建生产版本
npm run docs:build

# 预览构建结果
npm run docs:preview

# 查看 Git 状�?
git status

# 查看部署日志
# 访问 GitHub �?Actions 标签�?
```

## 📞 获取帮助

- 📖 [完整部署指南](./deployment.md)
- 🐛 [常见问题](./faq.md)
- 💬 [提交 Issue](https://github.com/wssAchilles/Mycode/issues)

---

**快速开�?*: 复制上面的命�?在终端运行即�? 🎉
