import { Autocomplete, CircularProgress, TextField } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { libraryCirculationApi, type StudentSearchResult } from '../api';

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 5;

interface Props {
  value: StudentSearchResult | null;
  onChange: (student: StudentSearchResult | null) => void;
  label?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Searchable reader picker: type-ahead by code OR name, max 5 matches shown,
 * click a dropdown row to select — the Fines page's [Create Fine] dialog and
 * the Scan page's search-by-name lookup both use this exact component so the
 * two never drift into different UX for "find a reader."
 */
export function ReaderAutocomplete({ value, onChange, label, disabled, autoFocus }: Props) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<StudentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = inputValue.trim();
    if (!query) {
      // A previous run may have been cancelled mid-request (its `finally` is skipped when cancelled),
      // which left `loading` stuck on — clear it here.
      setOptions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      libraryCirculationApi
        .searchStudents(query)
        .then((results) => {
          if (!cancelled) setOptions(results.slice(0, MAX_RESULTS));
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

  const optionsWithValue = useMemo(() => {
    if (value && !options.some((o) => o.id === value.id)) return [value, ...options];
    return options;
  }, [options, value]);

  return (
    <Autocomplete
      value={value}
      onChange={(_event, selected) => onChange(selected)}
      inputValue={inputValue}
      onInputChange={(_event, newInputValue) => setInputValue(newInputValue)}
      options={optionsWithValue}
      getOptionLabel={(option) => (option.name ? `${option.name} (${option.code})` : option.code)}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      loading={loading}
      disabled={disabled}
      filterOptions={(x) => x}
      noOptionsText={inputValue.trim() ? t('library_circulation.reader_picker.no_matches') : t('library_circulation.reader_picker.type_to_search')}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? t('library_circulation.reader_picker.label')}
          autoFocus={autoFocus}
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
