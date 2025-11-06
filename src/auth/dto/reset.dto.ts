import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class ResetDto {
    @IsString()
    @IsNotEmpty()
    mobile: string;

    @IsString()
    @IsNotEmpty()
    otp: string;

    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    })
    newPassword: string;

    @IsString()
    @MinLength(8, { message: 'Password confirmation must be at least 8 characters' })
    newPasswordConfirm: string;
}
