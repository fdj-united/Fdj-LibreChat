import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { HoverCard, HoverCardPortal, HoverCardContent, HoverCardTrigger } from '@librechat/client';

export default function MetricInfo({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-describedby={open ? id : undefined}
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-text-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent id={id} className="z-50 max-w-80 text-sm">
          {text}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
