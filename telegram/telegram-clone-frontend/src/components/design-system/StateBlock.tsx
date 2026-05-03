import React from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import './StateBlock.css';

export type StateBlockVariant = 'empty' | 'error' | 'info';

export interface StateBlockProps {
  title: string;
  description?: string;
  variant?: StateBlockVariant;
  compact?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const StateBlock: React.FC<StateBlockProps> = ({
  title,
  description,
  variant = 'empty',
  compact = false,
  actionLabel,
  onAction,
  className,
}) => {
  const Icon = variant === 'error' ? AlertTriangle : Inbox;

  return (
    <div
      className={cn(
        'state-block',
        `state-block--${variant}`,
        compact && 'state-block--compact',
        className,
      )}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <div className="state-block__icon" aria-hidden="true">
        <Icon size={compact ? 16 : 20} />
      </div>
      <div className="state-block__copy">
        <div className="state-block__title">{title}</div>
        {description && <p className="state-block__description">{description}</p>}
      </div>
      {actionLabel && onAction && (
        <button type="button" className="state-block__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default StateBlock;
