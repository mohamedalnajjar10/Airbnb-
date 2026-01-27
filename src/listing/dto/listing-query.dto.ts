import { IsOptional, IsNumberString, IsString, IsEnum } from 'class-validator';
import { ListingStatus } from '@prisma/client';

export class ListingQueryDto {
    @IsOptional()
    @IsNumberString()
    page?: string;

    @IsOptional()
    @IsNumberString()
    limit?: string;

    @IsOptional()
    @IsString()
    city?: string;

    @IsOptional()
    @IsEnum(ListingStatus)
    status?: ListingStatus;

    @IsOptional()
    minPrice?: string;

    @IsOptional()
    maxPrice?: string;

    @IsOptional()
    @IsString()
    location?: string;
}
