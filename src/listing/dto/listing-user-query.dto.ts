import { IsOptional, IsNumberString } from 'class-validator';

export class ListingForUserQueryDto {
    @IsOptional()
    @IsNumberString()
    page?: number;

    @IsOptional()
    @IsNumberString()
    limit?: number;
}
