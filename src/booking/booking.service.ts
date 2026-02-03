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
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_CURRENCY = 'egp' as const;

@Injectable()
export class BookingService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(BookingService.name);
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not set in env');

    const appBaseUrl = this.config.get<string>('APP_BASE_URL');
    if (!appBaseUrl) throw new Error('APP_BASE_URL not set in env');

    this.appBaseUrl = appBaseUrl;

    // IMPORTANT: avoid forcing apiVersion (reduces issues)
    this.stripe = new Stripe(stripeKey);
  }

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
              currency: DEFAULT_CURRENCY,
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
            currency: DEFAULT_CURRENCY,
            status: PaymentStatus.PENDING,
            paymentMethod: PaymentMethod.STRIPE,

            // store session.id here
            stripePaymentId: session.id,
            stripeClientSecret: null,
            metadata: { checkoutSessionId: session.id },
          },
        });

        this.logger.log(
          `DB saved payment: paymentId=${payment.id} stripePaymentId=${payment.stripePaymentId} bookingId=${booking.id}`,
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

  // Stripe Webhook handler
  async handleStripeWebhook(rawBody: Buffer, sigHeader: string) {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set in env');

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
    } catch (e) {
      this.logger.error('Signature verification failed', e as any);
      throw new BadRequestException('Invalid Stripe signature');
    }

    this.logger.log(`Webhook received: ${event.type}`);

    // only handle success
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
        (endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000),
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
        `Payment updated to SUCCEEDED: paymentId=${payment.id} bookingId=${booking.id}`,
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
    if (diffDays <= 0) throw new BadRequestException('endDate must be after startDate');

    const nights = Math.floor(diffDays);
    if (nights < 1) throw new BadRequestException('At least 1 night is required');

    const todayUtc = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ),
    );
    if (startUtc < todayUtc) throw new BadRequestException('startDate cannot be in the past');

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

  private logUnexpectedError(message: string, err: unknown, context?: Record<string, unknown>) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.logger.error(`${message}: ${errorMessage}`, stack);
    if (context) this.logger.debug(`Context: ${JSON.stringify(context)}`);
  }
}



// import {
//   BadRequestException,
//   Injectable,
//   InternalServerErrorException,
//   Logger,
//   NotFoundException,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { PrismaService } from 'Prisma/prisma.service';
// import Stripe from 'stripe';
// import { CreateBookingDto } from './dto/create-booking.dto';
// import { BookingStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
// import { Prisma } from '@prisma/client';

// const MS_PER_DAY = 24 * 60 * 60 * 1000;
// const DEFAULT_CURRENCY = 'egp' as const;

// @Injectable()
// export class BookingService {
//   private readonly stripe: Stripe;
//   private readonly logger = new Logger(BookingService.name);
//   private readonly appBaseUrl: string;

//   constructor(
//     private readonly prisma: PrismaService,
//     private readonly config: ConfigService,
//   ) {
//     const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
//     if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not set in env');

//     const appBaseUrl = this.config.get<string>('APP_BASE_URL');
//     if (!appBaseUrl) throw new Error('APP_BASE_URL not set in env');

//     this.appBaseUrl = appBaseUrl;

//     this.stripe = new Stripe(stripeKey, {
//       // apiVersion: '2026-01-28.clover',
//     });
//   }

//   async createCheckoutSession(userId: string, dto: CreateBookingDto) {
//     const user = await this.prisma.user.findUnique({ where: { id: userId } });
//     if (!user) throw new UnauthorizedException('User not found');

//     const listing = await this.prisma.listing.findUnique({
//       where: { id: dto.listingId },
//     });
//     if (!listing) throw new NotFoundException('Listing not found');

//     const { start, end, nights } = this.parseAndValidateBookingDates(
//       dto.startDate,
//       dto.endDate,
//     );

//     const unitAmountCents = this.decimalToCents(listing.price);
//     if (unitAmountCents <= 0) {
//       throw new BadRequestException('Invalid listing price');
//     }

