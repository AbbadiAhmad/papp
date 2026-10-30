import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { JwtSharedModule } from './jwt-shared.module';

@Module({
  // JwtSharedModule is @Global(), so importing it here (and nowhere else)
  // is what actually wires JwtService into the DI container; every other
  // module that needs JwtAuthGuard just gets it for free.
  imports: [JwtSharedModule, NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService],
  exports: [AuthService],
})
export class AuthModule {}
