/**
 * 群组预设头像、简介场景模板与人数上限档位配置
 * 采用与 Canvas 离屏导出一致的 24x24 矢量路径，确保界面预览与云端持久化图片像素一致
 */

export interface GroupAvatarPreset {
    id: string;
    label: string;
    gradientStart: string;
    gradientEnd: string;
    strokePaths: readonly string[];
}

export const GROUP_AVATAR_PRESETS: readonly GroupAvatarPreset[] = [
    {
        id: 'tech',
        label: '技术研发',
        gradientStart: '#2563EB',
        gradientEnd: '#06B6D4',
        strokePaths: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6', 'M14.5 4l-5 16'],
    },
    {
        id: 'project',
        label: '项目协作',
        gradientStart: '#4F46E5',
        gradientEnd: '#8B5CF6',
        strokePaths: [
            'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z',
            'M12 12l8-4.5',
            'M12 12v9',
            'M12 12L4 7.5',
        ],
    },
    {
        id: 'design',
        label: '设计创意',
        gradientStart: '#F43F5E',
        gradientEnd: '#FB923C',
        strokePaths: ['M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z'],
    },
    {
        id: 'study',
        label: '学习成长',
        gradientStart: '#059669',
        gradientEnd: '#14B8A6',
        strokePaths: [
            'M2 5.5A2.5 2.5 0 0 1 4.5 3H11v17H4.5A2.5 2.5 0 0 0 2 21.5v-16z',
            'M22 5.5A2.5 2.5 0 0 0 19.5 3H13v17h6.5a2.5 2.5 0 0 1 2.5 1.5v-16z',
        ],
    },
    {
        id: 'announce',
        label: '通知公告',
        gradientStart: '#D97706',
        gradientEnd: '#F59E0B',
        strokePaths: [
            'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9',
            'M13.73 21a2 2 0 0 1-3.46 0',
        ],
    },
    {
        id: 'community',
        label: '兴趣社群',
        gradientStart: '#0284C7',
        gradientEnd: '#38BDF8',
        strokePaths: [
            'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
            'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
            'M22 21v-2a4 4 0 0 0-3-3.87',
            'M16 3.13a4 4 0 0 1 0 7.75',
        ],
    },
    {
        id: 'finance',
        label: '商务运营',
        gradientStart: '#1E293B',
        gradientEnd: '#475569',
        strokePaths: ['M4 20h16', 'M7 16v-4', 'M12 16V7', 'M17 16v-7'],
    },
    {
        id: 'casual',
        label: '日常闲聊',
        gradientStart: '#EC4899',
        gradientEnd: '#A855F7',
        strokePaths: [
            'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
        ],
    },
];

export const GROUP_DESCRIPTION_TEMPLATES = [
    {
        label: '项目协作',
        content: '用于同步项目进度、需求评审与关键决策归档，重要结论请及时 @相关负责人。',
    },
    {
        label: '技术讨论',
        content: '欢迎围绕架构设计、代码规范与故障复盘展开深入讨论，提问请附关键上下文。',
    },
    {
        label: '通知公告',
        content: '本群用于发布重要日程、版本变更与活动通知，请留意置顶与未读消息。',
    },
] as const;

export const GROUP_MEMBER_LIMIT_PRESETS = [50, 200, 500, 1000] as const;

const AVATAR_EXPORT_SIZE = 512;

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    });
}

/**
 * 将选中的主题预设群徽实时渲染为 512x512 高清图片文件，以便统一走持久化上传通道
 */
export async function renderGroupAvatarPresetToFile(preset: GroupAvatarPreset): Promise<File> {
    if (typeof document === 'undefined') {
        throw new Error('当前环境不支持预设头像渲染');
    }

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EXPORT_SIZE;
    canvas.height = AVATAR_EXPORT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('无法初始化头像绘制上下文');
    }

    // 1. 绘制对角线线性渐变背景
    const bgGradient = ctx.createLinearGradient(0, 0, AVATAR_EXPORT_SIZE, AVATAR_EXPORT_SIZE);
    bgGradient.addColorStop(0, preset.gradientStart);
    bgGradient.addColorStop(1, preset.gradientEnd);
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, AVATAR_EXPORT_SIZE, AVATAR_EXPORT_SIZE);

    // 2. 叠加顶部柔和径向高光，增强质感层次
    const highlight = ctx.createRadialGradient(
        AVATAR_EXPORT_SIZE * 0.28,
        AVATAR_EXPORT_SIZE * 0.22,
        16,
        AVATAR_EXPORT_SIZE * 0.5,
        AVATAR_EXPORT_SIZE * 0.5,
        AVATAR_EXPORT_SIZE * 0.72,
    );
    highlight.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = highlight;
    ctx.fillRect(0, 0, AVATAR_EXPORT_SIZE, AVATAR_EXPORT_SIZE);

    // 3. 将 24x24 矢量图标居中放大绘制
    const iconBoxSize = AVATAR_EXPORT_SIZE * 0.52;
    const scale = iconBoxSize / 24;
    const offset = (AVATAR_EXPORT_SIZE - iconBoxSize) / 2;

    ctx.save();
    ctx.translate(offset, offset);
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (typeof Path2D !== 'undefined') {
        for (const pathData of preset.strokePaths) {
            ctx.stroke(new Path2D(pathData));
        }
    } else {
        // 极端旧浏览器降级：绘制中心双圆环徽章
        ctx.beginPath();
        ctx.arc(12, 12, 7.5, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();

    const webpBlob = await canvasToBlob(canvas, 'image/webp', 0.92);
    const outputBlob =
        webpBlob && webpBlob.type === 'image/webp'
            ? webpBlob
            : await canvasToBlob(canvas, 'image/png', 1);

    if (!outputBlob) {
        throw new Error('生成预设头像图片失败');
    }

    const ext = outputBlob.type === 'image/webp' ? 'webp' : 'png';
    return new File([outputBlob], `group-preset-${preset.id}.${ext}`, {
        type: outputBlob.type,
        lastModified: Date.now(),
    });
}
