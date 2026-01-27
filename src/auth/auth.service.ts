import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { normalizeMobile } from 'src/common/utils/phone.util';
import { AUTH_CONSTANTS, AUTH_ERROR_MESSAGES } from './constants/auth.constants';
import { UserType, UserRole } from '@prisma/client';
import { PrismaService } from 'Prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { AuthResponse, SafeUser } from './interfaces/auth-response.interface';
import * as crypto from 'crypto';
import { OAuthLoginDto } from './dto/oauth-login.dto';
import { OAuth2Client } from 'google-auth-library';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { MobileVerificationDto, VerifyMobileDto } from './dto/mobile-verification.dto';

function randomOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client;
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.config.get('GOOGLE_CLIENT_ID'),
      this.config.get('GOOGLE_CLIENT_SECRET'),
      this.config.get('GOOGLE_REDIRECT_URI'),
    );
  }
  private getNum(key: string, def = 0): number {
    const v = this.config.get<string>(key);
    return v ? Number(v) : def;
  }

  private signToken(payload: {
    sub: string;
    mobile: string;
    role: UserRole;
    type: UserType;
    isVerified: boolean;
  }): string {
    return this.jwtService.sign(payload);
  }

  private createSafeUser(user: {
    id: string;
    fullName: string;
    mobile: string;
    email: string | null;
    type: UserType;
    role: UserRole;
    isVerified: boolean;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SafeUser {
    return {
      id: user.id,
      fullName: user.fullName,
      mobile: user.mobile,
      email: user.email,
      type: user.type,
      role: user.role,
      isVerified: user.isVerified,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async createRefreshToken(userId: string, rememberMe = false): Promise<string> {
    const token = generateRefreshToken();
    const expiresInDays = rememberMe ? 30 : 7; // 30 days for remember me, 7 days otherwise
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });

    return token;
  }

  private async validateRefreshToken(token: string): Promise<{
    id: string;
    userId: string;
    expiresAt: Date;
    user: {
      id: string;
      mobile: string;
      role: UserRole;
      type: UserType;
      isVerified: boolean;
    };
  } | null> {
    const refreshToken = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!refreshToken || refreshToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return refreshToken;
  }

  /**
 * Register a new user account
 * @param dto - Registration data including user details and password
 * @returns Promise with success message and mobile number
 * @throws BadRequestException for invalid user type
 * @throws ConflictException for existing mobile/email
 */

  async register(dto: RegisterDto): Promise<{ message: string; mobile: string }> {
    this.logger.log(`Registration attempt for mobile: ${dto.mobile}`);

    const mobile = normalizeMobile(dto.mobile);
    const email = dto.email ? dto.email.trim().toLowerCase() : null;

    // Sanitize full name
    const fullName = dto.fullName.trim().replace(/[<>]/g, '');

    // Validate user type for mobile app
    const allowedMobileTypes = AUTH_CONSTANTS.ALLOWED_MOBILE_TYPES.map(type => type as UserType);
    if (!allowedMobileTypes.includes(dto.userType || UserType.GUEST)) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.INVALID_USER_TYPE);
    }

    // Check if user already exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { mobile },
          ...(email ? [{ email }] : []),
        ],
      },
    });

    if (existingUser) {
      if (existingUser.mobile === mobile) {
        throw new ConflictException(AUTH_ERROR_MESSAGES.MOBILE_ALREADY_REGISTERED);
      }
      if (existingUser.email === email) {
        throw new ConflictException(AUTH_ERROR_MESSAGES.EMAIL_ALREADY_REGISTERED);
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, AUTH_CONSTANTS.BCRYPT_ROUNDS);

    // Create OTP for verification
    const otp = randomOtp();
    const hashedCode = await bcrypt.hash(otp, 12);
    const expiresAt = new Date(Date.now() + this.getNum('OTP_EXP_SECONDS', 180) * 1000);
    const resendAllowedAt = new Date(Date.now() + this.getNum('OTP_RESEND_LOCK_SECONDS', 60) * 1000);

    // Use transaction to ensure data consistency
    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          fullName,
          mobile,
          email,
          passwordHash,
          type: dto.userType || UserType.GUEST,
          role: UserRole.GUEST,
        },
      });

      await tx.otpCode.create({
        data: { mobile, hashedCode, expiresAt, resendAllowedAt },
      });
    });

    // DEV only - remove in production
    console.log('[DEV OTP]', mobile, otp);

    return { message: 'Registration successful. Please verify your mobile number.', mobile };

  }

  /**
 * Authenticate user with mobile and password
 * @param dto - Login credentials including mobile and password
 * @returns Promise with access token, refresh token, and user data
 * @throws UnauthorizedException for invalid credentials or blocked account
 * @throws BadRequestException for account lockout
 */
  async login(dto: LoginDto): Promise<AuthResponse> {
    this.logger.log(`Login attempt for mobile: ${dto.mobile}`);

    const mobile = normalizeMobile(dto.mobile);

    // Check login attempts
    const loginAttempt = await this.prisma.loginAttempt.findUnique({ where: { mobile } });
    const now = new Date();
    if (loginAttempt?.blockedUntil && loginAttempt.blockedUntil > now) {
      throw new BadRequestException(
        `Account temporarily locked. Try again after ${loginAttempt.blockedUntil.toISOString()}`,
      );
    }
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      const maxAttempts = this.getNum('MAX_LOGIN_ATTEMPTS', 5);
      const blockSeconds = this.getNum('LOGIN_BLOCK_SECONDS', 900);

      if (!loginAttempt) {
        await this.prisma.loginAttempt.create({
          data: { mobile, attempts: 1 },
        });
      } else {
        const attempts = loginAttempt.attempts + 1;
        const data: { attempts: number; blockedUntil?: Date } = { attempts };
        if (attempts >= maxAttempts) {
          data.blockedUntil = new Date(Date.now() + blockSeconds * 1000);
        }
        await this.prisma.loginAttempt.update({ where: { mobile }, data });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Reset login attempts on successful login
    await this.prisma.loginAttempt.upsert({
      where: { mobile },
      update: { attempts: 0, blockedUntil: null },
      create: { mobile, attempts: 0 },
    });

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Create tokens
    const tokenPayload = {
      sub: user.id,
      mobile: user.mobile,
      role: user.role,
      type: user.type,
      isVerified: user.isVerified,
    };

    const accessToken = this.signToken(tokenPayload);
    const refreshToken = await this.createRefreshToken(user.id, dto.rememberMe);

    return {
      accessToken,
      refreshToken,
      user: this.createSafeUser(user),
      expiresIn: this.getNum('JWT_EXPIRES_IN', 3600),
    };
  }

  // ============ OAuth Login ============
  // ========== 1) Google Auth URL ==========
  getGoogleAuthUrl(): string {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

    const scope = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ].join(' ');

    return (
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      `response_type=code&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}`
    );
  }
  // ========== 2) Handle Google Login ==========
  async googleLogin(code: string) {
    const { tokens } = await this.googleClient.getToken(code);

    const idToken = tokens.id_token;
    if (!idToken) throw new UnauthorizedException('Google authentication failed');

    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email)
      throw new UnauthorizedException('Google user info not found');

    const { sub, email, name, picture } = payload;

    const user = await this.prisma.user.upsert({
      where: { email },
      create: {
        fullName: name ?? 'Google User',
        email,
        mobile: `google_${sub}`,
        oauthProvider: 'google',
        oauthId: sub,
        type: UserType.GUEST,
        role: UserRole.GUEST,
        isVerified: true,
      },
      update: {
        fullName: name,
      },
    });

    const jwtPayload = { sub: user.id, email: user.email, role: user.role, type: user.type };

    return {
      accessToken: this.jwtService.sign(jwtPayload),
      refreshToken: this.jwtService.sign(jwtPayload, { expiresIn: '7d' }),
      user,
    };
  }


  // ============ Refresh Token ============
  async refreshToken(dto: RefreshTokenDto): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshTokenData = await this.validateRefreshToken(dto.refreshToken);
    if (!refreshTokenData) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Delete old refresh token
    await this.prisma.refreshToken.delete({
      where: { token: dto.refreshToken },
    });

    // Create new tokens
    const tokenPayload = {
      sub: refreshTokenData.user.id,
      mobile: refreshTokenData.user.mobile,
      role: refreshTokenData.user.role,
      type: refreshTokenData.user.type,
      isVerified: refreshTokenData.user.isVerified,
    };

    const accessToken = this.signToken(tokenPayload);
    const newRefreshToken = await this.createRefreshToken(refreshTokenData.user.id, true);

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  // ============ Mobile Verification ============
  async requestMobileVerification(dto: MobileVerificationDto): Promise<{ message: string }> {
    const mobile = normalizeMobile(dto.mobile);

    // Check if user exists
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check resend cooldown
    const lastOtp = await this.prisma.otpCode.findFirst({
      where: { mobile },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    if (lastOtp?.resendAllowedAt && lastOtp.resendAllowedAt > now) {
      const seconds = Math.ceil((lastOtp.resendAllowedAt.getTime() - now.getTime()) / 1000);
      throw new BadRequestException(`Please wait ${seconds} seconds before requesting another OTP`);
    }

    // Create new OTP
    const otp = randomOtp();
    const hashedCode = await bcrypt.hash(otp, 12);
    const expiresAt = new Date(Date.now() + this.getNum('OTP_EXP_SECONDS', 180) * 1000);
    const resendAllowedAt = new Date(Date.now() + this.getNum('OTP_RESEND_LOCK_SECONDS', 60) * 1000);

    await this.prisma.otpCode.create({
      data: { mobile, hashedCode, expiresAt, resendAllowedAt },
    });

    // DEV only
    console.log('[DEV OTP]', mobile, otp);

    return { message: 'OTP sent to your mobile number' };
  }

  async verifyMobile(dto: VerifyMobileDto): Promise<{ message: string }> {
    const mobile = normalizeMobile(dto.mobile);

    // Check OTP attempts
    const attempt = await this.prisma.otpAttempt.findUnique({ where: { mobile } });
    const now = new Date();
    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
      throw new BadRequestException(
        `Too many attempts. Try again after ${attempt.blockedUntil.toISOString()}`,
      );
    }

    // Find latest OTP
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: { mobile },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new BadRequestException('No OTP found. Please request a new one.');
    }

    if (otpRecord.expiresAt < now) {
      await this.prisma.otpCode.deleteMany({ where: { mobile } });
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    const isOtpValid = await bcrypt.compare(dto.otp, otpRecord.hashedCode);
    if (!isOtpValid) {
      const maxAttempts = this.getNum('MAX_OTP_ATTEMPTS', 5);
      const blockSeconds = this.getNum('OTP_BLOCK_SECONDS', 900);

      if (!attempt) {
        await this.prisma.otpAttempt.create({ data: { mobile, attempts: 1 } });
      } else {
        const attempts = attempt.attempts + 1;
        const data: { attempts: number; blockedUntil?: Date } = { attempts };
        if (attempts >= maxAttempts) {
          data.blockedUntil = new Date(Date.now() + blockSeconds * 1000);
        }
        await this.prisma.otpAttempt.update({ where: { mobile }, data });
      }
      throw new BadRequestException('Invalid OTP');
    }

    // Check if user exists before updating
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if already verified
    if (user.isVerified) {
      throw new BadRequestException('Mobile already verified');
    }

    // Verify user and cleanup
    await this.prisma.user.update({
      where: { mobile },
      data: { isVerified: true },
    });

    await this.prisma.otpCode.deleteMany({ where: { mobile } });
    await this.prisma.otpAttempt.upsert({
      where: { mobile },
      update: { attempts: 0, blockedUntil: null },
      create: { mobile, attempts: 0 },
    });

    return { message: 'Mobile number verified successfully' };
  }

  // ============ Password Reset ============
  async forgotPassword(dto: MobileVerificationDto): Promise<{ message: string }> {
    const mobile = normalizeMobile(dto.mobile);
    const user = await this.prisma.user.findUnique({ where: { mobile } });

    if (!user) {
      // Don't reveal if user exists or not for security
      return { message: 'If the mobile number is registered, an OTP has been sent' };
    }

    // Check resend cooldown
    const lastOtp = await this.prisma.otpCode.findFirst({
      where: { mobile },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    if (lastOtp?.resendAllowedAt && lastOtp.resendAllowedAt > now) {
      const seconds = Math.ceil((lastOtp.resendAllowedAt.getTime() - now.getTime()) / 1000);
      throw new BadRequestException(`Please wait ${seconds} seconds before requesting another OTP`);
    }

    // Create OTP
    const otp = randomOtp();
    const hashedCode = await bcrypt.hash(otp, 12);
    const expiresAt = new Date(Date.now() + this.getNum('OTP_EXP_SECONDS', 180) * 1000);
    const resendAllowedAt = new Date(Date.now() + this.getNum('OTP_RESEND_LOCK_SECONDS', 60) * 1000);

    await this.prisma.otpCode.create({
      data: { mobile, hashedCode, expiresAt, resendAllowedAt },
    });

    // DEV only
    console.log('[DEV OTP]', mobile, otp);

    return { message: 'If the mobile number is registered, an OTP has been sent' };
  }

  async resetPassword(dto: {
    mobile: string;
    otp: string;
    newPassword: string;
    newPasswordConfirm: string;
  }): Promise<{ message: string }> {
    const mobile = normalizeMobile(dto.mobile);

    if (dto.newPassword !== dto.newPasswordConfirm) {
      throw new BadRequestException('Password confirmation does not match');
    }

    // Validate new password
    if (dto.newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    // Find and validate OTP
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: { mobile },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new BadRequestException('No OTP found. Please request a new one.');
    }

    if (otpRecord.expiresAt < new Date()) {
      await this.prisma.otpCode.deleteMany({ where: { mobile } });
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    const isOtpValid = await bcrypt.compare(dto.otp, otpRecord.hashedCode);
    if (!isOtpValid) {
      throw new BadRequestException('Invalid OTP');
    }

    // Update password
    const newPasswordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { mobile },
      data: { passwordHash: newPasswordHash },
    });

    // Cleanup OTP and invalidate all refresh tokens
    await this.prisma.otpCode.deleteMany({ where: { mobile } });
    await this.prisma.refreshToken.deleteMany({
      where: { user: { mobile } },
    });

    return { message: 'Password reset successfully' };
  }

  // ============ Cleanup expired tokens ============
  async cleanupExpiredTokens(): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}