//     try {
//       // 1) إنشاء Checkout Session في Stripe
//       const session = await this.stripe.checkout.sessions.create({
//         payment_method_types: ['card'],
//         mode: 'payment',
//         line_items: [
//           {
//             price_data: {
//               currency: DEFAULT_CURRENCY,
//               product_data: {
//                 name: listing.title,
//                 description: listing.description ?? undefined,
//                 metadata: { listingId: listing.id },
//               },
//               unit_amount: unitAmountCents,
//             },
//             quantity: nights,
//           },
//         ],
//         metadata: {
//           listingId: listing.id,
//           userId,
//           startDate: dto.startDate,
//           endDate: dto.endDate,
//         },
//         success_url: `${this.appBaseUrl}/api/v1/bookings/success?session_id={CHECKOUT_SESSION_ID}`,
//         cancel_url: `${this.appBaseUrl}/api/v1/bookings/cancel`,
//       });

//       const totalAmountCents = unitAmountCents * nights;
//       const totalAmountDecimal = new Prisma.Decimal(totalAmountCents).div(100);

//       // 2) إنشاء Booking + Payment في DB
//       const result = await this.prisma.$transaction(async (tx) => {
//         const booking = await tx.booking.create({
//           data: {
//             userId,
//             listingId: listing.id,
//             startDate: start,
//             endDate: end,
//             status: BookingStatus.PENDING,
//             totalPrice: totalAmountDecimal,
//           },
//         });

//         await tx.payment.create({
//           data: {
//             bookingId: booking.id,
//             amount: totalAmountDecimal,
//             currency: DEFAULT_CURRENCY,
//             status: PaymentStatus.PENDING,
//             paymentMethod: PaymentMethod.STRIPE,

//             // مهم: نخزن Checkout Session ID هنا
//             stripePaymentId: session.id,

//             stripeClientSecret: null,
//             metadata: { checkoutSessionId: session.id },
//           },
//         });

//         return booking;
//       });

//       return { url: session.url, id: session.id, bookingId: result.id };
//     } catch (err) {
//       this.logUnexpectedError('Stripe checkout session failed', err, { userId });
//       if (err instanceof Stripe.errors.StripeError) {
//         throw new BadRequestException('Payment provider error');
//       }
//       throw new InternalServerErrorException(
//         'Checkout session creation failed. Please try again later.',
//       );
//     }
//   }

//   // Stripe Webhook handler
//   async handleStripeWebhook(rawBody: Buffer, sigHeader: string) {
//     const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
//     if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set in env');

//     let event: Stripe.Event;

//     event = this.stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
//     this.logger.log(`Webhook received: ${event.type}`);

//     // نتعامل فقط مع نجاح الدفع
//     if (event.type !== 'checkout.session.completed') {
//       return { received: true };
//     }

//     const session = event.data.object as Stripe.Checkout.Session;
//     const checkoutSessionId = session.id;

//     await this.prisma.$transaction(async (tx) => {
//       // 1) payment من خلال session.id (هذا موجود عندك في DB)
//       const payment = await tx.payment.findFirst({
//         where: { stripePaymentId: checkoutSessionId },
//       });

//       if (!payment) {
//         this.logger.warn(`Payment not found for session ${checkoutSessionId}`);
//         return;
//       }

//       // 2) booking من payment.bookingId
//       const booking = await tx.booking.findUnique({
//         where: { id: payment.bookingId },
//       });

//       if (!booking) {
//         this.logger.warn(`Booking not found for payment ${payment.id}`);
//         return;
//       }

//       // 3) idempotency
//       if (payment.status === PaymentStatus.SUCCEEDED) {
//         this.logger.log(`Payment already succeeded: paymentId=${payment.id}`);
//         return;
//       }

//       // 4) احسب الليالي والتواريخ من بيانات الـ booking نفسها
//       const startUtc = new Date(Date.UTC(
//         booking.startDate.getUTCFullYear(),
//         booking.startDate.getUTCMonth(),
//         booking.startDate.getUTCDate(),
//       ));

