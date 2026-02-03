import { IsDateString, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  listingId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
