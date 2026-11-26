import React from 'react';
import { Hash, AtSign } from 'lucide-react';
import './ComposerSuggestPopover.css';

export interface ComposerSuggestion {
    id: string;
    kind: 'mention' | 'hashtag';
    label: string;
    insertText: string;
    subtitle?: string;
}

interface ComposerSuggestPopoverProps {
    suggestions: ComposerSuggestion[];
    activeIndex: number;
    onSelect: (item: ComposerSuggestion) => void;
    onHoverIndex: (index: number) => void;
}

export const ComposerSuggestPopover: React.FC<ComposerSuggestPopoverProps> = ({
    suggestions,
    activeIndex,
    onSelect,
    onHoverIndex,
}) => {
    if (suggestions.length === 0) return null;

    return (
        <div className="composer-suggest-popover" role="listbox" aria-label="发帖自动补全建议">
            {suggestions.map((item, idx) => (
                <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={`composer-suggest-popover__item ${idx === activeIndex ? 'is-active' : ''}`}
                    onMouseEnter={() => onHoverIndex(idx)}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(item);
                    }}
                >
                    <span className="composer-suggest-popover__icon" aria-hidden="true">
                        {item.kind === 'hashtag' ? <Hash size={14} /> : <AtSign size={14} />}
                    </span>
                    <span className="composer-suggest-popover__label">{item.label}</span>
                    {item.subtitle && (
                        <span className="composer-suggest-popover__sub">{item.subtitle}</span>
                    )}
                </button>
            ))}
        </div>
    );
};
