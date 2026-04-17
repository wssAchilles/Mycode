# ML Platform 产品说明书编译指南

## 文档结构

```
产品说明书/
├── main.tex              # 主文档
├── thusetup.tex          # 配置文件
├── thuthesis.cls         # 文档类
├── frontmatter/
│   └── abstract.tex      # 摘要
├── mainmatter/
│   ├── chapter1.tex      # 第1章: ML Platform 简介
│   ├── chapter2.tex      # 第2章: 快速入门
│   ├── chapter3.tex      # 第3章: 安装与初始配置
│   ├── chapter4.tex      # 第4章: 基础概念与架构
│   ├── chapter5.tex      # 第5章: 用户指南
│   ├── chapter6.tex      # 第6章: 高级功能
│   └── chapter7.tex      # 第7章: 故障排除与支持
├── ref/
│   └── refs.bib          # 参考文献数据库
└── figures/              # 图片目录

```

## 编译方法

### 方法一: 使用 XeLaTeX + BibTeX (推荐)

```bash
# 第一次编译
xelatex main.tex

# 编译参考文献
bibtex main

# 再次编译以更新引用
xelatex main.tex
xelatex main.tex
```

### 方法二: 使用 latexmk 自动化编译

```bash
latexmk -xelatex -synctex=1 -interaction=nonstopmode main.tex
```

### 方法三: 使用 VS Code + LaTeX Workshop

1. 安装 LaTeX Workshop 扩展
2. 打开 main.tex
3. 按 `Ctrl+Alt+B` 或点击右上角的绿色播放按钮
4. PDF 会自动生成并在侧边栏显示

## 编译要求

### 必需软件

- **TeX 发行版**: 
  - Windows: TeX Live 2023+ 或 MiKTeX
  - macOS: MacTeX 2023+
  - Linux: TeX Live 2023+

- **中文字体**: 
  - Windows: 系统自带宋体、黑体等
  - macOS: 系统自带中文字体
  - Linux: 需安装 fonts-wqy-zenhei 等中文字体包

### 可选软件

- **编辑器**: 
  - VS Code + LaTeX Workshop (推荐)
  - TeXstudio
  - Overleaf (在线)

## 常见问题

### 1. 编译错误: "Font not found"

**原因**: 缺少中文字体或字体配置错误

**解决方案**:
- Windows: 确保系统已安装宋体、黑体
- macOS/Linux: 修改 `thusetup.tex` 中的字体设置为系统可用字体

### 2. 参考文献未显示

**原因**: 未运行 BibTeX

**解决方案**:
```bash
xelatex main.tex
bibtex main
xelatex main.tex
xelatex main.tex
```

### 3. 图片无法显示

**原因**: 图片路径错误或图片不存在

**解决方案**:
- 检查 `figures/` 目录是否存在所需图片
- 暂时使用 `example-image` 占位符

### 4. 编译速度慢

**原因**: TikZ 图形渲染或大量图片

**解决方案**:
- 使用 `-shell-escape` 选项启用外部缓存
- 暂时注释掉复杂的 TikZ 图形进行快速预览

## 输出文件

编译成功后会生成以下文件:

- `main.pdf` - **最终的产品说明书PDF文档**
- `main.aux` - 辅助文件
- `main.bbl` - BibTeX生成的参考文献
- `main.blg` - BibTeX日志
- `main.log` - 编译日志
- `main.toc` - 目录
- `main.lof` - 插图清单
- `main.lot` - 表格清单

## 清理临时文件

```bash
# Linux/macOS
rm -f *.aux *.bbl *.blg *.log *.out *.toc *.lof *.lot *.synctex.gz

# Windows PowerShell
Remove-Item *.aux,*.bbl,*.blg,*.log,*.out,*.toc,*.lof,*.lot,*.synctex.gz
```

或使用:
```bash
latexmk -c  # 清理辅助文件
latexmk -C  # 清理所有生成文件(包括PDF)
```

## 在线编译

如果本地编译遇到问题,可以使用在线 LaTeX 编辑器:

1. **Overleaf**: https://www.overleaf.com
   - 上传整个 `产品说明书/` 文件夹
   - 选择编译器为 XeLaTeX
   - 点击 "Recompile" 按钮

2. **ShareLaTeX**: https://www.sharelatex.com (已与Overleaf合并)

## 定制化修改

### 修改文档样式

编辑 `thusetup.tex` 文件可以修改:
- 页边距
- 字体大小
- 行距
- 章节标题格式

### 添加新章节

1. 在 `mainmatter/` 目录创建新的 `.tex` 文件
2. 在 `main.tex` 中添加 `\input{mainmatter/新章节}`

### 添加图片

1. 将图片放入 `figures/` 目录
2. 在文档中使用:
```latex
\begin{figure}[H]
\centering
\includegraphics[width=0.8\textwidth]{图片文件名}
\caption{图片标题}
\label{fig:图片标签}
\end{figure}
```

### 添加参考文献

在 `ref/refs.bib` 文件中添加新的条目:
```bibtex
@article{标识符,
  title={文章标题},
  author={作者},
  journal={期刊名称},
  year={年份},
  url={网址}
}
```

然后在正文中引用: `\cite{标识符}`

## 技术支持

如有问题,请:
1. 检查编译日志 `main.log` 中的错误信息
2. 查看 LaTeX Stack Exchange: https://tex.stackexchange.com
3. 提交 Issue: https://github.com/wssAchilles/Mycode/issues

## 许可证

本文档遵循 MIT 开源协议,可自由修改和分发。

---

**最后更新**: 2025年10月13日
**文档版本**: 2.0
