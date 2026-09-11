import { useState, useMemo, memo, useCallback, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useExpandCollapse } from '~/hooks';
import Markdown from '../Markdown';
import { cn } from '~/utils';

const Collapsible = memo(function Collapsible({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(isExpanded);

  const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsExpanded((prev) => !prev);
  }, []);

  const label = useMemo(() => title, [title]);

  return (
    <div className="mb-4 pb-2 pt-2">
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <ChevronDown
          className={cn(
            'icon-sm shrink-0 transform-gpu transition-transform duration-200',
            isExpanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
        {label}
      </button>
      <div
        id={contentId}
        role="group"
        aria-label={label}
        aria-hidden={!isExpanded || undefined}
        style={expandStyle}
      >
        <div className="overflow-hidden pt-2" ref={expandRef}>
          <div className="markdown prose message-content dark:prose-invert light w-full break-words rounded-lg border border-border-light bg-surface-secondary p-3 dark:text-gray-100">
            <Markdown content={content} isLatestMessage={false} />
          </div>
        </div>
      </div>
    </div>
  );
});

Collapsible.displayName = 'Collapsible';

export default Collapsible;
