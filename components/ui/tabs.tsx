'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/ui';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider');
  }
  return context;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabListProps {
  children: ReactNode;
  className?: string;
}

export function TabList({ children, className }: TabListProps) {
  return (
    <div
      role="tablist"
      aria-label="Tabs"
      className={cn('flex flex-wrap gap-1 border-b border-edge mb-6', className)}
    >
      {children}
    </div>
  );
}

interface TabTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function TabTrigger({ value, children, className, disabled }: TabTriggerProps) {
  const { value: activeValue, onValueChange } = useTabsContext();
  const isActive = activeValue === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      aria-controls={`panel-${value}`}
      id={`tab-${value}`}
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onValueChange(value)}
      className={cn(
        'relative -mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition',
        disabled
          ? 'border-transparent text-ink-faint cursor-not-allowed opacity-60'
          : isActive
            ? 'border-accent text-accent'
            : 'border-transparent text-ink-muted hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className }: TabPanelProps) {
  const { value: activeValue } = useTabsContext();

  if (activeValue !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`panel-${value}`}
      aria-labelledby={`tab-${value}`}
      className={cn('animate-fade-up', className)}
    >
      {children}
    </div>
  );
}
