/**
 * FileTypeIcon - 文件类型 SVG 图标组件
 * 遵循 UI/UX Pro Max Skill: 使用 SVG 图标，不使用 emoji
 */
import React from 'react';

export type FileIconType = 'pdf' | 'doc' | 'excel' | 'ppt' | 'audio' | 'video' | 'archive' | 'text' | 'default';

interface FileTypeIconProps {
    type: FileIconType;
    size?: number;
    className?: string;
}

/**
 * 根据 MIME 类型或文件名判断图标类型
 */
export const getFileIconType = (mimeType?: string, fileName?: string): FileIconType => {
    if (mimeType?.includes('pdf') || fileName?.endsWith('.pdf')) return 'pdf';
    if (mimeType?.includes('word') || fileName?.match(/\.(doc|docx)$/i)) return 'doc';
    if (mimeType?.includes('excel') || fileName?.match(/\.(xls|xlsx)$/i)) return 'excel';
    if (mimeType?.includes('powerpoint') || fileName?.match(/\.(ppt|pptx)$/i)) return 'ppt';
    if (mimeType?.includes('audio') || fileName?.match(/\.(mp3|wav|flac|aac)$/i)) return 'audio';
    if (mimeType?.includes('video') || fileName?.match(/\.(mp4|avi|mov|mkv)$/i)) return 'video';
    if (mimeType?.includes('zip') || fileName?.match(/\.(zip|rar|7z)$/i)) return 'archive';
    if (mimeType?.includes('text') || fileName?.endsWith('.txt')) return 'text';
    return 'default';
};

export const FileTypeIcon: React.FC<FileTypeIconProps> = ({ type, size = 24, className = '' }) => {
    const baseClass = `inline-flex items-center justify-center ${className}`;

    switch (type) {
        case 'pdf':
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#E53935" />
                        <text x="12" y="16" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">PDF</text>
                    </svg>
                </span>
            );

        case 'doc':
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#2196F3" />
                        <path d="M8 8H16M8 12H16M8 16H13" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </span>
            );

        case 'excel':
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#4CAF50" />
                        <path d="M8 8L12 14M12 8L8 14M14 10H18M14 14H17" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </span>
            );

        case 'ppt':
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#FF5722" />
                        <text x="12" y="16" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">PPT</text>
                    </svg>
                </span>
            );

        case 'audio':
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#9C27B0" />
                        <path d="M12 7V15M12 15C12 16.1 11.1 17 10 17C8.9 17 8 16.1 8 15C8 13.9 8.9 13 10 13C10.7 13 11.4 13.4 11.7 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M9 9L12 8V12" stroke="white" strokeWidth="1" strokeLinecap="round" />
                    </svg>
                </span>
            );

        case 'video':
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#673AB7" />
                        <path d="M10 9L16 12L10 15V9Z" fill="white" />
                    </svg>
                </span>
            );

        case 'archive':
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#795548" />
                        <rect x="10" y="5" width="4" height="2" fill="white" />
                        <rect x="10" y="8" width="4" height="2" fill="white" />
                        <rect x="10" y="11" width="4" height="2" fill="white" />
                        <rect x="9" y="14" width="6" height="4" rx="1" stroke="white" strokeWidth="1" />
                    </svg>
                </span>
            );

        case 'text':
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#607D8B" />
                        <path d="M8 8H16M8 12H16M8 16H12" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </span>
            );

        default:
            return (
                <span className={baseClass}>
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="2" width="16" height="20" rx="2" fill="#9E9E9E" />
                        <path d="M14 2L20 8H14V2Z" fill="#757575" />
                        <path d="M8 12H16M8 16H13" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </span>
            );
    }
};

export default FileTypeIcon;
