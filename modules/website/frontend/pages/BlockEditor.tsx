import { Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type {
  ButtonConfig,
  ColumnsConfig,
  HeroConfig,
  ImageConfig,
  SpacerConfig,
  TextConfig,
  WebsiteBlock,
} from '../api';

/** The per-type form fields for one block — the admin UI's own enforcement of each block's shape (the backend stores `config` as opaque JSON, see `replace-blocks.dto.ts`'s own docblock). */
export function BlockEditor({ block, onChange }: { block: WebsiteBlock; onChange: (config: WebsiteBlock['config']) => void }) {
  const { t } = useTranslation();

  switch (block.type) {
    case 'hero': {
      const config = block.config as HeroConfig;
      return (
        <Stack spacing={2}>
          <TextField
            label={t('website.blocks.heading')}
            value={config.heading}
            onChange={(e) => onChange({ ...config, heading: e.target.value })}
            fullWidth
          />
          <TextField
            label={t('website.blocks.subheading')}
            value={config.subheading ?? ''}
            onChange={(e) => onChange({ ...config, subheading: e.target.value })}
            fullWidth
          />
          <TextField
            label={t('website.blocks.image_url')}
            value={config.imageUrl ?? ''}
            onChange={(e) => onChange({ ...config, imageUrl: e.target.value })}
            fullWidth
          />
        </Stack>
      );
    }
    case 'text': {
      const config = block.config as TextConfig;
      return (
        <TextField
          label={t('website.blocks.markdown')}
          value={config.markdown}
          onChange={(e) => onChange({ markdown: e.target.value })}
          fullWidth
          multiline
          minRows={4}
          helperText={t('website.blocks.markdown_help')}
        />
      );
    }
    case 'image': {
      const config = block.config as ImageConfig;
      return (
        <Stack spacing={2}>
          <TextField
            label={t('website.blocks.image_url')}
            value={config.imageUrl}
            onChange={(e) => onChange({ ...config, imageUrl: e.target.value })}
            fullWidth
          />
          <TextField
            label={t('website.blocks.alt_text')}
            value={config.alt ?? ''}
            onChange={(e) => onChange({ ...config, alt: e.target.value })}
            fullWidth
          />
        </Stack>
      );
    }
    case 'columns': {
      const config = block.config as ColumnsConfig;
      return (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Stack spacing={2} sx={{ flex: 1 }}>
            <TextField
              label={t('website.blocks.left_heading')}
              value={config.left.heading}
              onChange={(e) => onChange({ ...config, left: { ...config.left, heading: e.target.value } })}
              fullWidth
            />
            <TextField
              label={t('website.blocks.left_text')}
              value={config.left.text}
              onChange={(e) => onChange({ ...config, left: { ...config.left, text: e.target.value } })}
              fullWidth
              multiline
              minRows={2}
            />
          </Stack>
          <Stack spacing={2} sx={{ flex: 1 }}>
            <TextField
              label={t('website.blocks.right_heading')}
              value={config.right.heading}
              onChange={(e) => onChange({ ...config, right: { ...config.right, heading: e.target.value } })}
              fullWidth
            />
            <TextField
              label={t('website.blocks.right_text')}
              value={config.right.text}
              onChange={(e) => onChange({ ...config, right: { ...config.right, text: e.target.value } })}
              fullWidth
              multiline
              minRows={2}
            />
          </Stack>
        </Stack>
      );
    }
    case 'button': {
      const config = block.config as ButtonConfig;
      return (
        <Stack spacing={2}>
          <TextField
            label={t('website.blocks.button_label')}
            value={config.label}
            onChange={(e) => onChange({ ...config, label: e.target.value })}
            fullWidth
          />
          <TextField
            label={t('website.blocks.button_url')}
            value={config.url}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            fullWidth
          />
        </Stack>
      );
    }
    case 'spacer': {
      const config = block.config as SpacerConfig;
      return (
        <TextField
          label={t('website.blocks.height_px')}
          type="number"
          value={config.height}
          onChange={(e) => onChange({ height: Number(e.target.value) })}
        />
      );
    }
    default:
      return null;
  }
}
