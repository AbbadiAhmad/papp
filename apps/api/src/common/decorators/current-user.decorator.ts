import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The shape JwtAuthGuard attaches to `request.user` once it has validated
 * the access token and confirmed the session it names is still live.
 */
export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  email: string;
  mustChangePassword: boolean;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user as AuthenticatedUser;
});
