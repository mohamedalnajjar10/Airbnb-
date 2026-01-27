import { IsOptional, IsString } from 'class-validator';

export class UpdateBookingDto {
    @IsString()
    @IsOptional()
    status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED';

    @IsString()
    @IsOptional()
    cancellationReason?: string;
}
