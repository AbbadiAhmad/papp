import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SendIcon from '@mui/icons-material/Send';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { Paginated } from '../../../../apps/web/src/shared/components/Paginated';
import { Can, usePermission } from '../../../../apps/web/src/shared/permissions';
import {
  libraryCirculationApi,
  type MessagePreview,
  type MessageRecipientMode,
  type MessageTemplate,
  type StudentSearchResult,
} from '../api';

const PLACEHOLDERS = ['{{name}}', '{{code}}', '{{class}}', '{{books}}', '{{fines_total}}', '{{days_late}}'];

/**
 * Librarian -> reader messages: pick who (everyone / chosen readers / readers
 * with unpaid fines / readers with overdue books, optionally within a period),
 * write the message or start from a saved template, choose whether it also
 * goes out by email, and send. Templates are managed on the second tab.
 */
export function MessagesPage() {
  const { t } = useTranslation();
  const canManageTemplates = usePermission('library_circulation.messages.templates');
  const [tab, setTab] = useState<'compose' | 'templates'>('compose');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const loadTemplates = () => {
    libraryCirculationApi
      .listMessageTemplates()
      .then(setTemplates)
      .catch((err: unknown) => setTemplatesError(extractErrorMessage(err)));
  };
  useEffect(loadTemplates, []);

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_circulation.messages.title')}
      </Typography>
      <Tabs value={canManageTemplates ? tab : 'compose'} onChange={(_e, v: 'compose' | 'templates') => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="compose" label={t('library_circulation.messages.tab_compose')} />
        {canManageTemplates ? <Tab value="templates" label={t('library_circulation.messages.tab_templates')} /> : null}
      </Tabs>
      {templatesError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {templatesError}
        </Alert>
      ) : null}
      {tab === 'compose' || !canManageTemplates ? (
        <ComposeTab templates={templates} />
      ) : (
        <Can permission="library_circulation.messages.templates">
          <TemplatesTab templates={templates} onSaved={setTemplates} />
        </Can>
      )}
    </Box>
  );
}

// --- compose ----------------------------------------------------------------

