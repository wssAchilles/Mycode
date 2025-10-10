// API配置文件
export const API_CONFIG = {
  // 和风天气API配置
  QWEATHER: {
    BASE_URL: 'https://devapi.qweather.com/v7',
    API_KEY: process.env.VITE_QWEATHER_API_KEY || 'your-qweather-api-key', // 从环境变量获取
  },
  
  // World Air Quality Index API配置  
  WAQI: {
    BASE_URL: 'https://api.waqi.info',
    TOKEN: process.env.VITE_WAQI_TOKEN || 'demo', // 从环境变量获取
  },
  
  // OpenWeatherMap API配置
  OPENWEATHER: {
    BASE_URL: 'https://api.openweathermap.org/data/2.5',
    API_KEY: process.env.VITE_OPENWEATHER_API_KEY || 'your-openweather-api-key',
  },
  
  // 中国环保部API配置
  CHINA_EPA: {
    BASE_URL: 'http://www.pm25.in/api/querys',
    API_KEY: process.env.VITE_CHINA_EPA_KEY || 'your-china-epa-key',
  }
}

// API使用说明
export const API_INSTRUCTIONS = {
  setup: `
## 获取真实API密钥的方法：

### 1. 和风天气API (推荐)
- 网站: https://dev.qweather.com/
- 注册账号并创建应用
- 免费版每天1000次调用
- 支持中国城市空气质量数据

### 2. World Air Quality Index
- 网站: https://aqicn.org/api/
- 免费版用 token: "demo" (有限制)
- 付费版支持更多功能

### 3. OpenWeatherMap
- 网站: https://openweathermap.org/api
- 免费版每月1000次调用
- 全球天气和空气质量数据

### 4. 环境变量设置
在项目根目录创建 .env 文件：
\`\`\`
VITE_QWEATHER_API_KEY=your-actual-api-key
VITE_WAQI_TOKEN=your-actual-token
VITE_OPENWEATHER_API_KEY=your-actual-api-key
\`\`\`
  `,
  fallback: `
如果没有API密钥，系统会自动使用模拟数据：
- 基于真实城市的环境数据模式
- 时间相关的数据变化
- 天气影响的数据波动
- 城市特征的基础数值
  `
}
