import type { ReactNode } from 'react';
import { usePermission } from '../../../../apps/web/src/shared/permissions';

/**
 * Shows its children when the user holds the permission (any survey) OR the per-survey rule allows it
 * (co-owner, SURVEY-D21). The server enforces the same rule on every route; this only shapes the UI.
 */
export function Allowed({ permission, orSurvey, children }: { permission: string; orSurvey?: boolean; children: ReactNode }): ReactNode {
  const held = usePermission(permission);
  return held || orSurvey ? children : null;
}
