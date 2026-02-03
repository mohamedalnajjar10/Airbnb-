import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { PrismaModule } from 'Prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';


@Module({
  imports: [PrismaModule , ConfigModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
