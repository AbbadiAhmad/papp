import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreIcon from '@mui/icons-material/Restore';
import SaveIcon from '@mui/icons-material/Save';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import {
  DATA_SOURCES,
  DEFAULT_LAYOUT,
  PAGE_PRESETS,
  SAMPLE_DATA,
  computeGrid,
  elementText,
  type ElementKind,
  type StickerElement,
  type StickerLayout,
} from '../../backend/sticker-layout.ts';
import { libraryCatalogApi } from '../api';
import { PageGridPreview, StickerView } from '../stickers';

const PX_PER_MM = 6;

/** A number input that keeps what is being typed (so it can be cleared) and commits only valid numbers. */
function NumField({ label, value, onChange, min = 0, max = 1000, step = 0.5 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only follow outside changes; typing is handled below.
  }, [value]);
  const n = Number(text);
  const invalid = text.trim() === '' || !Number.isFinite(n) || n < min || n > max;
  return (
    <TextField
      label={label}
      size="small"
      type="number"
      value={text}
      error={invalid}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
      }}
      slotProps={{ htmlInput: { min, max, step, inputMode: 'decimal' } }}
      sx={{ width: 120 }}
    />
  );
}

const newId = () => `e${Math.random().toString(36).slice(2, 8)}`;

function blankElement(kind: ElementKind): StickerElement {
  return {
    id: newId(),
    kind,
    source: kind === 'text' ? 'title' : 'code',
    staticText: '',
    xMm: 2,
    yMm: 2,
    wMm: kind === 'barcode' ? 40 : kind === 'qr' ? 20 : 30,
    hMm: kind === 'barcode' ? 10 : kind === 'qr' ? 20 : 6,
    fontSizePt: 9,
    bold: false,
    align: 'center',
    vertical: false,
    maxChars: 0,
  };
}

/**
 * Design the copy sticker (LIBRARY_CATALOG-D33): paper size and margins, sticker size and gaps, and the elements inside
 * one sticker — QR code, barcode and text placeholders for the book/copy data (with a maximum length). The sticker
 * preview uses dummy data and elements can be dragged; the paper preview shows exactly how the stickers fill rows
 * and columns. One layout is saved for the whole library.
 */
