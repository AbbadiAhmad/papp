import { Box, Button, Grid, Typography } from '@mui/material';
import type {
  ButtonConfig,
  ColumnsConfig,
  HeroConfig,
  ImageConfig,
  SpacerConfig,
  TextConfig,
  WebsiteBlock,
} from '../api';
import { SafeMarkdown } from './SafeMarkdown';

/**
 * Renders ONE block, used by BOTH `PageEditorPage`'s live preview and the
 * public `PublicSitePage` — one shared implementation so the two can never
 * visually drift apart. No raw-HTML block type exists at all (see the
 * module's DOCUMENTATION.md); `text`'s Markdown goes through `SafeMarkdown`
 * only.
 */
export function BlockRenderer({ block }: { block: WebsiteBlock }) {
  switch (block.type) {
    case 'hero': {
      const config = block.config as HeroConfig;
      return (
        <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
          {config.imageUrl ? (
            <Box component="img" src={config.imageUrl} alt={config.heading} sx={{ maxWidth: '100%', mb: 3, borderRadius: 1 }} />
          ) : null}
          <Typography variant="h3" component="h1" gutterBottom>
            {config.heading}
          </Typography>
          {config.subheading ? (
            <Typography variant="h6" color="text.secondary">
              {config.subheading}
            </Typography>
          ) : null}
        </Box>
      );
    }
    case 'text': {
      const config = block.config as TextConfig;
      return (
        <Box sx={{ py: 2, px: 2 }}>
          <SafeMarkdown markdown={config.markdown} />
        </Box>
      );
    }
    case 'image': {
      const config = block.config as ImageConfig;
      return (
        <Box sx={{ py: 2, px: 2, textAlign: 'center' }}>
          <Box component="img" src={config.imageUrl} alt={config.alt ?? ''} sx={{ maxWidth: '100%', borderRadius: 1 }} />
        </Box>
      );
    }
    case 'columns': {
      const config = block.config as ColumnsConfig;
      return (
        <Grid container spacing={4} sx={{ py: 2, px: 2 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="h6" gutterBottom>
              {config.left.heading}
            </Typography>
            <SafeMarkdown markdown={config.left.text} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="h6" gutterBottom>
              {config.right.heading}
            </Typography>
            <SafeMarkdown markdown={config.right.text} />
          </Grid>
        </Grid>
      );
    }
    case 'button': {
      const config = block.config as ButtonConfig;
      return (
        <Box sx={{ py: 2, px: 2, textAlign: 'center' }}>
          <Button variant="contained" size="large" href={config.url}>
            {config.label}
          </Button>
        </Box>
      );
    }
    case 'spacer': {
      const config = block.config as SpacerConfig;
      return <Box sx={{ height: config.height }} />;
    }
    default:
      return null;
  }
}
