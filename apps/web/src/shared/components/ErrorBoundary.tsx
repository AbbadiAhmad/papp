import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches a render crash anywhere under `<AppRoutes/>` (App.tsx) instead of
 * letting React unmount the whole tree to a blank white page — the reported
 * symptom was exactly that: a page "crashes, there is nothing in it", with
 * no way to read the actual error on a phone (no attached devtools). The
 * fallback renders the real `error.message`/stack directly on screen so the
 * next crash is self-diagnosing on any device, not just desktop-with-
 * devtools. `TopBar` stays mounted (this boundary wraps `<AppRoutes/>`, not
 * the whole shell — see App.tsx's `ThemedShell`), so the user can still
 * navigate away.
 *
 * Not translated/i18n-keyed on purpose: this is a last-resort developer
 * diagnostic surface, not a product page — the one normal-looking line
 * above it still goes through `t()`.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error('RouteErrorBoundary caught a render error:', error, info.componentStack);
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <Box sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Alert severity="error">This page crashed. The technical details below are shown so the error can be read without devtools (e.g. on a phone).</Alert>
          <Button variant="contained" onClick={() => window.location.reload()} sx={{ alignSelf: 'flex-start' }}>
            Reload
          </Button>
          {/*
           * `style` (a real DOM attribute), not `sx` — this app's emotion
           * cache mirrors every `sx`-generated directional CSS declaration
           * (stylis-plugin-rtl, see PageLayout.tsx's own docblock) once the
           * active language is Arabic, which would flip `textAlign: 'left'`
           * straight back to `right` and defeat the point of a raw,
           * always-LTR stack trace. A plain `style` prop never goes through
           * that pipeline.
           */}
          <Box
            component="pre"
            style={{ direction: 'ltr', textAlign: 'left' }}
            sx={{
              m: 0,
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              borderRadius: 1,
              overflow: 'auto',
              fontSize: 12,
            }}
          >
            <Typography component="code" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {error.name}: {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
              {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
            </Typography>
          </Box>
        </Stack>
      </Box>
    );
  }
}
