import { withOverlayHost } from './bridge.js';

/**
 * Command-facing confirm — always uses ModalApi.confirm (panel).
 * Reuses the active OverlayHost when present; otherwise bootstraps via shell.
 */
export async function confirm(
  message: string,
  defaultValue = false
): Promise<boolean> {
  return withOverlayHost((host) =>
    host.modal.confirm({
      title: '确认',
      message,
      defaultValue,
    })
  );
}
