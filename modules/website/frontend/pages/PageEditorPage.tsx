import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { emptyConfigFor, websiteApi, type BlockInput, type BlockType, type WebsiteBlock, type WebsitePageDetail } from '../api';
import { BlockEditor } from './BlockEditor';
import { BlockRenderer } from './BlockRenderer';

const BLOCK_TYPES: BlockType[] = ['hero', 'text', 'image', 'columns', 'button', 'spacer'];

export function PageEditorPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { status, data: page, errorMessage, reload } = useGuardedQuery(() => websiteApi.getPage(pageId!));

  return (
    <Box>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {page ? <PageEditorForm page={page} onSaved={reload} /> : null}
      </QueryStateGate>
    </Box>
  );
}

function PageEditorForm({ page, onSaved }: { page: WebsitePageDetail; onSaved: () => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [blocks, setBlocks] = useState<WebsiteBlock[]>(page.blocks);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addBlock = (type: BlockType) => {
    setBlocks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), pageId: page.id, orderIndex: prev.length, type, config: emptyConfigFor(type) },
    ]);
  };

  const updateBlockConfig = (id: string, config: WebsiteBlock['config']) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, config } : b)));
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id).map((b, i) => ({ ...b, orderIndex: i })));
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    setBlocks((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((b, i) => ({ ...b, orderIndex: i }));
    });
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const input: BlockInput[] = blocks.map((b) => ({ id: b.id, orderIndex: b.orderIndex, type: b.type, config: b.config }));
      await gated('website.pages.update', () => websiteApi.replaceBlocks(page.id, input));
      setSnackbar(t('core.settings.saved'));
      onSaved();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {page.title}
      </Typography>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" gutterBottom>
            {t('website.pages.blocks')}
          </Typography>
          <Stack spacing={2}>
            {blocks.map((block, index) => (
              <Card key={block.id} variant="outlined">
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2">{t(`website.blocks.type_${block.type}`)}</Typography>
                    <Stack direction="row" spacing={0.5}>
                      <IconButton size="small" onClick={() => moveBlock(index, -1)} disabled={index === 0}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1}>
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => removeBlock(block.id)} aria-label={t('core.common.delete')}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>
                  <BlockEditor block={block} onChange={(config) => updateBlockConfig(block.id, config)} />
                </CardContent>
              </Card>
            ))}
          </Stack>

          <TextField
            select
            label={t('website.pages.add_block')}
            value=""
            onChange={(e) => addBlock(e.target.value as BlockType)}
            sx={{ mt: 2, minWidth: 220 }}
            slotProps={{ select: { displayEmpty: true } }}
          >
            <MenuItem value="" disabled>
              {t('website.pages.add_block')}
            </MenuItem>
            {BLOCK_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {t(`website.blocks.type_${type}`)}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ mt: 3 }}>
            <Button startIcon={<AddIcon />} variant="contained" onClick={save} disabled={saving}>
              {t('core.common.save')}
            </Button>
          </Box>
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" gutterBottom>
            {t('website.pages.preview')}
          </Typography>
          <Paper variant="outlined" sx={{ minHeight: 200 }}>
            {blocks.map((block) => (
              <BlockRenderer key={block.id} block={block} />
            ))}
          </Paper>
        </Box>
      </Stack>

      <Snackbar open={snackbar !== null} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
