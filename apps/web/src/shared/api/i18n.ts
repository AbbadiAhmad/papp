import axios from 'axios';
import { API_BASE_URL } from './httpClient';

export interface I18nBundle {
  lang: string;
  direction: 'rtl' | 'ltr';
  messages: Record<string, string>;
}

/**
 * `GET /i18n/:lang` is `@Public()` (I18nController) — called with a bare
 * axios request (not `apiClient`) since it must work before any session
 * exists and must never trigger the 401-refresh-retry dance.
 */
export async function fetchI18nBundle(lang: string): Promise<I18nBundle> {
  const response = await axios.get<I18nBundle>(`${API_BASE_URL}/i18n/${lang}`);
  return response.data;
}
