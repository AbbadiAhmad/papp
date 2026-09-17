import type { ModuleRouteEntry } from '../../../apps/web/src/shared/modules/types';
import { SurveyBuilderPage } from './pages/SurveyBuilderPage';
import { SurveyReportPage } from './pages/SurveyReportPage';
import { SurveyResponsesPage } from './pages/SurveyResponsesPage';
import { SurveysListPage } from './pages/SurveysListPage';
import { TakeSurveyPage } from './pages/TakeSurveyPage';

/**
 * The module's `frontend.entry` target (manifest.json). Exports the two
 * FIXED names (`authenticatedRoutes`/`publicRoutes`) every module's own
 * routes.tsx exports — this is the contract `apps/web/src/shared/modules/
 * discovery.ts` glob-imports generically (root DECISIONS.md D78), so
 * `App.tsx` never imports this file, or names this module, directly.
 */
export const authenticatedRoutes: ModuleRouteEntry[] = [
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
export const publicRoutes: ModuleRouteEntry[] = [{ path: '/survey/:surveyId', element: <TakeSurveyPage /> }];
