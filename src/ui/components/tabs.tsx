import { Box, Text, useInput } from 'ink';
import type { ReactNode } from 'react';
import { termcnColors } from './colors.js';

export interface Tab {
  key: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  isActive = true,
  enableArrowNav = true,
  focused = false,
  width,
}: {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  isActive?: boolean;
  enableArrowNav?: boolean;
  focused?: boolean;
  width?: number;
}): ReactNode {
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === activeTab));
  useInput(
    (_input, key) => {
      if (enableArrowNav) {
        if (key.leftArrow || (key.shift && key.tab)) {
          const previous = tabs[Math.max(0, activeIndex - 1)];
          if (previous) onTabChange(previous.key);
        }
        if (key.rightArrow || (key.tab && !key.shift)) {
          const next = tabs[Math.min(tabs.length - 1, activeIndex + 1)];
          if (next) onTabChange(next.key);
        }
        return;
      }
      if (key.tab && !key.shift) {
        const next = tabs[Math.min(tabs.length - 1, activeIndex + 1)];
        if (next) onTabChange(next.key);
      }
      if (key.shift && key.tab) {
        const previous = tabs[Math.max(0, activeIndex - 1)];
        if (previous) onTabChange(previous.key);
      }
    },
    { isActive }
  );
  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        {tabs.map((tab, index) => (
          <Box key={tab.key}>
            <Text
              color={tab.key === activeTab ? termcnColors.primary : termcnColors.muted}
              bold={tab.key === activeTab}
              underline={tab.key === activeTab}
              inverse={focused && tab.key === activeTab}
            >
              {tab.label}
            </Text>
            {index < tabs.length - 1 && <Text color={termcnColors.border}> │ </Text>}
          </Box>
        ))}
      </Box>
      <Box borderStyle="round" borderColor={termcnColors.border} paddingX={1} width={width}>
        {tabs.find((tab) => tab.key === activeTab)?.content}
      </Box>
    </Box>
  );
}
