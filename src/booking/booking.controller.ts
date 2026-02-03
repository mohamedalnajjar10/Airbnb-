import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) { }

  @Post('checkout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiBody({ type: CreateBookingDto })
  async createCheckout(@Body() dto: CreateBookingDto, @Req() req: any) {
    const userId: string | undefined = req?.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.bookingService.createCheckoutSession(userId, dto);
  }

  /**
   * Stripe Webhook
   * NOTE: main.ts sets express.raw() only for this path, so req.body is Buffer here.
   */
  @Post('webhook')
  async stripeWebhook(@Req() req: any, @Headers('stripe-signature') sig: string) {
    console.log('>>> WEBHOOK HIT', new Date().toISOString());
    console.log('>>> stripe-signature exists?', !!sig);
    console.log('>>> content-type:', req.headers['content-type']);

    const rawBody: Buffer = req.body;
    console.log('>>> rawBody is Buffer?', Buffer.isBuffer(rawBody), 'len=', rawBody?.length);

    if (!Buffer.isBuffer(rawBody)) throw new BadRequestException('Body is not Buffer (raw)');
    if (!sig) throw new BadRequestException('Missing stripe-signature');

    return this.bookingService.handleStripeWebhook(rawBody, sig);
  }

  // Redirect pages (temporary)
  @Get('success')
  success(@Query('session_id') sessionId: string) {
    return {
      ok: true,
      message: 'Payment success redirect',
      sessionId,
    };
  }

  @Get('cancel')
  cancel() {
    return {
      ok: false,
      message: 'Payment cancelled',
    };
  }

  /**
   * DEBUG: shows current DATABASE_URL the app uses
   * Remove after debugging
   */
  @Get('debug/db')
  debugDb() {
    return {
      DATABASE_URL: process.env.DATABASE_URL,
      APP_BASE_URL: process.env.APP_BASE_URL,
      API_PREFIX: process.env.API_PREFIX,
    };
  }

  /**
   * DEBUG: check payment by session id quickly
   * Example:
   *  GET /api/v1/bookings/debug/payment?sessionId=cs_test_...
   */
  @Get('debug/payment')
  async debugPayment(@Query('sessionId') sessionId: string) {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.bookingService.debugFindPaymentBySessionId(sessionId);
  }
}
