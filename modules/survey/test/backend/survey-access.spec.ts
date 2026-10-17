import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, jest } from '@jest/globals';
import { SURVEY_ACCESS_KEY, SurveyAccessGuard, SurveyAccessService, type SurveyAccessRule } from '../../backend/survey-access';

const USER = 'u-1';
const SURVEY = 's-1';

function setup(opts: { rule?: SurveyAccessRule; perms?: string[]; coOwner?: boolean; owner?: string; user?: boolean }) {
  const access = {
    permissionsOf: jest.fn(async () => new Set(opts.perms ?? [])),
    isCoOwner: jest.fn(async () => opts.coOwner === true),
    ownerOf: jest.fn(async () => opts.owner ?? 'someone-else'),
  } as unknown as SurveyAccessService;
  const reflector = { get: jest.fn(() => opts.rule) } as unknown as Reflector;
  const guard = new SurveyAccessGuard(reflector, access);
  const context = {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ params: { id: SURVEY }, user: opts.user === false ? undefined : { userId: USER } }) }),
  } as never;
  return { guard, context, access };
}

describe('SurveyAccessGuard', () => {
  it('lets a route without @SurveyAccess through (other guards decide)', async () => {
    const { guard, context, access } = setup({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(access.permissionsOf).not.toHaveBeenCalled();
  });

  it('allows anyone holding the permission code, without looking at the survey', async () => {
    const { guard, context, access } = setup({ rule: { code: 'survey.surveys.update', collaborator: true }, perms: ['survey.surveys.update'] });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(access.isCoOwner).not.toHaveBeenCalled();
  });

  it('allows a co-owner of THIS survey only when the route allows co-owners', async () => {
    const yes = setup({ rule: { code: 'survey.surveys.update', collaborator: true }, coOwner: true });
    await expect(yes.guard.canActivate(yes.context)).resolves.toBe(true);
    expect(yes.access.isCoOwner).toHaveBeenCalledWith(SURVEY, USER);
    const no = setup({ rule: { code: 'survey.surveys.share', owner: true }, coOwner: true });
    await expect(no.guard.canActivate(no.context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the survey creator on owner routes, nobody else without the permission', async () => {
    const creator = setup({ rule: { code: 'survey.surveys.share', owner: true }, owner: USER });
    await expect(creator.guard.canActivate(creator.context)).resolves.toBe(true);
    const stranger = setup({ rule: { code: 'survey.surveys.share', owner: true }, owner: 'other' });
    await expect(stranger.guard.canActivate(stranger.context)).rejects.toThrow('Missing required permission: survey.surveys.share');
  });

  it('refuses a stranger and a missing user with the same message the platform uses', async () => {
    const stranger = setup({ rule: { code: 'survey.surveys.update', collaborator: true }, coOwner: false });
    await expect(stranger.guard.canActivate(stranger.context)).rejects.toThrow('Missing required permission: survey.surveys.update');
    const anonymous = setup({ rule: { code: 'survey.surveys.update', collaborator: true }, user: false });
    await expect(anonymous.guard.canActivate(anonymous.context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('exposes its metadata key', () => {
    expect(SURVEY_ACCESS_KEY).toBe('surveyAccess');
  });
});

describe('SurveyAccessService.capabilities', () => {
  const service = new SurveyAccessService({ getEffectivePermissionCodes: async () => new Set() });
  const survey = { ownerUserId: 'owner' };
  it('is the union of role permissions and co-ownership; managing co-owners needs the share permission or being the creator', () => {
    expect(service.capabilities(new Set(), 'x', survey, false)).toEqual({ canEdit: false, canPublish: false, canViewResults: false, canExportResults: false, canManageOwners: false, isCoOwner: false });
    expect(service.capabilities(new Set(), 'x', survey, true)).toMatchObject({ canEdit: true, canPublish: true, canViewResults: true, canExportResults: true, canManageOwners: false, isCoOwner: true });
    expect(service.capabilities(new Set(['survey.surveys.update']), 'x', survey, false)).toMatchObject({ canEdit: true, canPublish: false });
    expect(service.capabilities(new Set(), 'owner', survey, false).canManageOwners).toBe(true);
    expect(service.capabilities(new Set(['survey.surveys.share']), 'x', survey, false).canManageOwners).toBe(true);
  });
});
