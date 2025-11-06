import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from "class-validator";

export class LoginDto {
    @IsNotEmpty()
    @IsString()
    @Matches(/^\+[1-9]\d{1,14}$/, { message: 'Mobile number must start with + and be in international format' })
    mobile: string;

    @IsNotEmpty()
    @IsString()
    @MinLength(6, { message: 'Password must be at least 6 characters' })
    password: string;

    @IsOptional()
    @IsBoolean()
    rememberMe?: boolean;
}