//       const endUtc = new Date(Date.UTC(
//         booking.endDate.getUTCFullYear(),
//         booking.endDate.getUTCMonth(),
//         booking.endDate.getUTCDate(),
//       ));

//       const nights = Math.floor((endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000));
//       const datesToBook = this.expandDatesUtcMidnight(startUtc, nights);

//       // 5) امنع الحجز المزدوج + احجز الأيام
//       for (const date of datesToBook) {
//         const existing = await tx.calendarItem.findUnique({
//           where: { listingId_date: { listingId: booking.listingId, date } },
//         });
//         if (existing?.isBooked) {
//           throw new BadRequestException('Some dates are already booked');
//         }
//       }

//       for (const date of datesToBook) {
//         await tx.calendarItem.upsert({
//           where: { listingId_date: { listingId: booking.listingId, date } },
//           create: { listingId: booking.listingId, date, isBooked: true },
//           update: { isBooked: true },
//         });
//       }

//       // 6) حدّث booking + payment
//       await tx.booking.update({
//         where: { id: booking.id },
//         data: { status: BookingStatus.CONFIRMED },
//       });

//       const paymentIntentId =
//         typeof session.payment_intent === 'string'
//           ? session.payment_intent
//           : (session.payment_intent as any)?.id;

//       await tx.payment.update({
//         where: { id: payment.id },
//         data: {
//           status: PaymentStatus.SUCCEEDED,
//           metadata: {
//             ...(payment.metadata as any),
//             checkoutSessionId,
//             paymentIntentId: paymentIntentId ?? null,
//           },
//         },
//       });
//     });

//     return { received: true };
//   }

//   private parseAndValidateBookingDates(startISO: string, endISO: string) {
//     const start = new Date(startISO);
//     const end = new Date(endISO);

//     if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
//       throw new BadRequestException('Invalid dates');
//     }

//     // توحيد التواريخ على UTC midnight لتفادي DST/timezone
//     const startUtc = new Date(
//       Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
//     );
//     const endUtc = new Date(
//       Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
//     );

//     const diffDays = (endUtc.getTime() - startUtc.getTime()) / MS_PER_DAY;
//     if (diffDays <= 0) {
//       throw new BadRequestException('endDate must be after startDate');
//     }

//     const nights = Math.floor(diffDays);
//     if (nights < 1)
//       throw new BadRequestException('At least 1 night is required');

//     const todayUtc = new Date(
//       Date.UTC(
//         new Date().getUTCFullYear(),
//         new Date().getUTCMonth(),
//         new Date().getUTCDate(),
//       ),
//     );
//     if (startUtc < todayUtc) {
//       throw new BadRequestException('startDate cannot be in the past');
//     }

//     return { start: startUtc, end: endUtc, nights };
//   }

//   private expandDatesUtcMidnight(startUtc: Date, nights: number): Date[] {
//     const dates: Date[] = [];
//     for (let i = 0; i < nights; i++) {
//       dates.push(new Date(startUtc.getTime() + i * MS_PER_DAY));
//     }
//     return dates;
//   }

//   private decimalToCents(price: Prisma.Decimal): number {
//     const asString = price.toFixed(2); // "123.45"
//     const normalized = asString.replace('.', '');
//     const cents = Number(normalized);
//     if (!Number.isInteger(cents))
//       throw new BadRequestException('Invalid price format');
//     return cents;
//   }

//   private logUnexpectedError(
//     message: string,
//     err: unknown,
//     context?: Record<string, unknown>,
//   ) {
//     const errorMessage = err instanceof Error ? err.message : String(err);
//     const stack = err instanceof Error ? err.stack : undefined;
//     this.logger.error(`${message}: ${errorMessage}`, stack);
//     if (context) this.logger.debug(`Context: ${JSON.stringify(context)}`);
//   }
// }
