import { IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { UserType } from "src/common/enums/user-type.enum";

export class RegisterDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(4, { message: 'Full name must be at least 4 characters' })
    @Matches(/^[a-zA-Z\s\u0600-\u06FF]+$/, {
        message: 'Full name can only contain letters and spaces'
    })
    fullName: string;

    @IsEmail({}, { message: 'Please provide a valid email address' })
    @IsOptional()
    email: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^\+[1-9]\d{1,14}$/, { message: 'Mobile number must start with + and be in international format' })
    mobile: string;


    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    })
    password: string;

    @IsOptional()
    @IsEnum(UserType, { message: 'Invalid user type' })
    userType?: UserType;

    @IsBoolean()
    @IsNotEmpty()
    acceptTerms: boolean
}
