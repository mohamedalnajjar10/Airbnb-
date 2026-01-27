import {
    Injectable,
    BadRequestException,
    NotFoundException,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PrismaService } from 'Prisma/prisma.service';

@Injectable()
export class BookingService {
    private readonly stripe: Stripe;
    private readonly logger = new Logger(BookingService.name);

    constructor(private prisma: PrismaService, private config: ConfigService) {
        const key = this.config.get<string>('STRIPE_SECRET_KEY');
        if (!key) {
            throw new Error('STRIPE_SECRET_KEY not set in env');
        }

        this.stripe = new Stripe(key);
    }

    private computeNights(startISO: string, endISO: string) {
        const start = new Date(startISO);
        const end = new Date(endISO);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new BadRequestException('Invalid dates');
        }

        const msPerDay = 24 * 60 * 60 * 1000;
        const diff = (end.getTime() - start.getTime()) / msPerDay;

        if (diff <= 0) {
            throw new BadRequestException('endDate must be after startDate');
        }

        const nights = Math.round(diff);
        if (nights <= 0) throw new BadRequestException('Dates difference must be at least 1 night');

        return nights;
    }

    async createCheckoutSession(userId: string, dto: CreateBookingDto) {
        try {
            // 1️⃣ Fetch listing
            const listing = await this.prisma.listing.findUnique({
                where: { id: dto.listingId },
            });

            if (!listing) {
                this.logger.warn(`Listing not found: ${dto.listingId}`);
                throw new NotFoundException('Listing not found');
            }

            // 2️⃣ Compute nights
            const nights = this.computeNights(dto.startDate, dto.endDate);

            // 3️⃣ Compute price
            const rawPriceAny: any = (listing as any).price;
            const unitPriceNumber =
                typeof rawPriceAny?.toNumber === 'function'
                    ? rawPriceAny.toNumber()
                    : typeof rawPriceAny === 'string'
                        ? Number(rawPriceAny)
                        : Number(rawPriceAny);

            if (isNaN(unitPriceNumber)) {
                this.logger.error(`Invalid listing price: ${rawPriceAny}`);
                throw new BadRequestException('Invalid listing price');
            }

            const totalCents = Math.round(unitPriceNumber * nights * 100);
            const unitAmountCents = Math.round(unitPriceNumber * 100);

            // 4️⃣ Create Stripe Checkout Session
            const session = await this.stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'payment',
                line_items: [
                    {
                        price_data: {
                            currency: 'egp',
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
                success_url: `${this.config.get('APP_BASE_URL')}/bookings/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${this.config.get('APP_BASE_URL')}/bookings/cancel`,
            });

            // 5️⃣ Create booking in DB
            const totalPriceStr = (totalCents / 100).toFixed(2);

            const booking = await this.prisma.booking.create({
                data: {
                    userId,
                    listingId: listing.id,
                    startDate: new Date(dto.startDate),
                    endDate: new Date(dto.endDate),
                    status: 'PENDING',
                    totalPrice: totalPriceStr,
                },
            });

            // 6️⃣ Create payment record
            await this.prisma.payment.create({
                data: {
                    bookingId: booking.id,
                    amount: totalPriceStr,
                    currency: 'egp',
                    status: 'PENDING',
                    paymentMethod: 'STRIPE',
                    stripePaymentId: session.id,
                    stripeClientSecret: null,
                    metadata: { checkoutSessionId: session.id },
                },
            });

            return { url: session.url, id: session.id, bookingId: booking.id };
        } catch (err) {
            // Re-throw known exceptions
            if (err instanceof BadRequestException ||
                err instanceof NotFoundException) {
                throw err;
            }

            // Log the actual error for debugging
            this.logger.error('Stripe checkout session failed', {
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                userId,
            });

            // Check if it's a Stripe-specific error
            if (err instanceof Stripe.errors.StripeError) {
                this.logger.error(`Stripe error: ${err.code} - ${err.message}`);
                throw new BadRequestException(
                    `Payment error: ${err.message || 'Unable to create checkout session'}`
                );
            }

            // Generic error for unknown exceptions
            throw new InternalServerErrorException(
                'Checkout session creation failed. Please try again later.'
            );
        }
    }
}

// async handleStripeWebhook(rawBody: Buffer, sigHeader: string) {
//     const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
//     if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

