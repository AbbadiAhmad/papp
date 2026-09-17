import { Box, Skeleton } from '@mui/material';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * Renders a real QR code image encoding `value` — a genuinely new platform
 * capability (root ASSUMPTIONS.md A14: no module has ever rendered a QR
 * image before; the "codes" everywhere else are plain matched text
 * strings). Client-side generation via the `qrcode` npm package — no
 * backend endpoint needed since the value being encoded is already known to
 * the caller (the student's own `code`).
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

  return (
    <Box
      component="img"
      src={dataUrl}
      alt={value}
      sx={{ width: size, height: size, display: 'block' }}
    />
  );
}
