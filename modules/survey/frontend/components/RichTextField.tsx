import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatColorTextIcon from '@mui/icons-material/FormatColorText';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FunctionsIcon from '@mui/icons-material/Functions';
import ReplyIcon from '@mui/icons-material/Reply';
import LinkIcon from '@mui/icons-material/Link';
import { Box, IconButton, Menu, MenuItem, Stack, TextField, Tooltip, Typography, type TextFieldProps } from '@mui/material';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COLOR_NAMES, MAX_RICH_TEXT_LENGTH, toPlainText, wrapSelection } from '../../backend/rich-text.ts';
import { RichText } from './RichText';

type Props = Omit<TextFieldProps, 'onChange' | 'value'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Questions in earlier sections whose answer may be inserted (piping). Omit for a field where nothing can be piped. */
  pipeSources?: Array<{ id: string; title: string }>;
};

/**
 * A text box with a small formatting toolbar (bold, italic, link, colour, maths) and a live preview. The
 * toolbar only inserts the markup described in backend/rich-text.ts; owners can also type it by hand.
 */
export function RichTextField({ value, onValueChange, label, pipeSources, ...rest }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const [pipeAnchor, setPipeAnchor] = useState<HTMLElement | null>(null);

  const apply = (before: string, after: string, placeholder: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = wrapSelection(value, start, end, before, after, placeholder);
    onValueChange(next.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const button = (labelKey: string, icon: React.ReactNode, onClick: (e: React.MouseEvent<HTMLElement>) => void) => (
    <Tooltip title={t(labelKey)}>
      <IconButton size="small" aria-label={t(labelKey)} onClick={onClick}>
        {icon}
      </IconButton>
    </Tooltip>
  );

  const hasMarkup = /[*[{$]/.test(value);
  const hasPipe = value.includes('{{q:');

  return (
    <Box>
      <Stack direction="row" spacing={0.25} sx={{ mb: 0.5 }}>
        {button('survey.richtext.bold', <FormatBoldIcon fontSize="small" />, () => apply('**', '**', t('survey.richtext.bold_placeholder')))}
        {button('survey.richtext.italic', <FormatItalicIcon fontSize="small" />, () => apply('*', '*', t('survey.richtext.italic_placeholder')))}
        {button('survey.richtext.link', <LinkIcon fontSize="small" />, () => apply('[', '](https://)', t('survey.richtext.link_placeholder')))}
        {button('survey.richtext.color', <FormatColorTextIcon fontSize="small" />, (e) => setColorAnchor(e.currentTarget))}
        {button('survey.richtext.math', <FunctionsIcon fontSize="small" />, () => apply('$', '$', 'x^2'))}
        {pipeSources && pipeSources.length > 0 ? button('survey.richtext.pipe', <ReplyIcon fontSize="small" />, (e) => setPipeAnchor(e.currentTarget)) : null}
      </Stack>
      <Menu anchorEl={colorAnchor} open={colorAnchor !== null} onClose={() => setColorAnchor(null)}>
        {Object.entries(COLOR_NAMES).map(([name, css]) => (
          <MenuItem
            key={name}
            onClick={() => {
              setColorAnchor(null);
              apply(`{${name}|`, '}', t('survey.richtext.color_placeholder'));
            }}
          >
            <Box component="span" sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: css, display: 'inline-block', mr: 1 }} />
            {t(`survey.richtext.colors.${name}`)}
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={pipeAnchor} open={pipeAnchor !== null} onClose={() => setPipeAnchor(null)}>
        {(pipeSources ?? []).map((source) => (
          <MenuItem
            key={source.id}
            onClick={() => {
              setPipeAnchor(null);
              apply(`{{q:${source.id}}}`, '', '');
            }}
          >
            {toPlainText(source.title) || t('survey.carry.untitled')}
          </MenuItem>
        ))}
      </Menu>
      <TextField
        {...rest}
        label={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        inputRef={ref}
        fullWidth
        slotProps={{ ...rest.slotProps, htmlInput: { maxLength: MAX_RICH_TEXT_LENGTH, ...(rest.slotProps as { htmlInput?: object } | undefined)?.htmlInput } }}
      />
      {hasPipe ? (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          {t('survey.richtext.pipe_note')}
        </Typography>
      ) : null}
      {hasMarkup ? (
        <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.5 }} aria-label={t('survey.richtext.preview')}>
          <RichText text={value} component="div" />
        </Typography>
      ) : null}
    </Box>
  );
}
