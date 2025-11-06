import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export enum OAuthProvider {
  GOOGLE = 'google',
  APPLE = 'apple',
  MICROSOFT = 'microsoft',
}

export class OAuthLoginDto {
  @IsEnum(OAuthProvider, { message: 'Invalid OAuth provider' })
  provider: OAuthProvider;

  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
