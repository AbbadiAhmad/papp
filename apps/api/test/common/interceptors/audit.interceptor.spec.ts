import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { lastValueFrom, of } from 'rxjs';
import { AUDIT_KEY, AuditMetadata } from '../../../src/common/decorators/audit.decorator';
import { AuditInterceptor } from '../../../src/common/interceptors/audit.interceptor';

interface MockReflector {
  getAllAndOverride: jest.Mock;
}

interface MockWriter {
  write: jest.Mock;
}

function createContext(request: Record<string, unknown>, type: string = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function createRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: 'PATCH',
    url: '/users/user-9',
    params: { id: 'user-9' },
    ip: '203.0.113.9',
    headers: { 'user-agent': 'jest-agent/1.0' },
    user: { userId: 'actor-1', sessionId: 'sess-1', email: 'a@example.com', mustChangePassword: false },
    ...overrides,
  };
}

function createNext(body: unknown, onCall?: () => void): CallHandler {
  return {
    handle: jest.fn(() => {
      onCall?.();
      return of(body);
    }),
  } as unknown as CallHandler;
}

describe('AuditInterceptor', () => {
  let reflector: MockReflector;
  let writer: MockWriter;
  let interceptor: AuditInterceptor;
  const prisma = { marker: 'mock-prisma' };

  /** Reflector answering AUDIT_KEY and 'isPublic' lookups independently. */
  function stubMetadata(metadata: AuditMetadata | undefined, isPublic?: boolean): void {
    reflector.getAllAndOverride.mockImplementation((key: unknown) => {
      if (key === AUDIT_KEY) return metadata;
      if (key === 'isPublic') return isPublic;
      return undefined;
    });
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    reflector = { getAllAndOverride: jest.fn() };
    writer = { write: jest.fn(async () => undefined) };
    interceptor = new AuditInterceptor(reflector as never, prisma as never, writer as never);
  });

  it('passes the response straight through and never writes when the handler has no @Audit metadata', async () => {
    stubMetadata(undefined);
    const next = createNext({ ok: true });

    const result = await lastValueFrom(interceptor.intercept(createContext(createRequest()), next));

    expect(result).toEqual({ ok: true });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('passes through untouched for a non-http context even with metadata present', async () => {
    stubMetadata({ category: 'core.users', entityType: 'User', action: 'update' });
    const next = createNext({ ok: true });

    const result = await lastValueFrom(interceptor.intercept(createContext(createRequest(), 'rpc'), next));

    expect(result).toEqual({ ok: true });
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('writes a user-actor row with metadata fields, old/new state and request ip/user-agent', async () => {
    const events: string[] = [];
    let fetchCalls = 0;
    const oldEntity = { id: 'user-9', name: 'Before', passwordHash: 'raw-hash' };
    const newEntity = { id: 'user-9', name: 'After', passwordHash: 'raw-hash-2' };
    stubMetadata({
      category: 'core.users',
      entityType: 'User',
      action: 'update',
      fetchState: async (prismaArg) => {
        fetchCalls += 1;
        const phase = fetchCalls === 1 ? 'before' : 'after';
        events.push(`fetch:${phase}:start`);
        expect(prismaArg).toBe(prisma as never);
        // Real async gap: if the interceptor did not await the before-fetch,
        // the handler would run before this resolves.
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`fetch:${phase}:resolved`);
        return phase === 'before' ? oldEntity : newEntity;
      },
    });
    const next = createNext({ id: 'user-9', name: 'After' }, () => events.push('handler'));

    const result = await lastValueFrom(interceptor.intercept(createContext(createRequest()), next));

    expect(result).toEqual({ id: 'user-9', name: 'After' });
    // Ordering contract: the old-state fetch RESOLVES before the handler is
    // subscribed, and the new-state fetch runs only after the handler.
    expect(events).toEqual([
      'fetch:before:start',
      'fetch:before:resolved',
      'handler',
      'fetch:after:start',
      'fetch:after:resolved',
    ]);
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith({
      actorType: 'user',
      actorUserId: 'actor-1',
      actorSessionId: 'sess-1',
      category: 'core.users',
      entityType: 'User',
      entityId: 'user-9',
      action: 'update',
      oldValue: oldEntity,
      newValue: newEntity,
      ipAddress: '203.0.113.9',
      userAgent: 'jest-agent/1.0',
    });
  });

  it("skips the old-state fetch for 'create' and resolves entityId from the response body", async () => {
    const fetchPhases: string[] = [];
    let calls = 0;
    stubMetadata({
      category: 'core.users',
      entityType: 'User',
      action: 'create',
      fetchState: async () => {
        calls += 1;
        fetchPhases.push(`call-${calls}`);
        return { id: 'new-user', name: 'Created' };
      },
    });
    const request = createRequest({ params: {} });
    const next = createNext({ id: 'new-user', name: 'Created' });

    await lastValueFrom(interceptor.intercept(createContext(request), next));

    // Only ONE fetchState call — the after-handler one.
    expect(fetchPhases).toEqual(['call-1']);
    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', oldValue: null, newValue: { id: 'new-user', name: 'Created' }, entityId: 'new-user' }),
    );
  });

  it("skips the new-state fetch for 'delete' (newValue null, old state captured)", async () => {
    let calls = 0;
    stubMetadata({
      category: 'core.roles',
      entityType: 'Role',
      action: 'delete',
      fetchState: async () => {
        calls += 1;
        return { id: 'user-9', name: 'Doomed' };
      },
    });
    const next = createNext({ deleted: true });

    await lastValueFrom(interceptor.intercept(createContext(createRequest()), next));

    // Only ONE fetchState call — the before-handler one.
    expect(calls).toBe(1);
    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', oldValue: { id: 'user-9', name: 'Doomed' }, newValue: null }),
    );
  });

  it('falls back to the response body as newValue when no fetchState is supplied', async () => {
    stubMetadata({ category: 'core.users', entityType: 'User', action: 'update' });
    const next = createNext({ id: 'user-9', name: 'From response' });

    await lastValueFrom(interceptor.intercept(createContext(createRequest()), next));

    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ oldValue: null, newValue: { id: 'user-9', name: 'From response' } }),
    );
  });

  it("writes actorType 'anonymous' with null ids when there is no user but the route is @Public", async () => {
    stubMetadata({ category: 'library.loans', entityType: 'Loan', action: 'create' }, true);
    const request = createRequest({ user: undefined, params: {} });
    const next = createNext({ id: 'loan-1' });

    await lastValueFrom(interceptor.intercept(createContext(request), next));

    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'anonymous',
        actorUserId: null,
        actorSessionId: null,
        ipAddress: '203.0.113.9',
        userAgent: 'jest-agent/1.0',
      }),
    );
  });

  it('writes NO row and logs loudly when there is no user and the route is NOT public (wiring bug)', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    stubMetadata({ category: 'core.users', entityType: 'User', action: 'update' }, undefined);
    const request = createRequest({ user: undefined });
    const next = createNext({ ok: true });

    const result = await lastValueFrom(interceptor.intercept(createContext(request), next));

    // The action itself still succeeds — but nothing is audited and the bug
    // is loudly logged ('system' is never inferred from an HTTP request).
    expect(result).toEqual({ ok: true });
    expect(writer.write).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('JwtAuthGuard is missing'));
  });

  it('still delivers the response when the audit write itself fails', async () => {
    stubMetadata({ category: 'core.users', entityType: 'User', action: 'update' });
    writer.write.mockImplementation(async () => {
      throw new Error('audit backend down');
    });
    const next = createNext({ ok: true });

    const result = await lastValueFrom(interceptor.intercept(createContext(createRequest()), next));

    expect(result).toEqual({ ok: true });
    expect(writer.write).toHaveBeenCalledTimes(1);
  });

  it('records null old value (not a crash) when the before fetchState throws', async () => {
    let calls = 0;
    stubMetadata({
      category: 'core.users',
      entityType: 'User',
      action: 'update',
      fetchState: async () => {
        calls += 1;
        if (calls === 1) throw new Error('entity lookup exploded');
        return { id: 'user-9', name: 'After' };
      },
    });
    const next = createNext({ ok: true });

    const result = await lastValueFrom(interceptor.intercept(createContext(createRequest()), next));

    expect(result).toEqual({ ok: true });
    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ oldValue: null, newValue: { id: 'user-9', name: 'After' } }),
    );
  });
});
