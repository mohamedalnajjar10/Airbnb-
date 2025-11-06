import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, HttpCode, HttpStatus, Query, Res } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';
import { Response } from 'express';
import { MobileVerificationDto, VerifyMobileDto } from './dto/mobile-verification.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetDto } from './dto/reset.dto';


@ApiTags('Authentication')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) { }
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with mobile and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // @Post('oauth-login')
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Login with OAuth provider' })
  // @ApiResponse({ status: 200, description: 'OAuth login successful' })
  // @ApiResponse({ status: 401, description: 'Invalid OAuth token' })
  // async oauthLogin(@Body() dto: OAuthLoginDto) {
  //   return this.authService.oauthLogin(dto);
  // }

  @Get('google')
  async redirectToGoogle(@Res() res: Response) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scope = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ].join(' ');

    const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`;
    return res.redirect(url);
  }

  @Get('google/callback')
  async googleCallback(@Query('code') code: string) {
    return this.authService.googleLogin(code);
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }


  @Post('request-mobile-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request mobile verification OTP' })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async requestMobileVerification(@Body() dto: MobileVerificationDto) {
    return this.authService.requestMobileVerification(dto);
  }

  @Post('verify-mobile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify mobile number with OTP' })
  @ApiResponse({ status: 200, description: 'Mobile verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  async verifyMobile(@Body() dto: VerifyMobileDto) {
    return this.authService.verifyMobile(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset OTP' })
  @ApiResponse({ status: 200, description: 'OTP sent if user exists' })
  async forgotPassword(@Body() dto: MobileVerificationDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with OTP' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid OTP or password' })
  async resetPassword(@Body() dto: ResetDto) {
    return this.authService.resetPassword(dto);
  }

}
