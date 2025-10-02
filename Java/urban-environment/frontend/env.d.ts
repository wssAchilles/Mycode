/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY: string
  readonly BASE_URL: string
  // 可以添加更多环境变量
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
