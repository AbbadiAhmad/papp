import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { alpha, Box, ButtonBase, Chip, Collapse, Stack, Typography } from '@mui/material';
import { useId, useState } from 'react';

const STORAGE_PREFIX = 'library-circulation.section.';

/** Remembered open/closed state per section (a per-viewer convenience only — storage can be missing or blocked). */
function readStored(id: string): boolean | null {
  try {
    const value = window.localStorage.getItem(STORAGE_PREFIX + id);
    return value === null ? null : value === '1';
  } catch {
    return null;
  }
}

function writeStored(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

interface Props {
  /** Stable key; the librarian's open/closed choice is remembered under it. */
  id: string;
  title: string;
  /** Shown beside the title even when folded (a count, a total…), so folding never hides that something is there. */
  summary?: React.ReactNode;
  /** Used until the user has made their own choice. */
  defaultExpanded?: boolean;
  /** Accent colour of the section's edge and header tint, so sections read as distinct blocks. */
  tone?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success' | 'neutral';
  children: React.ReactNode;
}

/**
 * A section of a card that folds away: a full-width header button (title +
 * summary chip + chevron) over a collapsible body. Keyboard- and
 * screen-reader-friendly (`aria-expanded`/`aria-controls`), and RTL-safe —
 * the chevron sits at the inline end.
 */
export function CollapsibleSection({ id, title, summary, defaultExpanded = true, tone = 'neutral', children }: Props) {
  const [userChoice, setUserChoice] = useState<boolean | null>(() => readStored(id));
  const expanded = userChoice ?? defaultExpanded;
  const bodyId = useId();

  const toggle = () => {
    const next = !expanded;
    setUserChoice(next);
    writeStored(id, next);
  };

  return (
    // A framed block: a thick accent edge at the inline start, a tinted header strip, and a plainly
    // padded body — so it is obvious where a section begins and where it ends (RTL-safe: inline-start).
    <Box
      sx={(theme) => {
        const accent = tone === 'neutral' ? theme.palette.text.secondary : theme.palette[tone].main;
        return {
          border: '1px solid',
          borderColor: alpha(accent, 0.35),
          borderInlineStart: `4px solid ${accent}`,
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        };
      }}
    >
      <ButtonBase
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        sx={(theme) => {
          const accent = tone === 'neutral' ? theme.palette.text.secondary : theme.palette[tone].main;
          return {
            width: '100%',
            justifyContent: 'space-between',
            textAlign: 'start',
            px: 1.5,
            py: 1,
            bgcolor: alpha(accent, theme.palette.mode === 'dark' ? 0.18 : 0.08),
            borderBottom: expanded ? '1px solid' : 'none',
            borderBottomColor: alpha(accent, 0.25),
            '&:hover': { bgcolor: alpha(accent, theme.palette.mode === 'dark' ? 0.26 : 0.14) },
            '&.Mui-focusVisible': { outline: `2px solid ${accent}`, outlineOffset: -2 },
          };
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="subtitle2" component="span" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {summary !== undefined && summary !== null && summary !== false ? (
            typeof summary === 'string' || typeof summary === 'number' ? <Chip size="small" label={summary} /> : summary
          ) : null}
        </Stack>
        <ExpandMoreIcon
          fontSize="small"
          sx={{ transition: 'transform 150ms', transform: expanded ? 'rotate(180deg)' : 'none', flexShrink: 0 }}
        />
      </ButtonBase>
      <Collapse in={expanded} unmountOnExit={false}>
        <Box id={bodyId} sx={{ p: 1.5 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}
