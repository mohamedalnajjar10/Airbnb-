import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class MobileVerificationDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'Mobile number must start with + and be in international format' })
  mobile: string;
}

export class VerifyMobileDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'Mobile number must start with + and be in international format' })
  mobile: string;

  @IsString()
  @IsNotEmpty()
  otp: string;
}
