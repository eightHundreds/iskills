// Product control barrel. Implementations prefer OpenTUI natives (input/select/a)
// when the gap is small; see docs/opentui-practices.md.
export { ModalPanel } from './modal-panel.js';
export { MultiSelect } from './multi-select.js';
export { Select } from './select.js';
export { TagEditor } from './tag-editor.js';
export { Tabs } from './tabs.js';
export { TextInput } from './text-input.js';
export { WorkingSpinner, useSpinnerFrame } from './spinner.js';
export {
  termcnColors,
  modalChrome,
  modalChromeByMode,
} from './colors.js';
export type { Option } from './options.js';
export type { Tab } from './tabs.js';
