import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsArray, MaxLength, Min } from 'class-validator';

export class CreateListingDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsNotEmpty()
    address: string;

    @IsString()
    @IsNotEmpty()
    city: string;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    price: number;

    @IsArray()
    @IsOptional()
    images?: string[];

    @IsString()
    @IsOptional()
    rules?: string;

    @IsString()
    @IsOptional()
    cancellationPolicy?: 'FLEXIBLE' | 'MODERATE' | 'STRICT';

    @IsString()
    @IsOptional()
    googleMapsUrl?: string;
}
