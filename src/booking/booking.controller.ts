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

  // Stripe Checkout
  @Post('checkout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiBody({ type: CreateBookingDto })
  async createCheckout(@Body() dto: CreateBookingDto, @Req() req: any) {
    const userId: string | undefined = req?.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.bookingService.createCheckoutSession(userId, dto);
  }


  //Stripe Webhook

  @Post('webhook')
  async stripeWebhook(@Req() req: any, @Headers('stripe-signature') sig: string) {
    const rawBody: Buffer = req.body;

    if (!Buffer.isBuffer(rawBody)) throw new BadRequestException('Body is not Buffer (raw)');
    if (!sig) throw new BadRequestException('Missing stripe-signature');

    return this.bookingService.handleStripeWebhook(rawBody, sig);
  }

  // Stripe Redirect pages (temporary)
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

  // PayPal Checkout
  @Post('paypal/checkout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiBody({ type: CreateBookingDto })
  async createPaypalCheckout(@Body() dto: CreateBookingDto, @Req() req: any) {
    const userId: string | undefined = req?.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.bookingService.createPaypalOrder(userId, dto);
  }

  // Optional: capture endpoint (if your client captures after approve)
  @Post('paypal/capture')
  async capturePaypal(@Body() body: { orderId: string }) {
    if (!body?.orderId) throw new BadRequestException('orderId is required');
    return this.bookingService.capturePaypalOrder(body.orderId);
  }


  //PayPal Webhook

  @Post('paypal/webhook')
  async paypalWebhook(@Req() req: any) {
    const rawBody: Buffer = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Body is not Buffer (raw)');
    }

    return this.bookingService.handlePaypalWebhook(rawBody, req.headers);
  }

  // PayPal redirect pages (optional)
  @Get('paypal/success')
  paypalSuccess() {
    return { ok: true, message: 'PayPal success redirect' };
  }

  @Get('paypal/cancel')
  paypalCancel() {
    return { ok: false, message: 'PayPal cancelled' };
  }

  // DEBUG endpoints (unchanged)
  @Get('debug/db')
  debugDb() {
    return {
      DATABASE_URL: process.env.DATABASE_URL,
      APP_BASE_URL: process.env.APP_BASE_URL,
      API_PREFIX: process.env.API_PREFIX,
    };
  }

  @Get('debug/payment')
  async debugPayment(@Query('sessionId') sessionId: string) {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.bookingService.debugFindPaymentBySessionId(sessionId);
  }
}