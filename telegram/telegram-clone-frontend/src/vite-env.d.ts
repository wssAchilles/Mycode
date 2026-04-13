/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// 扩展 Vite 环境变量类型定义
interface ImportMetaEnv {
    // 后端基础地址
    readonly VITE_API_BASE_URL: string;
    readonly VITE_SOCKET_URL: string;
    readonly VITE_SHARE_BASE_URL: string;

    // ML 服务端点 (云端 Render)
    readonly VITE_ANN_ENDPOINT: string;
    readonly VITE_PHOENIX_ENDPOINT: string;
    readonly VITE_VF_ENDPOINT: string;
    readonly VITE_VF_ENDPOINT_V2: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
