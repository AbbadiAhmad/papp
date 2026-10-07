import { alpha, Box, Typography } from '@mui/material';

/** The coloured title strip across the top of a desk panel (Reader / Books), full-bleed inside the card. */
export function PanelHeading({ tone, children }: { tone: 'primary' | 'secondary'; children: React.ReactNode }) {
  return (
    <Box
      sx={(theme) => ({
        mx: -2,
        mt: -2,
        mb: 2,
        px: 2,
        py: 1,
        bgcolor: alpha(theme.palette[tone].main, theme.palette.mode === 'dark' ? 0.3 : 0.12),
        borderBottom: '2px solid',
        borderBottomColor: `${tone}.main`,
      })}
    >
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, color: `${tone}.main` }}>
        {children}
      </Typography>
    </Box>
  );
}
