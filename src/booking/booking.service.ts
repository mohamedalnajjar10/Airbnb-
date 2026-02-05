import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'Prisma/prisma.service';
import Stripe from 'stripe';
import * as paypal from '@paypal/checkout-server-sdk';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Stripe currency (you used egp)
const STRIPE_CURRENCY = 'egp' as const;

// PayPal currency NOTE: PayPal often doesn't support EGP capture.
// Change to what your PayPal account supports (commonly USD/EUR/GBP).
const PAYPAL_CURRENCY = 'USD' as const;

@Injectable()
export class BookingService {
  private readonly stripe: Stripe;
  private readonly paypalClient: paypal.core.PayPalHttpClient;

  private readonly logger = new Logger(BookingService.name);
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    // Stripe init 
    const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not set in env');
    this.stripe = new Stripe(stripeKey);

    //  Base URL
    const appBaseUrl = this.config.get<string>('APP_BASE_URL');
    if (!appBaseUrl) throw new Error('APP_BASE_URL not set in env');
    this.appBaseUrl = appBaseUrl;

    // PayPal init 
    const paypalClientId = this.config.get<string>('PAYPAL_CLIENT_ID');
    const paypalClientSecret = this.config.get<string>('PAYPAL_CLIENT_SECRET');
    const paypalEnv = this.config.get<string>('PAYPAL_ENV') ?? 'sandbox';

    if (!paypalClientId) throw new Error('PAYPAL_CLIENT_ID not set in env');
    if (!paypalClientSecret) throw new Error('PAYPAL_CLIENT_SECRET not set in env');

    const environment =
      paypalEnv === 'live'
        ? new paypal.core.LiveEnvironment(paypalClientId, paypalClientSecret)
        : new paypal.core.SandboxEnvironment(paypalClientId, paypalClientSecret);

