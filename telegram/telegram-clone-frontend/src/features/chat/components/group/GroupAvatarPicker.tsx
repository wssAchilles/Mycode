import React, { useEffect, useId, useRef, useState } from 'react';
import { Camera, Check, RotateCcw, Upload } from 'lucide-react';
import { Avatar } from '../../../../components/common';
import { showToast } from '../../../../components/ui/Toast';
import { withApiBase } from '../../../../utils/apiUrl';
import { compressImageForUpload } from '../../../../utils/imageCompress';
import {
    GROUP_AVATAR_PRESETS,
    renderGroupAvatarPresetToFile,
    type GroupAvatarPreset,
} from './groupAvatarPresets';
import './GroupAvatarPicker.css';

export type GroupAvatarSelection =
    | { mode: 'existing'; url: string | null }
    | { mode: 'file'; file: File; previewUrl: string }
    | { mode: 'preset'; preset: GroupAvatarPreset }
    | { mode: 'clear' };

interface GroupAvatarPickerProps {
    groupName: string;
    selection: GroupAvatarSelection;
    onChange: (next: GroupAvatarSelection) => void;
    onError?: (message: string) => void;
    disabled?: boolean;
    inputId?: string;
}

const MAX_AVATAR_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * 将当前头像选择解析为需提交后端的 avatarUrl：
 * - existing 返回 undefined（未修改，保留服务端现有值）
 * - clear 返回 null（清空并还原默认首字母头像）
 * - file 压缩后上传并返回 URL
 * - preset 离屏渲染高清群徽并上传后返回 URL
 */
export async function resolveGroupAvatarUrlForSubmit(
    selection: GroupAvatarSelection,
    uploadFn: (file: File) => Promise<string>,
): Promise<string | null | undefined> {
    if (selection.mode === 'existing') {
        return undefined;
    }
    if (selection.mode === 'clear') {
        return null;
    }
    if (selection.mode === 'file') {
        const compressed = await compressImageForUpload(selection.file, {
            maxWidth: 512,
            maxHeight: 512,
            quality: 0.88,
        });
        return uploadFn(compressed);
    }
    const presetFile = await renderGroupAvatarPresetToFile(selection.preset);
    return uploadFn(presetFile);
}

