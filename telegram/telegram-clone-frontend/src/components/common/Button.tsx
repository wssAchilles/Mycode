import React from 'react';
import Ripple from './Ripple';
import './Button.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'translucent';
    size?: 'sm' | 'md' | 'lg';
    fullWidth?: boolean;
    withRipple?: boolean;
    isLoading?: boolean;
    startIcon?: React.ReactNode;
    endIcon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
    children,
    className = '',
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    withRipple = true,
    isLoading = false,
    startIcon,
    endIcon,
    disabled,
    ...props
}) => {
    // Determine ripple color based on variant
    const getRippleColor = () => {
        switch (variant) {
            case 'primary': return 'rgba(255, 255, 255, 0.2)'; // White ripple for filled button
            case 'danger': return 'rgba(255, 255, 255, 0.2)';
            default: return 'var(--tg-text-link)'; // Blue ripple for ghost/text buttons implies ink effect
        }
    };

    return (
        <button
            className={`tg-btn tg-btn-${variant} tg-btn-${size} ${fullWidth ? 'tg-btn-full' : ''} ${isLoading ? 'tg-btn-loading' : ''} ${className}`}
            disabled={disabled || isLoading}
            {...props}
        >
            {withRipple && !disabled && !isLoading && <Ripple color={getRippleColor()} />}

            <div className="tg-btn-content">
                {isLoading && <span className="tg-spinner"></span>}
                {!isLoading && startIcon && <span className="tg-btn-icon-start">{startIcon}</span>}
                <span className="tg-btn-label">{children}</span>
                {!isLoading && endIcon && <span className="tg-btn-icon-end">{endIcon}</span>}
            </div>
        </button>
    );
};

export default React.memo(Button);
