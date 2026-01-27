import {
    Controller,
    Post,
    Body,
    Req,
    UseGuards,
    Headers,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RawBodyRequest } from '@nestjs/common';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingController {
    constructor(private readonly bookingService: BookingService) { }

    @Post('checkout')
    @UseGuards(AuthGuard('jwt')) 
    @ApiBearerAuth()
    @ApiBody({ type: CreateBookingDto })
    async createCheckout(
        @Body() dto: CreateBookingDto,
        @Req() req: any,
    ) {
        const userId = req.user.sub;
        return this.bookingService.createCheckoutSession(userId, dto);
    }

    // @Post('webhook')
    // async stripeWebhook(
    //     @Req() req: RawBodyRequest<Request>,
    //     @Headers('stripe-signature') sig: string,
    // ) {
    //     const rawBody = req.rawBody;
    //     if (!rawBody) {
    //         throw new Error('Missing rawBody on Stripe webhook request');
    //     }
    //     return this.bookingService.handleStripeWebhook(rawBody, sig);
    // }
}