    this.paypalClient = new paypal.core.PayPalHttpClient(environment);
  }

  // Stripe: Create Checkout Session
  async createCheckoutSession(userId: string, dto: CreateBookingDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const { start, end, nights } = this.parseAndValidateBookingDates(
      dto.startDate,
      dto.endDate,
    );

    const unitAmountCents = this.decimalToCents(listing.price);
    if (unitAmountCents <= 0) {
      throw new BadRequestException('Invalid listing price');
    }

    try {
      // 1) Create Stripe Checkout Session
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: STRIPE_CURRENCY,
              product_data: {
                name: listing.title,
                description: listing.description ?? undefined,
                metadata: { listingId: listing.id },
              },
              unit_amount: unitAmountCents,
            },
            quantity: nights,
          },
        ],
        metadata: {
          listingId: listing.id,
          userId,
          startDate: dto.startDate,
          endDate: dto.endDate,
        },
        success_url: `${this.appBaseUrl}/api/v1/bookings/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.appBaseUrl}/api/v1/bookings/cancel`,
      });

      this.logger.log(`Created checkout session: ${session.id}`);

      const totalAmountCents = unitAmountCents * nights;
      const totalAmountDecimal = new Prisma.Decimal(totalAmountCents).div(100);

      // 2) Create Booking + Payment in DB
      const result = await this.prisma.$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: {
            userId,
            listingId: listing.id,
            startDate: start,
            endDate: end,
            status: BookingStatus.PENDING,
            totalPrice: totalAmountDecimal,
          },
        });

        const payment = await tx.payment.create({
          data: {
            bookingId: booking.id,
            amount: totalAmountDecimal,
            currency: STRIPE_CURRENCY,
            status: PaymentStatus.PENDING,
            paymentMethod: PaymentMethod.STRIPE,

            stripePaymentId: session.id,
            stripeClientSecret: null,
            metadata: { checkoutSessionId: session.id },
          },
        });

        this.logger.log(
          `DB saved Stripe payment: paymentId=${payment.id} stripePaymentId=${payment.stripePaymentId} bookingId=${booking.id}`,
        );

        return booking;
      });

      return { url: session.url, id: session.id, bookingId: result.id };
    } catch (err) {
      this.logUnexpectedError('Stripe checkout session failed', err, { userId });
      if (err instanceof Stripe.errors.StripeError) {
        throw new BadRequestException('Payment provider error');
      }
      throw new InternalServerErrorException(
        'Checkout session creation failed. Please try again later.',
      );
    }
  }

  // Stripe: Webhook handler
  async handleStripeWebhook(rawBody: Buffer, sigHeader: string) {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set in env');

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        sigHeader,
        webhookSecret,
      );
    } catch (e) {
      this.logger.error('Stripe signature verification failed', e as any);
      throw new BadRequestException('Invalid Stripe signature');
    }

    this.logger.log(`Stripe webhook received: ${event.type}`);

    if (event.type !== 'checkout.session.completed') {
      return { received: true };
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const checkoutSessionId = session.id;

    this.logger.log(`checkout.session.completed session.id=${checkoutSessionId}`);

    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { stripePaymentId: checkoutSessionId },
      });

      if (!payment) {
        this.logger.warn(`Payment not found for session ${checkoutSessionId}`);
        return;
      }

      const booking = await tx.booking.findUnique({
        where: { id: payment.bookingId },
      });

      if (!booking) {
        this.logger.warn(`Booking not found for payment ${payment.id}`);
        return;
      }

      if (payment.status === PaymentStatus.SUCCEEDED) {
        this.logger.log(`Payment already succeeded: paymentId=${payment.id}`);
        return;
      }
      // Compute nights/dates from booking in DB
      const startUtc = new Date(
        Date.UTC(
          booking.startDate.getUTCFullYear(),
          booking.startDate.getUTCMonth(),
          booking.startDate.getUTCDate(),
        ),
      );

      const endUtc = new Date(
        Date.UTC(
          booking.endDate.getUTCFullYear(),
          booking.endDate.getUTCMonth(),
          booking.endDate.getUTCDate(),
        ),
      );

      const nights = Math.floor(
        (endUtc.getTime() - startUtc.getTime()) / MS_PER_DAY,
      );

      const datesToBook = this.expandDatesUtcMidnight(startUtc, nights);

      // Prevent double booking
      for (const date of datesToBook) {
        const existing = await tx.calendarItem.findUnique({
          where: { listingId_date: { listingId: booking.listingId, date } },
        });
        if (existing?.isBooked) {
          throw new BadRequestException('Some dates are already booked');
        }
      }

      for (const date of datesToBook) {
        await tx.calendarItem.upsert({
          where: { listingId_date: { listingId: booking.listingId, date } },
          create: { listingId: booking.listingId, date, isBooked: true },
          update: { isBooked: true },
        });
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.CONFIRMED },
      });

      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : (session.payment_intent as any)?.id;

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          metadata: {
            ...(payment.metadata as any),
            checkoutSessionId,
            paymentIntentId: paymentIntentId ?? null,
          },
        },
      });

      this.logger.log(
        `Stripe payment updated to SUCCEEDED: paymentId=${payment.id} bookingId=${booking.id}`,
      );
    });

    return { received: true };
  }

  // PayPal: Create Order (Checkout)
  async createPaypalOrder(userId: string, dto: CreateBookingDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const { start, end, nights } = this.parseAndValidateBookingDates(
      dto.startDate,
      dto.endDate,
    );

    const unitAmountCents = this.decimalToCents(listing.price);
    if (unitAmountCents <= 0) throw new BadRequestException('Invalid listing price');

    const totalAmountDecimal = new Prisma.Decimal(unitAmountCents)
      .mul(nights)
      .div(100);

    const amountString = totalAmountDecimal.toFixed(2);

    try {
      // 1) Create Booking + Payment in DB first
      const { booking, payment } = await this.prisma.$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: {
            userId,
            listingId: listing.id,
            startDate: start,
            endDate: end,
            status: BookingStatus.PENDING,
            totalPrice: totalAmountDecimal,
          },
        });

        const payment = await tx.payment.create({
          data: {
            bookingId: booking.id,
            amount: totalAmountDecimal,
            currency: PAYPAL_CURRENCY.toLowerCase(),
            status: PaymentStatus.PENDING,
            paymentMethod: PaymentMethod.PAYPAL,
            metadata: {
              listingId: listing.id,
              userId,
              startDate: dto.startDate,
              endDate: dto.endDate,
            },
          },
        });

        return { booking, payment };
      });

      // 2) Create PayPal Order (intent CAPTURE)
      const request = new paypal.orders.OrdersCreateRequest();
      request.prefer('return=representation');
      request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: booking.id,
            description: listing.title,
            amount: {
              currency_code: PAYPAL_CURRENCY,
              value: amountString,
            },
          },
        ],
        application_context: {
          return_url: `${this.appBaseUrl}/api/v1/bookings/paypal/success`,
          cancel_url: `${this.appBaseUrl}/api/v1/bookings/paypal/cancel`,
        },
      });

      const res = await this.paypalClient.execute(request);
      const order = res.result;

      const approveLink = order.links?.find((l: any) => l.rel === 'approve')?.href;

      // 3) Save paypalOrderId in DB
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paypalOrderId: order.id, 
          metadata: {
            ...(payment.metadata as any),
            paypalOrderId: order.id,
          },
        },
      });

      this.logger.log(
        `Created PayPal order: orderId=${order.id} paymentId=${payment.id} bookingId=${booking.id}`,
      );

      return {
        orderId: order.id,
        approveLink,
        bookingId: booking.id,
      };
    } catch (err) {
      this.logUnexpectedError('PayPal create order failed', err, { userId });
      throw new InternalServerErrorException(
        'PayPal order creation failed. Please try again later.',
      );
    }
  }

  // Optional: if your frontend calls capture after approval
  async capturePaypalOrder(orderId: string) {
    try {
      const request = new paypal.orders.OrdersCaptureRequest(orderId);
      request.requestBody({});
      const res = await this.paypalClient.execute(request);
      return res.result;
    } catch (err) {
      this.logUnexpectedError('PayPal capture failed', err, { orderId });
      throw new BadRequestException('PayPal capture failed');
    }
  }

  // PayPal: Webhook handler (signature verification + DB updates)
  async handlePaypalWebhook(rawBody: Buffer, headers: Record<string, any>) {
    const webhookId = this.config.get<string>('PAYPAL_WEBHOOK_ID');
    if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID not set in env');

    let event: any;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid JSON body');
    }

    // PayPal verification headers
    const transmissionId = headers['paypal-transmission-id'];
    const transmissionTime = headers['paypal-transmission-time'];
    const certUrl = headers['paypal-cert-url'];
    const authAlgo = headers['paypal-auth-algo'];
    const transmissionSig = headers['paypal-transmission-sig'];

    if (
      !transmissionId ||
      !transmissionTime ||
      !certUrl ||
      !authAlgo ||
      !transmissionSig
    ) {
      throw new BadRequestException('Missing PayPal verification headers');
    }

    // Verify webhook signature by calling PayPal
    const verifyReq = new paypal.core.PayPalHttpRequest(
      '/v1/notifications/verify-webhook-signature',
      'POST',
    );
    verifyReq.headers['Content-Type'] = 'application/json';
    verifyReq.body = {
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: webhookId,
      webhook_event: event,
    };

    const verifyRes = await this.paypalClient.execute(verifyReq);
    const verificationStatus = verifyRes.result?.verification_status;

    if (verificationStatus !== 'SUCCESS') {
      this.logger.warn(`PayPal webhook signature invalid: ${verificationStatus}`);
      throw new BadRequestException('Invalid PayPal signature');
    }

    this.logger.log(`PayPal webhook received: ${event.event_type} id=${event.id}`);

    // We only "confirm" booking after capture completed
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      return { received: true };
    }

    const capture = event.resource;
    const captureId: string | undefined = capture?.id;

    const relatedOrderId: string | undefined =
      capture?.supplementary_data?.related_ids?.order_id;

    if (!relatedOrderId) {
      this.logger.warn('PAYMENT.CAPTURE.COMPLETED missing related order id');
      return { received: true };
    }

    const amountValue: string | undefined = capture?.amount?.value;
    const currencyCode: string | undefined = capture?.amount?.currency_code;

    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          paymentMethod: PaymentMethod.PAYPAL,
          paypalOrderId: relatedOrderId,
        },
      });

      if (!payment) {
        this.logger.warn(`Payment not found for paypalOrderId=${relatedOrderId}`);
        return;
      }

      const booking = await tx.booking.findUnique({
        where: { id: payment.bookingId },
      });

      if (!booking) {
        this.logger.warn(`Booking not found for paymentId=${payment.id}`);
        return;
      }

      if (payment.status === PaymentStatus.SUCCEEDED) {
        this.logger.log(`PayPal payment already succeeded: paymentId=${payment.id}`);
        return;
      }

      // Validate amount/currency if provided
      if (amountValue) {
        const paid = new Prisma.Decimal(amountValue);
        if (!paid.equals(payment.amount)) {
          throw new BadRequestException('Paid amount mismatch');
        }
      }

      if (currencyCode) {
        const dbCur = (payment.currency || '').toUpperCase();
        if (dbCur && dbCur !== currencyCode.toUpperCase()) {
          throw new BadRequestException('Currency mismatch');
        }
      }

      // Prevent double booking (same as Stripe)
      const startUtc = new Date(
        Date.UTC(
          booking.startDate.getUTCFullYear(),
          booking.startDate.getUTCMonth(),
          booking.startDate.getUTCDate(),
        ),
      );

      const endUtc = new Date(
        Date.UTC(
          booking.endDate.getUTCFullYear(),
          booking.endDate.getUTCMonth(),
          booking.endDate.getUTCDate(),
        ),
      );

      const nights = Math.floor((endUtc.getTime() - startUtc.getTime()) / MS_PER_DAY);
      const datesToBook = this.expandDatesUtcMidnight(startUtc, nights);

      for (const date of datesToBook) {
        const existing = await tx.calendarItem.findUnique({
          where: { listingId_date: { listingId: booking.listingId, date } },
        });
        if (existing?.isBooked) {
          throw new BadRequestException('Some dates are already booked');
        }
      }

      for (const date of datesToBook) {
        await tx.calendarItem.upsert({
          where: { listingId_date: { listingId: booking.listingId, date } },
          create: { listingId: booking.listingId, date, isBooked: true },
          update: { isBooked: true },
        });
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.CONFIRMED },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paypalCaptureId: captureId ?? null,
          metadata: {
            ...(payment.metadata as any),
            paypal: {
              eventId: event.id,
              eventType: event.event_type,
              paypalOrderId: relatedOrderId,
              captureId: captureId ?? null,
            },
          },
        },
      });

      this.logger.log(
        `PayPal payment updated to SUCCEEDED: paymentId=${payment.id} bookingId=${booking.id}`,
      );
    });

    return { received: true };
  }

  // DEBUG helper
  async debugFindPaymentBySessionId(sessionId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { stripePaymentId: sessionId },
      include: { booking: true },
    });

    return {
      sessionId,
      found: !!payment,
      payment,
    };
  }

  // Helpers (unchanged)
  private parseAndValidateBookingDates(startISO: string, endISO: string) {
    const start = new Date(startISO);
    const end = new Date(endISO);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid dates');
    }

    const startUtc = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    );
    const endUtc = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    );

    const diffDays = (endUtc.getTime() - startUtc.getTime()) / MS_PER_DAY;
    if (diffDays <= 0)
      throw new BadRequestException('endDate must be after startDate');

    const nights = Math.floor(diffDays);
    if (nights < 1) throw new BadRequestException('At least 1 night is required');

    const todayUtc = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ),
    );
    if (startUtc < todayUtc)
      throw new BadRequestException('startDate cannot be in the past');

    return { start: startUtc, end: endUtc, nights };
  }

  private expandDatesUtcMidnight(startUtc: Date, nights: number): Date[] {
    const dates: Date[] = [];
    for (let i = 0; i < nights; i++) {
      dates.push(new Date(startUtc.getTime() + i * MS_PER_DAY));
    }
    return dates;
  }

  private decimalToCents(price: Prisma.Decimal): number {
    const asString = price.toFixed(2);
    const normalized = asString.replace('.', '');
    const cents = Number(normalized);
    if (!Number.isInteger(cents)) throw new BadRequestException('Invalid price format');
    return cents;
  }

  private logUnexpectedError(
    message: string,
    err: unknown,
    context?: Record<string, unknown>,
  ) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.logger.error(`${message}: ${errorMessage}`, stack);
    if (context) this.logger.debug(`Context: ${JSON.stringify(context)}`);
  }
}