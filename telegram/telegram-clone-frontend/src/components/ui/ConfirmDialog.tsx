import React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { AlertTriangle } from 'lucide-react';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * 统一非阻塞确认弹窗（替代浏览器原生 window.confirm / alert）
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) {
          onCancel();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="tg-confirm-overlay" />
        <DialogPrimitive.Content
          className="tg-confirm-dialog"
          onEscapeKeyDown={(event) => {
            if (loading) event.preventDefault();
          }}
        >
          <div className="tg-confirm-header">
            {variant === 'danger' && (
              <span className="tg-confirm-icon" aria-hidden="true">
                <AlertTriangle size={18} />
              </span>
            )}
            <DialogPrimitive.Title className="tg-confirm-title">{title}</DialogPrimitive.Title>
          </div>
          {description && (
            <DialogPrimitive.Description className="tg-confirm-desc">
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="tg-confirm-actions">
            <button
              type="button"
              className="tg-confirm-btn tg-confirm-btn--cancel"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelText}
            </button>
            <button
              type="button"
              className={`tg-confirm-btn ${
                variant === 'danger' ? 'tg-confirm-btn--danger' : 'tg-confirm-btn--primary'
              }`}
              onClick={() => void onConfirm()}
              disabled={loading}
            >
              {loading ? '处理中...' : confirmText}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ConfirmDialog;
