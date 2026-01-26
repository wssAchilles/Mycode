# 🚀 在 Google Colab Pro 上训练模型指南

既然您已经开通了 **Google Colab Pro**，您可以利用其强大的 GPU (如 A100/V100) 来加速您的机器学习模型训练。

我已经为您准备了一个专用的 Jupyter Notebook 文件：`train_on_colab.ipynb`。

请按照以下步骤操作：

## 第一步：上传代码到 Google Drive (极速版)

**⚠️ 关键提示：您不需要上传本地庞大的 `data` 或 `models` 文件夹！**
因为我们的 Colab 脚本会自动在云端下载最新的 MIND-Large 数据集。上传本地旧数据只会白白浪费时间。

1. 打开您的 [Google Drive](https://drive.google.com/)。
2. 创建一个新的文件夹（例如命名为 `telegram`）。
3. **只上传以下文件/文件夹** (不要直接拖拽整个 `ml-services` 文件夹)：
   *   ✅ `scripts/` (文件夹)
   *   ✅ `train_on_colab.ipynb`
   *   ✅ `requirements.txt`
   *   ❌ **跳过** `data/` (太大，Colab 会自己下载)
   *   ❌ **跳过** `models/` (太大，除非您想继续之前的训练)

## 第二步：配置 Kaggle API (获取最大数据集)

为了下载大规模的 **MIND-Large** 数据集，我们需要使用您的 Kaggle 账号：

1. 登录 [Kaggle](https://www.kaggle.com/)。
2. 点击右上角头像 -> **Settings**。
3. 向下滚动到 **API** 部分，点击 **Create New Token**。
4. 这会下载一个名为 `kaggle.json` 的文件。
5. **将在上一步下载的 `kaggle.json` 也上传到 Google Drive 的 `telegram/ml-services` 文件夹中**。
   - 您的 Drive 最终结构应包含：
     ```text
     /telegram/ml-services/
       ├── scripts/
       ├── train_on_colab.ipynb
       ├── requirements.txt
       └── kaggle.json  <-- 必须有这个文件
     ```
     ```text
     /My Drive
       /telegram
         /ml-services
           /scripts          <-- 必须有
           train_on_colab.ipynb
           requirements.txt
           (空) data         <-- 脚本运行后会自动生成
           (空) models       <-- 脚本运行后会自动生成
     ```

## 第二步：在 Colab 中打开 Notebook

1. 在 Google Drive 中找到 `train_on_colab.ipynb` 文件。
2. 右键点击 -> 选择 **打开方式 (Open with)** -> **Google Colab**。
3. 如果没有看到 Colab 选项，请点击 "关联更多应用" 并搜索 "Colaboratory" 安装。

## 第三步：配置 Colab 运行时 (重要!)

为了利用 Pro 服务的算力，您需要手动开启 GPU：

1. 在 Colab 顶部菜单栏点击 **代码执行程序 (Runtime)** -> **更改运行时类型 (Change runtime type)**。
2. 在 **硬件加速器 (Hardware accelerator)** 下，选择 **GPU**。
3. 作为 Pro 用户，您通常可以选择 **A100 GPU** 或 **V100 GPU**（如果可用），或者选择 **高 RAM (High-RAM)** 选项。
4. 点击 **保存 (Save)**。

## 第四步：运行训练

按照 Notebook 中的单元格顺序执行：

1. **Mount Google Drive**: 这一步会要求您授权访问 Drive。这是必须的，这样您的训练数据和训练好的模型才能保存下来，不会因为 Colab 会话结束而丢失。
   - **⚠️ 注意**: 确保 Notebook 中定义的路径 `PROJECT_PATH` 与您实际上传的路径一致。如果您的路径不同，请修改代码中的路径。
2. **Install Requirements**: 安装必要的 Python 库。
3. **Download Data**: 脚本会自动下载 Microsoft MIND 数据集 (Small 版本)。
4. **Preprocess**: 处理数据，生成训练用的 `.pkl` 文件。
5. **Start Training**: 开始训练 Phoenix 模型。

## 常见问题

- **路径错误**: 如果提示 `FileNotFoundError`，请仔细检查 `PROJECT_PATH` 是否正确。您可以在 Colab 左侧的文件浏览器中查看 Drive 挂载后的实际路径。
- **断开连接**: Colab Pro 虽然支持较长时间运行，但如果是超大规模训练（几十个小时），建议使用后台执行或定期检查。Notebook 代码中已经包含了保存 checkpoint 的逻辑，即使中断也可以从断点（或者手动加载最后保存的模型）继续。
