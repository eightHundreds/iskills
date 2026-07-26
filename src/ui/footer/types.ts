/** Presentation-only footer item (no domain fields). */
export interface FooterItem {
  /** Key label; omit for meta text like selection count. */
  key?: string;
  label: string;
}

export type FooterStatusKind = 'normal' | 'error' | 'progress';

export type FooterView =
  | {
      mode: 'keys';
      items: FooterItem[];
      status?: string;
      statusKind?: FooterStatusKind;
    }
  | {
      mode: 'input';
      label: string;
      value: string;
    }
  | {
      mode: 'empty';
    };

export type FooterEnterAction = 'add' | 'detail' | 'view' | null;

export type FooterBrowseFocus = 'tabs' | 'agents' | 'tags' | 'list';

export interface FooterBrowseCapabilities {
  focus: FooterBrowseFocus;
  canDelete: boolean;
  enterAction: FooterEnterAction;
  canTag: boolean;
  canImport: boolean;
  canMaterialize: boolean;
  /** 0 = hide update action; >0 shows u 更新 or u 更新(N). */
  updateCount: number;
  /** When updateCount > 0 and selection-based, show (N). */
  updateIsSelection: boolean;
  selectionCount: number;
}

export interface FooterWorkingState {
  action: '更新' | '转换';
  current: number;
  total: number;
}

export interface FooterStatusState {
  kind: 'normal' | 'error';
  text: string;
}

export interface FooterUpdateCheckState {
  checking: boolean;
  failed: number;
}

export interface FooterResolveInput {
  /** modal > layer items when an overlay owns the footer; null if none. */
  overlayItems: FooterItem[] | null;
  /** detail / group-jump / other: suppress browse footer. */
  suppressed: boolean;
  filterOpen: boolean;
  filterDraft: string;
  working: FooterWorkingState | null;
  /** Live bindings during working — typically empty (conservative). */
  workingItems?: FooterItem[];
  browse: FooterBrowseCapabilities | null;
  status: FooterStatusState | null;
  updateCheck: FooterUpdateCheckState | null;
  /** Terminal columns for truncation; omit to skip. */
  columns?: number;
}
