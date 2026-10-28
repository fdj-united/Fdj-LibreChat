import { cn } from '~/utils';

export default function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-lg border border-border-light bg-surface-primary p-5',
        'dark:border-chart-widget-stroke dark:bg-chart-widget-surface',
        className,
      )}
    >
      {children}
    </section>
  );
}
