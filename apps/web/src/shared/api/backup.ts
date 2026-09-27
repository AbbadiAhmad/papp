import { apiClient } from './httpClient';
import type { BackupInfo } from './types';

const DEFAULT_FILENAME = 'papp-backup.zip';

/** Parses `attachment; filename="papp-backup-....zip"` — falls back to a generic name if the header is missing/malformed. */
function filenameFromContentDisposition(headerValue: string | undefined): string {
  const match = headerValue?.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? DEFAULT_FILENAME;
}

export const backupApi = {
  getInfo: () => apiClient.get<BackupInfo>('/backup/info').then((r) => r.data),

  /** Triggers the export, then a real browser download via an object URL — mirrors how a native <a download> click works, since axios gives us a Blob rather than a navigable URL directly. */
  exportBackup: async (): Promise<void> => {
    const response = await apiClient.post('/backup/export', null, { responseType: 'blob' });
    const filename = filenameFromContentDisposition(response.headers['content-disposition'] as string | undefined);
    const url = URL.createObjectURL(response.data as Blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};