//     let event: Stripe.Event;
//     try {
//         event = this.stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
//     } catch (err) {
//         this.logger.warn('Stripe webhook signature verification failed');
//         throw err;
//     }

//     if (event.type === 'checkout.session.completed') {
//         const session = event.data.object as Stripe.Checkout.Session;
//         this.logger.log(`Processing checkout.session.completed: ${session.id}`);

//         // Use metadata to get booking data
//         const metadata = session.metadata || {};
//         const listingId = metadata.listingId as string | undefined;
//         const userId = metadata.userId as string | undefined;
//         const startDate = metadata.startDate as string | undefined;
//         const endDate = metadata.endDate as string | undefined;

//         if (!listingId || !userId || !startDate || !endDate) {
//             this.logger.warn('Missing metadata on session for booking creation');
//             return { received: true };
//         }

//         const payment = await this.prisma.payment.findFirst({
//             where: { stripePaymentId: session.id },
//         });

//         // compute nights and dates to book
//         const nights = this.computeNights(startDate, endDate);
//         const datesToBook: Date[] = [];
//         const s = new Date(startDate);
//         for (let i = 0; i < nights; i++) {
//             const d = new Date(s.getTime() + i * 24 * 60 * 60 * 1000);
//             d.setUTCHours(0, 0, 0, 0);
//             datesToBook.push(d);
//         }

//         await this.prisma.$transaction(async (tx) => {

//             const listing = await tx.listing.findUnique({ where: { id: listingId } });
//             if (!listing) throw new NotFoundException('Listing not found during webhook processing');

//             let booking = await tx.booking.findFirst({
//                 where: {
//                     userId,
//                     listingId,
//                     startDate: new Date(startDate),
//                     endDate: new Date(endDate),
//                     status: 'PENDING',
//                 },
//             });

//             if (!booking) {
//                 const amountTotalCents = typeof session.amount_total === 'number' ? session.amount_total : 0;
//                 booking = await tx.booking.create({
//                     data: {
//                         userId,
//                         listingId,
//                         startDate: new Date(startDate),
//                         endDate: new Date(endDate),
//                         status: 'PENDING',
//                         totalPrice: (amountTotalCents / 100).toFixed(2),
//                     },
//                 });
//             }
//             for (const date of datesToBook) {
//                 const existing = await tx.calendarItem.findUnique({
//                     where: { listingId_date: { listingId: listing.id, date } },
//                 });
//                 if (existing && existing.isBooked) {
//                     throw new ConflictException(`Date ${date.toISOString().slice(0, 10)} already booked`);
//                 }
//             }
//             for (const date of datesToBook) {
//                 await tx.calendarItem.upsert({
//                     where: { listingId_date: { listingId: listing.id, date } },
//                     create: { listingId: listing.id, date, isBooked: true },
//                     update: { isBooked: true },
//                 });
//             }
//             await tx.booking.update({
//                 where: { id: booking.id },
//                 data: { status: 'CONFIRMED', updatedAt: new Date() },
//             });

//             const paymentIntentId =
//                 typeof (session.payment_intent as any) === 'string'
//                     ? (session.payment_intent as string)
//                     : (session.payment_intent as any)?.id;

//             if (payment) {
//                 await tx.payment.update({
//                     where: { id: payment.id },
//                     data: {
//                         status: 'SUCCEEDED',
//                         stripePaymentId: paymentIntentId ?? session.id,
//                         updatedAt: new Date(),
//                     },
//                 });
//             } else {
//                 const amountTotalCents = typeof session.amount_total === 'number' ? session.amount_total : 0;
//                 await tx.payment.create({
//                     data: {
//                         bookingId: booking.id,
//                         amount: (amountTotalCents / 100).toFixed(2),
//                         currency: session.currency?.toUpperCase() ?? 'SAR',
//                         status: 'SUCCEEDED',
//                         paymentMethod: 'STRIPE',
//                         stripePaymentId: paymentIntentId ?? session.id,
//                     },
//                 });
//             }

//             // يمكنك هنا (اختياري) إرسال إشعار أو بريد إلكتروني
//         });

//         this.logger.log(`Booking confirmed for session ${session.id}`);
//     }
//     return { received: true };
// }
