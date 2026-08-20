import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module.js';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ProductReviewsService } from './application/product-reviews.service.js';
import { ProductReviewsController } from './presentation/product-reviews.controller.js';

@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    CryptoModule,
    PrismaModule,
  ],
  controllers: [ProductReviewsController],
  providers: [ProductReviewsService],
})
export class ProductReviewsModule {}
