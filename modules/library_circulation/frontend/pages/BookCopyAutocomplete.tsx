import { Autocomplete, CircularProgress, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { libraryCirculationApi, type BookCopySearchResult } from '../api';

const DEBOUNCE_MS = 250;

interface Props {
  onPick: (copy: BookCopySearchResult) => void;
  disabled?: boolean;
}

/**
 * Type-ahead book picker for the Scan page: by title, author or copy code,
 * one dropdown row per physical copy (title, author, copy code, status).
 * The pick behaves exactly like scanning that copy's code, so availability,
 * on-loan-returns and duplicates are handled in one place by the page.
 */
export function BookCopyAutocomplete({ onPick, disabled }: Props) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<BookCopySearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = inputValue.trim();
    if (!query) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      libraryCirculationApi
        .searchBookCopies(query)
        .then((results) => {
          if (!cancelled) setOptions(results);
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setLoading(false);
    };
  }, [inputValue]);

  return (
    <Autocomplete<BookCopySearchResult, false, false, false>
      value={null}
      // Keep the typed text after a pick? No — clear it so the next search starts fresh.
      inputValue={inputValue}
      onInputChange={(_event, value, reason) => setInputValue(reason === 'reset' ? '' : value)}
      onChange={(_event, selected) => {
        if (selected) onPick(selected);
      }}
      options={options}
      getOptionLabel={(option) => `${option.title} (${option.qrCode})`}
      getOptionKey={(option) => option.copyId}
      isOptionEqualToValue={(option, selected) => option.copyId === selected.copyId}
      filterOptions={(x) => x}
      loading={loading}
      disabled={disabled}
      noOptionsText={inputValue.trim() ? t('library_circulation.book_picker.no_matches') : t('library_circulation.book_picker.type_to_search')}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest}>
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
              <span>{option.title}</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                {[option.author, option.qrCode, t(`library_circulation.book_picker.status_${option.status}`, option.status)].filter(Boolean).join(' · ')}
              </span>
            </div>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={t('library_circulation.book_picker.label')}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
