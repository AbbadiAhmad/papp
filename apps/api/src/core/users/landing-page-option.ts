/**
 * One entry `GET /users/me/landing-page-options` offers the caller:
 * the platform default (`value: null`) plus every installed module whose
 * `frontend.landingPage` route the caller currently has permission to view.
 */
export interface LandingPageOption {
  value: string | null;
  labelKey: string;
  moduleKey: string | null;
}
