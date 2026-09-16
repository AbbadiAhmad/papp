import type { ReactNode } from 'react';
import { SurveyBuilderPage } from './pages/SurveyBuilderPage';
import { SurveyReportPage } from './pages/SurveyReportPage';
import { SurveyResponsesPage } from './pages/SurveyResponsesPage';
import { SurveysListPage } from './pages/SurveysListPage';
import { TakeSurveyPage } from './pages/TakeSurveyPage';

/**
 * The module's `frontend.entry` target (manifest.json) — see
 * modules/library_catalog/frontend/routes.tsx's own docblock for why this
 * is a static import from apps/web/src/App.tsx rather than something
 * dynamically loaded (no module-federation-style mechanism exists yet).
 */
export interface ModuleRouteEntry {
  path: string;
  element: ReactNode;
}

export const AUTHENTICATED_SURVEY_ROUTES: ModuleRouteEntry[] = [
  { path: '/survey/surveys', element: <SurveysListPage /> },
  { path: '/survey/surveys/:surveyId/edit', element: <SurveyBuilderPage /> },
  { path: '/survey/surveys/:surveyId/responses', element: <SurveyResponsesPage /> },
  { path: '/survey/surveys/:surveyId/report', element: <SurveyReportPage /> },
];

/**
 * Public AND reachable from every auth-status branch (docs/DECISIONS.md's
 * two-endpoint fill/submit split; manifest.json's own `/survey/:surveyId`
 * route entry) — `TakeSurveyPage` itself picks which endpoint pair to call
 * based on the real `useAuth()` status, never a route-level split.
 */
export const PUBLIC_SURVEY_ROUTES: ModuleRouteEntry[] = [{ path: '/survey/:surveyId', element: <TakeSurveyPage /> }];