const GroupAvatarPicker: React.FC<GroupAvatarPickerProps> = ({
    groupName,
    selection,
    onChange,
    onError,
    disabled = false,
    inputId,
}) => {
    const generatedId = useId();
    const resolvedInputId = inputId || `group-avatar-input-${generatedId}`;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const createdPreviewUrlsRef = useRef<Set<string>>(new Set());
    const [isDragging, setIsDragging] = useState(false);

    // 卸载时集中释放组件内部生成的本地预览 URL，防止内存泄漏
    useEffect(() => {
        const createdUrls = createdPreviewUrlsRef.current;
        return () => {
            createdUrls.forEach((url) => URL.revokeObjectURL(url));
            createdUrls.clear();
        };
    }, []);

    // 若从外部被切换到非当前 previewUrl 的状态，及时释放不再展示的旧 URL
    useEffect(() => {
        const activePreviewUrl = selection.mode === 'file' ? selection.previewUrl : null;
        createdPreviewUrlsRef.current.forEach((url) => {
            if (url !== activePreviewUrl) {
                URL.revokeObjectURL(url);
                createdPreviewUrlsRef.current.delete(url);
            }
        });
    }, [selection]);

    const emitError = (message: string) => {
        onError?.(message);
        showToast(message, 'error');
    };

    const handleSelectedFile = async (file: File | undefined) => {
        if (!file || disabled) return;

        if (!ACCEPTED_MIME_TYPES.has(file.type) && !file.type.startsWith('image/')) {
            emitError('请选择 JPG、PNG、WebP 或 GIF 格式的图片');
            return;
        }
        if (file.size > MAX_AVATAR_SIZE_BYTES) {
            emitError('头像图片体积不能超过 10 MB');
            return;
        }

        const processedFile = await compressImageForUpload(file, {
            maxWidth: 512,
            maxHeight: 512,
            quality: 0.88,
        });

        const previewUrl = URL.createObjectURL(processedFile);
        createdPreviewUrlsRef.current.add(previewUrl);
        onChange({
            mode: 'file',
            file: processedFile,
            previewUrl,
        });
    };

    const handleInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // 清空 input 值，确保重复选择同一文件时仍触发 onChange
        event.target.value = '';
        await handleSelectedFile(file);
    };

    const handleDrop = async (event: React.DragEvent<HTMLButtonElement>) => {
        event.preventDefault();
        setIsDragging(false);
        if (disabled) return;
        const file = event.dataTransfer.files?.[0];
        await handleSelectedFile(file);
    };

    const existingUrl = selection.mode === 'existing' ? selection.url : null;
    const hasCustomAvatar =
        selection.mode === 'file' ||
        selection.mode === 'preset' ||
        (selection.mode === 'existing' && Boolean(selection.url));

    const resolvedExistingUrl = existingUrl ? (withApiBase(existingUrl) ?? undefined) : undefined;

    return (
        <div className={`group-avatar-picker ${disabled ? 'is-disabled' : ''}`}>
            <input
                ref={fileInputRef}
                id={resolvedInputId}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="group-avatar-file-input"
                onChange={handleInputChange}
                disabled={disabled}
            />

            <div className="group-avatar-stage">
                <button
                    type="button"
                    className={`group-avatar-preview-btn ${isDragging ? 'is-dragging' : ''}`}
                    onClick={() => !disabled && fileInputRef.current?.click()}
                    onDragOver={(e) => {
                        e.preventDefault();
                        if (!disabled) setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    disabled={disabled}
                    aria-label="选择或拖拽上传自定义群组头像"
                >
                    {selection.mode === 'preset' ? (
                        <span
                            className="group-avatar-preset-preview"
                            style={{
                                background: `linear-gradient(135deg, ${selection.preset.gradientStart}, ${selection.preset.gradientEnd})`,
                            }}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.1"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="group-avatar-preset-svg"
                                aria-hidden="true"
                            >
                                {selection.preset.strokePaths.map((d) => (
                                    <path key={d} d={d} />
                                ))}
                            </svg>
                        </span>
                    ) : selection.mode === 'file' ? (
                        <img
                            src={selection.previewUrl}
                            alt="已选择的群组头像预览"
                            className="group-avatar-preview-img"
                        />
                    ) : selection.mode === 'existing' && resolvedExistingUrl ? (
                        <Avatar src={resolvedExistingUrl} name={groupName || '群组'} size={88} />
                    ) : (
                        <Avatar name={groupName || '群'} size={88} />
                    )}

                    <span className="group-avatar-camera-badge" aria-hidden="true">
                        <Camera size={14} strokeWidth={2.2} />
                    </span>
                </button>

                <div className="group-avatar-actions">
                    <label
                        htmlFor={resolvedInputId}
                        className={`group-avatar-action-btn primary ${disabled ? 'is-disabled' : ''}`}
                    >
                        <Upload size={13} />
                        <span>上传头像</span>
                    </label>
                    {hasCustomAvatar && (
                        <button
                            type="button"
                            className="group-avatar-action-btn ghost"
                            disabled={disabled}
                            onClick={() => onChange({ mode: 'clear' })}
                        >
                            <RotateCcw size={13} />
                            <span>恢复默认</span>
                        </button>
                    )}
                </div>
                <p className="group-avatar-hint">支持点击上传、拖拽图片，或从下方选择主题群徽</p>
            </div>

            <div className="group-avatar-presets" role="group" aria-label="预设群组主题头像">
                {GROUP_AVATAR_PRESETS.map((preset) => {
                    const isSelected = selection.mode === 'preset' && selection.preset.id === preset.id;
                    return (
                        <button
                            key={preset.id}
                            type="button"
                            className={`group-avatar-preset-item ${isSelected ? 'is-selected' : ''}`}
                            style={{
                                background: `linear-gradient(135deg, ${preset.gradientStart}, ${preset.gradientEnd})`,
                            }}
                            disabled={disabled}
                            aria-label={`选择${preset.label}主题头像`}
                            aria-pressed={isSelected}
                            title={preset.label}
                            onClick={() => onChange({ mode: 'preset', preset })}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.1"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                {preset.strokePaths.map((d) => (
                                    <path key={d} d={d} />
                                ))}
                            </svg>
                            {isSelected && (
                                <span className="group-avatar-preset-check" aria-hidden="true">
                                    <Check size={10} strokeWidth={3} />
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default GroupAvatarPicker;
