import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  CancelProductReviewDto,
  CreateProductReviewDto,
  DecideProductReviewDto,
  PrepareProductReviewDto,
  ProductReviewListQueryDto,
  ProductReviewTrendQueryDto,
} from '../application/dto/product-review-request.dto.js';
import {
  ProductReviewDetailResponseDto,
  ProductReviewParticipantResponseDto,
  ProductReviewSummaryResponseDto,
  ProductReviewTrendSnapshotDto,
} from '../application/dto/product-review-response.dto.js';
import { ProductReviewsService } from '../application/product-reviews.service.js';

@ApiTags('Product quality reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('product-reviews')
export class ProductReviewsController {
  constructor(private readonly productReviews: ProductReviewsService) {}

  @Get()
  @Permissions('product_reviews.read')
  @ApiOkResponse({ type: ProductReviewSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ProductReviewListQueryDto,
  ): Promise<ProductReviewSummaryResponseDto[]> {
    return this.productReviews.list(principal, query);
  }

  @Get('participants')
  @Permissions('product_reviews.read')
  @ApiOkResponse({ type: ProductReviewParticipantResponseDto, isArray: true })
  participants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ProductReviewParticipantResponseDto[]> {
    return this.productReviews.listParticipants(principal);
  }

  @Get('trend-preview')
  @Permissions('product_reviews.read')
  @ApiOkResponse({ type: ProductReviewTrendSnapshotDto })
  trendPreview(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ProductReviewTrendQueryDto,
  ): Promise<ProductReviewTrendSnapshotDto> {
    return this.productReviews.trendPreview(principal, query);
  }

  @Get(':reviewId')
  @Permissions('product_reviews.read')
  @ApiOkResponse({ type: ProductReviewDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('reviewId', new ParseUUIDPipe()) reviewId: string,
  ): Promise<ProductReviewDetailResponseDto> {
    return this.productReviews.get(principal, reviewId);
  }

  @Post()
  @Permissions('product_reviews.create')
  @ApiCreatedResponse({ type: ProductReviewDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateProductReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ProductReviewDetailResponseDto> {
    return this.productReviews.create(
      principal,
      input,
      requestMetadata(request),
    );
  }

  @Post(':reviewId/assessment')
  @Permissions('product_reviews.prepare')
  @ApiCreatedResponse({ type: ProductReviewDetailResponseDto })
  prepare(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('reviewId', new ParseUUIDPipe()) reviewId: string,
    @Body() input: PrepareProductReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ProductReviewDetailResponseDto> {
    return this.productReviews.prepare(
      principal,
      reviewId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':reviewId/decision')
  @Permissions('product_reviews.approve')
  @ApiCreatedResponse({ type: ProductReviewDetailResponseDto })
  decide(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('reviewId', new ParseUUIDPipe()) reviewId: string,
    @Body() input: DecideProductReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ProductReviewDetailResponseDto> {
    return this.productReviews.decide(
      principal,
      reviewId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':reviewId/cancellation')
  @Permissions('product_reviews.cancel')
  @ApiCreatedResponse({ type: ProductReviewDetailResponseDto })
  cancel(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('reviewId', new ParseUUIDPipe()) reviewId: string,
    @Body() input: CancelProductReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ProductReviewDetailResponseDto> {
    return this.productReviews.cancel(
      principal,
      reviewId,
      input,
      requestMetadata(request),
    );
  }
}

function requestMetadata(
  request: Request & RequestWithContext,
): RequestMetadata {
  return {
    correlationId: request.correlationId,
    ipAddress: request.ip,
    userAgent: request.header('user-agent'),
  };
}
