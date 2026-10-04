import { Box, Skeleton } from '@mui/material';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * Renders a real QR code image encoding `value` — client-side generation
 * via the `qrcode` npm package, same approach as
 * `modules/library_circulation/frontend/pages/QrCodeImage.tsx` (root
 * ASSUMPTIONS.md A14). Deliberately duplicated here rather than imported
 * across the module boundary (LIBRARY_CATALOG-D22) — A14's own reasoning
 * applies again: a shared `packages/` utility is worth it once a THIRD
 * consumer needs it, not for a second one; if a third module needs QR
 * rendering, extract a shared package then instead of guessing its shape
 * now.
 */
export function QrCodeImage({ value, size = 160 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return <Skeleton variant="rectangular" width={size} height={size} />;
  }

  return <Box component="img" src={dataUrl} alt={value} sx={{ width: size, height: size, display: 'block' }} />;
}
