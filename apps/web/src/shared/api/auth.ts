import { apiClient, setAccessToken } from './httpClient';

export interface LoginResponse {
  accessToken: string;
}

/** POST /auth/login — sets the refresh cookie server-side; caller stores the access token in memory. */
export async function login(email: string, password: string): Promise<string> {
  const response = await apiClient.post<LoginResponse>('/auth/login', { email, password });
  setAccessToken(response.data.accessToken);
  return response.data.accessToken;
}

/** POST /auth/logout — revokes the current session server-side; caller clears local state regardless of outcome. */
export async function logout(): Promise<void> {
  try {
    await apiClient.post('/auth/logout');
  } finally {
    setAccessToken(null);
  }
}

export async function forcePasswordChange(newPassword: string): Promise<void> {
  await apiClient.post('/auth/force-password-change', { newPassword });
}

export interface SetupStatus {
  setupNeeded: boolean;
}

/** GET /auth/setup-status — @Public(), no auth. Polled before routing to SetupPage vs LoginPage. */
export async function getSetupStatus(): Promise<SetupStatus> {
  const response = await apiClient.get<SetupStatus>('/auth/setup-status');
  return response.data;
}

/** POST /auth/setup — @Public(), no auth. Creates the first (admin) account; the server rejects this once any user exists. */
export async function createFirstAdmin(email: string, name: string, password: string): Promise<void> {
  await apiClient.post('/auth/setup', { email, name, password });
}