function ComposeTab({ templates }: { templates: MessageTemplate[] }) {
  const { t } = useTranslation();
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [mode, setMode] = useState<MessageRecipientMode>('all');
  const [readers, setReaders] = useState<StudentSearchResult[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const usesPeriod = mode === 'unpaid_fines' || mode === 'overdue';
  const recipients = () => ({
    mode,
    studentIds: mode === 'individual' ? readers.map((r) => r.id) : undefined,
    dateFrom: usesPeriod && dateFrom ? dateFrom : undefined,
    dateTo: usesPeriod && dateTo ? dateTo : undefined,
  });
  // Any change to who/what invalidates a previous preview.
  const resetPreview = () => setPreview(null);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    if (tpl) {
      setTitle(tpl.title);
      setBodyMarkdown(tpl.bodyMarkdown);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = () =>
    run(async () => {
      setPreview(await libraryCirculationApi.previewMessage(recipients()));
    });

  const handleSend = () => {
    setConfirmOpen(false);
    return run(async () => {
      const result = await libraryCirculationApi.sendMessage({ recipients: recipients(), title, bodyMarkdown, sendEmail });
      setSuccess(
        t('library_circulation.messages.sent', { sent: result.sentCount, failed: result.failedCount }) +
          (sendEmail ? ' ' + t('library_circulation.messages.sent_emailed', { count: result.emailedCount }) : ''),
      );
      setPreview(null);
    });
  };

  const openConfirm = () =>
    run(async () => {
      const p = await libraryCirculationApi.previewMessage(recipients());
      setPreview(p);
      if (p.recipientCount === 0) throw new Error(t('library_circulation.messages.no_recipients'));
      setConfirmOpen(true);
    });

  const canSubmit = title.trim() !== '' && bodyMarkdown.trim() !== '' && (mode !== 'individual' || readers.length > 0);

  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">{success}</Alert> : null}

      <Card>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>
            {t('library_circulation.messages.recipients')}
          </Typography>
          <RadioGroup
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as MessageRecipientMode);
              resetPreview();
            }}
          >
            {(['all', 'individual', 'unpaid_fines', 'overdue'] as const).map((m) => (
              <FormControlLabel key={m} value={m} control={<Radio />} label={t(`library_circulation.messages.mode_${m}`)} />
            ))}
          </RadioGroup>

          {mode === 'individual' ? (
            <ReaderPicker
              value={readers}
              onChange={(next) => {
                setReaders(next);
                resetPreview();
              }}
            />
          ) : null}

          {usesPeriod ? (
            <Stack direction="row" spacing={2} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 2 }}>
              <TextField
                type="date"
                size="small"
                label={t(mode === 'unpaid_fines' ? 'library_circulation.messages.fines_from' : 'library_circulation.messages.due_from')}
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  resetPreview();
                }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="date"
                size="small"
                label={t(mode === 'unpaid_fines' ? 'library_circulation.messages.fines_to' : 'library_circulation.messages.due_to')}
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  resetPreview();
                }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                {t('library_circulation.messages.period_hint')}
              </Typography>
            </Stack>
          ) : null}

          <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Button variant="outlined" onClick={handlePreview} disabled={busy || (mode === 'individual' && readers.length === 0)}>
              {t('library_circulation.messages.preview_button')}
            </Button>
            {preview ? (
              <Typography variant="body2">
                {t('library_circulation.messages.preview_count', { count: preview.recipientCount })}
                {preview.sample.length ? ': ' + preview.sample.map((s) => `${s.name} (${s.code})`).join(', ') : ''}
                {preview.recipientCount > preview.sample.length ? '…' : ''}
              </Typography>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <TextField
              select
              size="small"
              label={t('library_circulation.messages.template')}
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              helperText={templates.length === 0 ? t('library_circulation.messages.no_templates') : t('library_circulation.messages.template_help')}
            >
              <MenuItem value="">{t('library_circulation.messages.no_template')}</MenuItem>
              {templates.map((tpl) => (
                <MenuItem key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField label={t('library_circulation.messages.subject')} value={title} onChange={(e) => setTitle(e.target.value)} required fullWidth />
            <TextField
              label={t('library_circulation.messages.body')}
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              required
              fullWidth
              multiline
              minRows={5}
            />
            <PlaceholderHint />
            <FormControlLabel
              control={<Switch checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />}
              label={t('library_circulation.messages.also_email')}
            />
            <Typography variant="caption" color="text.secondary">
              {t(sendEmail ? 'library_circulation.messages.channel_both' : 'library_circulation.messages.channel_in_app')}
            </Typography>
            <Box>
              <Button startIcon={busy ? <CircularProgress size={16} /> : <SendIcon />} variant="contained" onClick={openConfirm} disabled={busy || !canSubmit}>
                {t('library_circulation.messages.send_button')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t('library_circulation.messages.confirm_title')}
        description={t(sendEmail ? 'library_circulation.messages.confirm_body_email' : 'library_circulation.messages.confirm_body', {
          count: preview?.recipientCount ?? 0,
        })}
        confirmLabel={t('library_circulation.messages.send_button')}
        onConfirm={handleSend}
        onCancel={() => setConfirmOpen(false)}
      />
    </Stack>
  );
}

function PlaceholderHint() {
  const { t } = useTranslation();
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
        {t('library_circulation.messages.placeholders_help')}
      </Typography>
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        {PLACEHOLDERS.map((p) => (
          <Chip key={p} size="small" variant="outlined" label={p} />
        ))}
      </Stack>
    </Box>
  );
}

/** Type a name or code, pick from the matches; chosen readers become removable chips. */
function ReaderPicker({ value, onChange }: { value: StudentSearchResult[]; onChange: (next: StudentSearchResult[]) => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<StudentSearchResult[]>([]);

  useEffect(() => {
    const q = input.trim();
    if (!q) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      libraryCirculationApi
        .searchMessageReaders(q)
        .then((r) => {
          if (!cancelled) setOptions(r);
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input]);

  const label = (r: StudentSearchResult) => `${r.name ?? r.code} (${r.code})`;
  return (
    <Autocomplete
      multiple
      filterSelectedOptions
      options={options}
      value={value}
      inputValue={input}
      onInputChange={(_e, v, reason) => {
        if (reason !== 'reset') setInput(v);
      }}
      onChange={(_e, next) => {
        onChange(next);
        setInput('');
      }}
      getOptionLabel={label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(x) => x}
      noOptionsText={input.trim() ? t('library_circulation.messages.no_readers_found') : t('library_circulation.messages.type_to_search')}
      renderValue={(selected, getItemProps) =>
        selected.map((option, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip {...itemProps} key={key} label={label(option)} size="small" />;
        })
      }
      renderInput={(params) => <TextField {...params} size="small" label={t('library_circulation.messages.pick_readers')} sx={{ mt: 1 }} />}
    />
  );
}

// --- templates --------------------------------------------------------------

function TemplatesTab({ templates, onSaved }: { templates: MessageTemplate[]; onSaved: (next: MessageTemplate[]) => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ index: number | null; draft: MessageTemplate } | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const persist = async (next: MessageTemplate[]) => {
    setError(null);
    setSaving(true);
    try {
      onSaved(await libraryCirculationApi.saveMessageTemplates(next));
      setEditing(null);
      setDeleteIndex(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () => {
    if (!editing) return;
    const next = [...templates];
    if (editing.index === null) next.push(editing.draft);
    else next[editing.index] = editing.draft;
    void persist(next);
  };

  const draft = editing?.draft;
  const valid = !!draft && draft.name.trim() !== '' && draft.title.trim() !== '' && draft.bodyMarkdown.trim() !== '';

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
          {t('library_circulation.messages.templates_help')}
        </Typography>
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          onClick={() => setEditing({ index: null, draft: { name: '', title: '', bodyMarkdown: '' } })}
        >
          {t('library_circulation.messages.add_template')}
        </Button>
      </Stack>
      {error && !editing ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <Paginated items={templates}>
        {(pageRows) => (
          <TableContainer component={Card}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('library_circulation.messages.template_name')}</TableCell>
                  <TableCell>{t('library_circulation.messages.subject')}</TableCell>
                  <TableCell align="right">{t('core.common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        {t('library_circulation.messages.no_templates')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((tpl) => {
                    const index = templates.indexOf(tpl);
                    return (
                      <TableRow key={tpl.id ?? index} hover>
                        <TableCell>{tpl.name}</TableCell>
                        <TableCell>{tpl.title}</TableCell>
                        <TableCell align="right">
                          <IconButton size="small" aria-label={t('core.common.edit')} onClick={() => setEditing({ index, draft: { ...tpl } })}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" aria-label={t('core.common.delete')} onClick={() => setDeleteIndex(index)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paginated>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t(editing?.index === null ? 'library_circulation.messages.add_template' : 'library_circulation.messages.edit_template')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label={t('library_circulation.messages.template_name')}
              placeholder={t('library_circulation.messages.template_name_example')}
              value={draft?.name ?? ''}
              onChange={(e) => editing && setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })}
              required
              fullWidth
            />
            <TextField
              label={t('library_circulation.messages.subject')}
              value={draft?.title ?? ''}
              onChange={(e) => editing && setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })}
              required
              fullWidth
            />
            <TextField
              label={t('library_circulation.messages.body')}
              value={draft?.bodyMarkdown ?? ''}
              onChange={(e) => editing && setEditing({ ...editing, draft: { ...editing.draft, bodyMarkdown: e.target.value } })}
              required
              fullWidth
              multiline
              minRows={6}
            />
            <PlaceholderHint />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{t('core.common.cancel')}</Button>
          <Button variant="contained" onClick={saveDraft} disabled={!valid || saving}>
            {t('core.common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={deleteIndex !== null}
        title={t('library_circulation.messages.delete_template_title')}
        description={t('library_circulation.messages.delete_template_body', { name: deleteIndex === null ? '' : templates[deleteIndex]?.name })}
        confirmColor="error"
        confirmLabel={t('core.common.delete')}
        onConfirm={() => deleteIndex !== null && void persist(templates.filter((_t, i) => i !== deleteIndex))}
        onCancel={() => setDeleteIndex(null)}
      />
    </Box>
  );
}
