import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtSharedModule } from './jwt-shared.module';

@Module({
  // JwtSharedModule is @Global(), so importing it here (and nowhere else)
  // is what actually wires JwtService into the DI container; every other
  // module that needs JwtAuthGuard just gets it for free.
  imports: [JwtSharedModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
