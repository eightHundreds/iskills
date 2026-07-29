import { Box, Text } from '../tui/index.js';
import { useInput } from './use-input.js';
import type { ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { Clickable } from './mouse/clickable.js';

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
  bordered = true,
  trailing,
  chip = false,
}: {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  isActive?: boolean;
  enableArrowNav?: boolean;
  focused?: boolean;
  width?: number;
  bordered?: boolean;
  trailing?: ReactNode;
  chip?: boolean;
}): ReactNode {
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === activeTab));

  useInput(
    (input, key) => {
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

  const widthProp = width === undefined ? {} : { width };

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" paddingX={1} {...widthProp}>
        <Box flexDirection="row" flexGrow={1}>
          {tabs.map((tab, index) => (
            <Box key={tab.key}>
              <Clickable onClick={() => onTabChange(tab.key)}>
                <Text
                  color={
                    focused && tab.key === activeTab
                      ? termcnColors.selectionFg
                      : tab.key === activeTab
                        ? termcnColors.primary
                        : termcnColors.muted
                  }
                  {...(focused && tab.key === activeTab
                    ? { backgroundColor: termcnColors.selectionBg }
                    : {})}
                  bold={tab.key === activeTab}
                  underline={tab.key === activeTab && !chip}
                >
                  {tab.label}
                </Text>
              </Clickable>
              {index < tabs.length - 1 && <Text color={termcnColors.border}> │ </Text>}
            </Box>
          ))}
        </Box>
        {trailing}
      </Box>
      {bordered ? (
        <Box borderStyle="round" borderColor={termcnColors.border} paddingX={1} {...widthProp}>
          {tabs.find((tab) => tab.key === activeTab)?.content}
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1} {...widthProp}>
          {tabs.find((tab) => tab.key === activeTab)?.content}
        </Box>
      )}
    </Box>
  );
}
