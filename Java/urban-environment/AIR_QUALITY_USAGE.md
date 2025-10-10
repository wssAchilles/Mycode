# 🌍 IQAir 空气质量数据查询工具使用指南

## 📋 概述

这是一个专业的Python脚本，用于从IQAir API获取全球城市的实时空气质量数据。该脚本遵循最佳安全实践，具有完善的错误处理机制，并提供友好的用户界面。

## 🚀 快速开始

### 方法1: 使用自动设置脚本（推荐）

#### Windows用户
```bash
# 双击运行或在命令行执行
setup_air_quality.bat
```

#### Linux/Mac用户  
```bash
# 给脚本添加执行权限（仅首次需要）
chmod +x setup_air_quality.sh

# 运行设置脚本
./setup_air_quality.sh
```

### 方法2: 手动设置

#### 1. 安装依赖
```bash
pip install requests
```

#### 2. 设置环境变量

**Windows Command Prompt:**
```cmd
set IQAIR_API_KEY=194adeb6-c17c-4959-91e9-af7af289ef98
python air_quality_checker.py
```

**Windows PowerShell:**
```powershell
$env:IQAIR_API_KEY="194adeb6-c17c-4959-91e9-af7af289ef98"
python air_quality_checker.py
```

**Linux/Mac:**
```bash
export IQAIR_API_KEY="194adeb6-c17c-4959-91e9-af7af289ef98"
python air_quality_checker.py
```

## 📊 功能特性

### ✅ 核心功能
- **实时数据获取**: 从IQAir官方API获取最新空气质量数据
- **多城市支持**: 支持全球主要城市查询
- **完整数据**: AQI、主要污染物、温度、湿度、风速等
- **中文显示**: 污染物名称和健康建议中文化
- **安全管理**: API密钥从环境变量读取，不硬编码

### 🛡️ 安全特性
- **API密钥保护**: 绝不在代码中硬编码敏感信息
- **错误处理**: 完善的网络异常和API错误处理
- **超时机制**: 防止请求长时间挂起
- **输入验证**: 参数类型检查和数据格式验证

### 🎨 用户体验
- **彩色输出**: 使用emoji和颜色区分不同信息
- **详细报告**: 格式化的空气质量报告
- **健康建议**: 基于AQI值的个性化健康建议
- **多语言**: 中英文混合，适合中国用户

## 📈 数据说明

### AQI等级划分
| AQI范围 | 等级 | 颜色 | 健康影响 |
|---------|------|------|----------|
| 0-50 | 优秀 | 🟢 | 空气质量令人满意，基本无空气污染 |
| 51-100 | 中等 | 🟡 | 空气质量可接受，但某些污染物可能对极少数异常敏感人群健康有较弱影响 |
| 101-150 | 对敏感人群不健康 | 🟠 | 敏感人群症状进一步加剧，可能对健康人群心脏、呼吸系统有影响 |
| 151-200 | 不健康 | 🔴 | 进一步加剧易感人群症状，可能对健康人群产生影响 |
| 201-300 | 非常不健康 | 🟣 | 健康警告：每个人都可能会遇到更严重的健康影响 |
| 300+ | 危险 | 🟤 | 健康预警：所有人都可能遇到严重的健康影响 |

### 主要污染物说明
- **PM2.5**: 细颗粒物，直径≤2.5微米
- **PM10**: 可吸入颗粒物，直径≤10微米  
- **O3**: 臭氧
- **NO2**: 二氧化氮
- **SO2**: 二氧化硫
- **CO**: 一氧化碳

## 🔧 自定义查询

### 修改查询城市
编辑 `air_quality_checker.py` 文件中的 `test_cities` 列表：

```python
test_cities = [
    ("Beijing", "Beijing", "China"),           # 北京
    ("Shanghai", "Shanghai", "China"),         # 上海  
    ("Tokyo", "Tokyo", "Japan"),               # 东京
    ("Seoul", "Seoul", "South Korea"),         # 首尔
    ("New York City", "New York", "USA"),      # 纽约
    ("London", "England", "UK"),               # 伦敦
    ("Paris", "Ile-de-France", "France"),      # 巴黎
    ("Sydney", "New South Wales", "Australia") # 悉尼
]
```

### 单独查询特定城市
```python
# 在脚本末尾添加
result = get_city_air_quality("Beijing", "Beijing", "China")
if result:
    print_air_quality_report(result)
```

## 🌟 输出示例

```
🌟 IQAir 空气质量数据查询工具
========================================
🔍 正在查询示例城市的空气质量数据...

📍 查询: Tokyo, Tokyo, Japan
🔍 正在查询 Tokyo, Tokyo, Japan 的空气质量数据...

============================================================
🌍 Tokyo, Tokyo, Japan 实时空气质量报告
============================================================
🟡 AQI (美标): 65 - 中等
🏭 主要污染物: PM2.5
🌡️  温度: 18°C
💧 湿度: 75%
💨 风速: 2.5 m/s
⏰ 数据更新时间: 2025-10-09T11:00:00.000Z
📊 查询时间: 2025-10-09 19:25:30
============================================================
💛 空气质量尚可，敏感人群应减少户外活动

------------------------------------------------------------

📈 查询完成！成功获取 4/4 个城市的数据

🎉 感谢使用IQAir空气质量查询工具！
```

## ❗ 常见问题

### Q: 显示"未设置环境变量"错误
**A**: 请确保正确设置了环境变量 `IQAIR_API_KEY`
```bash
# Windows
set IQAIR_API_KEY=194adeb6-c17c-4959-91e9-af7af289ef98

# Linux/Mac
export IQAIR_API_KEY="194adeb6-c17c-4959-91e9-af7af289ef98"
```

### Q: 显示"网络连接错误"
**A**: 检查网络连接和防火墙设置
- 确保能够访问 `https://api.airvisual.com`
- 检查代理设置
- 尝试使用VPN

### Q: 显示"API密钥无效"
**A**: 检查API密钥是否正确
- 确认API密钥拼写正确
- 检查API密钥是否过期
- 登录IQAir账号确认密钥状态

### Q: 找不到城市数据
**A**: 检查城市名称格式
- 使用英文城市名称
- 确认州/省名称正确
- 参考IQAir官网的城市列表

### Q: Python未安装或版本过低
**A**: 安装Python 3.x
- 从 https://www.python.org/downloads/ 下载
- 确保添加到系统PATH
- 使用 `python --version` 验证安装

## 🔗 相关链接

- **IQAir官网**: https://www.iqair.com/
- **IQAir API文档**: https://www.iqair.com/air-pollution-data-api
- **Python Requests文档**: https://docs.python-requests.org/
- **环境变量设置指南**: https://www.java67.com/2019/08/how-to-set-environment-variable-in-windows-linux-mac.html

## 📞 技术支持

如遇到问题，请检查：
1. 网络连接状态
2. API密钥配置
3. Python环境和依赖库
4. 城市名称格式

**祝您使用愉快！** 🎉