export function StickerDesignerPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [layout, setLayout] = useState<StickerLayout>(DEFAULT_LAYOUT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string>(JSON.stringify(DEFAULT_LAYOUT));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    libraryCatalogApi
      .getStickerLayout()
      .then((loaded) => {
        setLayout(loaded);
        setSaved(JSON.stringify(loaded));
        setSelectedId(loaded.elements[0]?.id ?? null);
      })
      .catch((err) => setError(extractErrorMessage(err)));
  }, []);

  const grid = computeGrid(layout);
  const dirty = JSON.stringify(layout) !== saved;
  const selected = layout.elements.find((e) => e.id === selectedId) ?? null;
  const presetKey = Object.entries(PAGE_PRESETS).find(([, p]) => p.widthMm === layout.page.widthMm && p.heightMm === layout.page.heightMm)?.[0] ?? 'custom';

  const patchPage = (patch: Partial<StickerLayout['page']>) => setLayout((l) => ({ ...l, page: { ...l.page, ...patch } }));
  const patchSticker = (patch: Partial<StickerLayout['sticker']>) => setLayout((l) => ({ ...l, sticker: { ...l.sticker, ...patch } }));
  const patchElement = useCallback((id: string, patch: Partial<StickerElement>) => setLayout((l) => ({ ...l, elements: l.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) })), []);

  // Dragging an element in the sticker preview moves it in 0.5 mm steps.
  const onElementPointerDown = (id: string, e: React.PointerEvent) => {
    const element = layout.elements.find((x) => x.id === id);
    if (!element) return;
    e.preventDefault();
    setSelectedId(id);
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, originX: element.xMm, originY: element.yMm };
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const snap = (v: number) => Math.round(v * 2) / 2;
      patchElement(drag.id, {
        xMm: Math.max(0, snap(drag.originX + (e.clientX - drag.startX) / PX_PER_MM)),
        yMm: Math.max(0, snap(drag.originY + (e.clientY - drag.startY) / PX_PER_MM)),
      });
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [patchElement]);

  const addElement = (kind: ElementKind) => {
    const element = blankElement(kind);
    setLayout((l) => ({ ...l, elements: [...l.elements, element] }));
    setSelectedId(element.id);
  };
  const duplicate = () => {
    if (!selected) return;
    const copy = { ...selected, id: newId(), xMm: selected.xMm + 2, yMm: selected.yMm + 2 };
    setLayout((l) => ({ ...l, elements: [...l.elements, copy] }));
    setSelectedId(copy.id);
  };
  const remove = () => {
    if (!selected) return;
    setLayout((l) => ({ ...l, elements: l.elements.filter((e) => e.id !== selected.id) }));
    setSelectedId(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await gated('library_catalog.settings.update', () => libraryCatalogApi.updateStickerLayout(layout));
      setLayout(result);
      setSaved(JSON.stringify(result));
      setMessage(t('library_catalog.designer.saved'));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const sampleCells = Array.from({ length: grid.perPage }, () => SAMPLE_DATA);
  const sourceLabel = (source: string) => t(`library_catalog.designer.source.${source}`);

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 2 }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          {t('library_catalog.menu.sticker_designer')}
        </Typography>
        <Button startIcon={<RestoreIcon />} onClick={() => setLayout(DEFAULT_LAYOUT)}>
          {t('library_catalog.designer.reset')}
        </Button>
        <Button startIcon={<SaveIcon />} variant="contained" onClick={save} disabled={saving || !dirty || grid.perPage < 1}>
          {t('core.common.save')}
        </Button>
      </Stack>
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {message ? <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert> : null}

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Stack spacing={2} sx={{ width: { xs: '100%', lg: 460 }, flexShrink: 0 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>{t('library_catalog.designer.page')}</Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                <TextField
                  select
                  size="small"
                  label={t('library_catalog.designer.page_size')}
                  value={presetKey}
                  onChange={(e) => {
                    const preset = PAGE_PRESETS[e.target.value];
                    if (preset) patchPage(preset);
                  }}
                  sx={{ width: 150 }}
                >
                  {Object.keys(PAGE_PRESETS).map((key) => (
                    <MenuItem key={key} value={key}>{key}</MenuItem>
                  ))}
                  <MenuItem value="custom">{t('library_catalog.designer.custom')}</MenuItem>
                </TextField>
                <NumField label={t('library_catalog.designer.width_mm')} value={layout.page.widthMm} min={50} max={1000} onChange={(n) => patchPage({ widthMm: n })} />
                <NumField label={t('library_catalog.designer.height_mm')} value={layout.page.heightMm} min={50} max={1000} onChange={(n) => patchPage({ heightMm: n })} />
                <NumField label={t('library_catalog.designer.margin_top')} value={layout.page.marginTopMm} max={100} onChange={(n) => patchPage({ marginTopMm: n })} />
                <NumField label={t('library_catalog.designer.margin_bottom')} value={layout.page.marginBottomMm} max={100} onChange={(n) => patchPage({ marginBottomMm: n })} />
                <NumField label={t('library_catalog.designer.margin_left')} value={layout.page.marginLeftMm} max={100} onChange={(n) => patchPage({ marginLeftMm: n })} />
                <NumField label={t('library_catalog.designer.margin_right')} value={layout.page.marginRightMm} max={100} onChange={(n) => patchPage({ marginRightMm: n })} />
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>{t('library_catalog.designer.sticker')}</Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                <NumField label={t('library_catalog.designer.width_mm')} value={layout.sticker.widthMm} min={5} max={300} onChange={(n) => patchSticker({ widthMm: n })} />
                <NumField label={t('library_catalog.designer.height_mm')} value={layout.sticker.heightMm} min={5} max={300} onChange={(n) => patchSticker({ heightMm: n })} />
                <NumField label={t('library_catalog.designer.gap_x')} value={layout.sticker.gapXMm} max={50} onChange={(n) => patchSticker({ gapXMm: n })} />
                <NumField label={t('library_catalog.designer.gap_y')} value={layout.sticker.gapYMm} max={50} onChange={(n) => patchSticker({ gapYMm: n })} />
                <FormControlLabel control={<Checkbox checked={layout.sticker.showBorder} onChange={(e) => patchSticker({ showBorder: e.target.checked })} />} label={t('library_catalog.designer.border')} />
              </Stack>
              <Alert severity={grid.perPage > 0 && grid.problems.length === 0 ? 'success' : 'warning'} sx={{ mt: 1.5 }}>
                {grid.perPage > 0
                  ? t('library_catalog.designer.fits', { columns: grid.columns, rows: grid.rows, count: grid.perPage })
                  : t('library_catalog.designer.fits_none')}
                {grid.problems.map((problem) => (
                  <Box key={problem} component="div">{t(`library_catalog.designer.problem.${problem}`)}</Box>
                ))}
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>{t('library_catalog.designer.elements')}</Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
                <Button size="small" startIcon={<AddIcon />} onClick={() => addElement('qr')}>{t('library_catalog.designer.add_qr')}</Button>
                <Button size="small" startIcon={<AddIcon />} onClick={() => addElement('barcode')}>{t('library_catalog.designer.add_barcode')}</Button>
                <Button size="small" startIcon={<AddIcon />} onClick={() => addElement('text')}>{t('library_catalog.designer.add_text')}</Button>
              </Stack>
              <List dense disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 2 }}>
                {layout.elements.map((element) => (
                  <ListItemButton key={element.id} selected={element.id === selectedId} onClick={() => setSelectedId(element.id)}>
                    <ListItemText
                      primary={`${t(`library_catalog.designer.kind.${element.kind}`)} — ${sourceLabel(element.source)}`}
                      secondary={element.kind === 'text' ? elementText(element, SAMPLE_DATA) : undefined}
                      slotProps={{ secondary: { noWrap: true } }}
                    />
                  </ListItemButton>
                ))}
                {layout.elements.length === 0 ? <ListItemText sx={{ p: 2 }} primary={t('library_catalog.designer.no_elements')} /> : null}
              </List>

              {selected ? (
                <Stack spacing={1.5}>
                  <TextField select size="small" label={t('library_catalog.designer.data')} value={selected.source} onChange={(e) => patchElement(selected.id, { source: e.target.value as StickerElement['source'] })}>
                    {DATA_SOURCES.map((source) => (
                      <MenuItem key={source} value={source}>{sourceLabel(source)}</MenuItem>
                    ))}
                  </TextField>
                  {selected.source === 'static' ? (
                    <TextField size="small" label={t('library_catalog.designer.fixed_text')} value={selected.staticText} onChange={(e) => patchElement(selected.id, { staticText: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
                  ) : null}
                  <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                    <NumField label="X (mm)" value={selected.xMm} max={500} onChange={(n) => patchElement(selected.id, { xMm: n })} />
                    <NumField label="Y (mm)" value={selected.yMm} max={500} onChange={(n) => patchElement(selected.id, { yMm: n })} />
                    <NumField label={t('library_catalog.designer.width_mm')} value={selected.wMm} min={2} max={500} onChange={(n) => patchElement(selected.id, { wMm: n })} />
                    <NumField label={t('library_catalog.designer.height_mm')} value={selected.hMm} min={2} max={500} onChange={(n) => patchElement(selected.id, { hMm: n })} />
                  </Stack>
                  {selected.kind === 'text' ? (
                    <>
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                        <NumField label={t('library_catalog.designer.font_size')} value={selected.fontSizePt} min={4} max={72} step={0.5} onChange={(n) => patchElement(selected.id, { fontSizePt: n })} />
                        <NumField label={t('library_catalog.designer.max_chars')} value={selected.maxChars} min={0} max={500} step={1} onChange={(n) => patchElement(selected.id, { maxChars: Math.round(n) })} />
                        <TextField select size="small" label={t('library_catalog.designer.align')} value={selected.align} onChange={(e) => patchElement(selected.id, { align: e.target.value as StickerElement['align'] })} sx={{ width: 120 }}>
                          <MenuItem value="start">{t('library_catalog.designer.align_start')}</MenuItem>
                          <MenuItem value="center">{t('library_catalog.designer.align_center')}</MenuItem>
                          <MenuItem value="end">{t('library_catalog.designer.align_end')}</MenuItem>
                        </TextField>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">{t('library_catalog.designer.max_chars_hint')}</Typography>
                      <Stack direction="row">
                        <FormControlLabel control={<Checkbox checked={selected.bold} onChange={(e) => patchElement(selected.id, { bold: e.target.checked })} />} label={t('library_catalog.designer.bold')} />
                        <FormControlLabel control={<Checkbox checked={selected.vertical} onChange={(e) => patchElement(selected.id, { vertical: e.target.checked })} />} label={t('library_catalog.designer.vertical')} />
                      </Stack>
                    </>
                  ) : null}
                  <Stack direction="row" spacing={1}>
                    <Button size="small" startIcon={<ContentCopyIcon />} onClick={duplicate}>{t('library_catalog.designer.duplicate')}</Button>
                    <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={remove}>{t('core.common.delete')}</Button>
                  </Stack>
                </Stack>
              ) : null}
            </CardContent>
          </Card>
        </Stack>

        <Stack spacing={2} sx={{ minWidth: 0, flexGrow: 1 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>{t('library_catalog.designer.sticker_preview')}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('library_catalog.designer.sticker_preview_hint')}</Typography>
              <Box sx={{ overflow: 'auto', direction: 'ltr', p: 1, bgcolor: 'action.hover' }}>
                <StickerView layout={layout} data={SAMPLE_DATA} unit={{ kind: 'px', pxPerMm: PX_PER_MM }} selectedId={selectedId} onElementPointerDown={onElementPointerDown} />
              </Box>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>{t('library_catalog.designer.page_preview', { columns: grid.columns, rows: grid.rows })}</Typography>
              {grid.perPage > 0 ? <PageGridPreview layout={layout} cells={sampleCells} maxWidthPx={420} /> : null}
            </CardContent>
          </Card>
        </Stack>
      </Stack>
    </Box>
  );
}
