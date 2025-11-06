import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'Prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UserType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { RegisterDto } from '../dto/register.dto';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockPrismaService = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    otpCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    otpAttempt: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    loginAttempt: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockUser = {
    id: 'user-123',
    fullName: 'Test User',
    mobile: '+201234567890',
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    type: UserType.GUEST,
    role: UserRole.GUEST,
    isVerified: false,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    oauthProvider: null,
    oauthId: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);

    // Reset all mocks
    jest.clearAllMocks();

    // Default config values
    mockConfigService.get.mockImplementation((key: string) => {
      const configs: Record<string, string> = {
        OTP_EXP_SECONDS: '180',
        OTP_RESEND_LOCK_SECONDS: '60',
        MAX_LOGIN_ATTEMPTS: '5',
        LOGIN_BLOCK_SECONDS: '900',
        MAX_OTP_ATTEMPTS: '5',
        OTP_BLOCK_SECONDS: '900',
        JWT_EXPIRES_IN: '3600',
        GOOGLE_CLIENT_ID: 'mock-client-id',
        GOOGLE_CLIENT_SECRET: 'mock-client-secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      };
      return configs[key];
    });
  });

  describe('register', () => {
    const registerDto = {
      fullName: 'Test User',
      mobile: '01234567890',
      email: 'test@example.com',
      password: 'Password123!',
      userType: UserType.GUEST as UserType,
      acceptTerms: true,
    } as RegisterDto;

    it('should register a new user successfully', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      const result = await service.register(registerDto);

      expect(result).toEqual({
        message: 'Registration successful. Please verify your mobile number.',
        mobile: '+201234567890',
      });
      expect(mockPrismaService.user.findFirst).toHaveBeenCalled();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw ConflictException if mobile already exists', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        ...mockUser,
        mobile: '+209876543210',
        email: registerDto.email,
      });

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for invalid user type', async () => {
      const invalidDto: RegisterDto = { 
        ...registerDto, 
        userType: 'INVALID_TYPE' as any,
      };

      await expect(service.register(invalidDto)).rejects.toThrow(BadRequestException);
    });

    it('should sanitize full name by removing < and >', async () => {
      const dtoWithHtml: RegisterDto = { 
        ...registerDto, 
        fullName: 'Test<script>User</script>',
      };
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      await service.register(dtoWithHtml);

      const transactionCallback = mockPrismaService.$transaction.mock.calls[0][0];
      await transactionCallback({
        user: {
          create: jest.fn((data) => {
            expect(data.data.fullName).toBe('TestscriptUser/script');
          }),
        },
        otpCode: { create: jest.fn() },
      });
    });
  });

  describe('login', () => {
    const loginDto = {
      mobile: '01234567890',
      password: 'Password123!',
      rememberMe: false,
    };

    beforeEach(() => {
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
    });

    it('should login successfully with valid credentials', async () => {
      mockPrismaService.loginAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.loginAttempt.upsert.mockResolvedValue({});
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockPrismaService.refreshToken.create.mockResolvedValue({
        token: 'refresh-token',
      });
      mockJwtService.sign.mockReturnValue('access-token');

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('expiresIn');
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      mockPrismaService.loginAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaService.loginAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if account is deactivated', async () => {
      mockPrismaService.loginAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException if account is blocked', async () => {
      const futureDate = new Date(Date.now() + 10000);
      mockPrismaService.loginAttempt.findUnique.mockResolvedValue({
        mobile: '+201234567890',
        attempts: 5,
        blockedUntil: futureDate,
      });

      await expect(service.login(loginDto)).rejects.toThrow(BadRequestException);
    });

    it('should increment login attempts on failed login', async () => {
      mockPrismaService.loginAttempt.findUnique.mockResolvedValue({
        mobile: '+201234567890',
        attempts: 2,
        blockedUntil: null,
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      expect(mockPrismaService.loginAttempt.update).toHaveBeenCalledWith({
        where: { mobile: '+201234567890' },
        data: { attempts: 3 },
      });
    });

    it('should create refresh token with longer expiry when rememberMe is true', async () => {
      mockPrismaService.loginAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.loginAttempt.upsert.mockResolvedValue({});
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockPrismaService.refreshToken.create.mockResolvedValue({
        token: 'refresh-token',
      });
      mockJwtService.sign.mockReturnValue('access-token');

      const dtoWithRememberMe = { ...loginDto, rememberMe: true };
      await service.login(dtoWithRememberMe);

      const createCall = mockPrismaService.refreshToken.create.mock.calls[0][0];
      const expiryDate = createCall.data.expiresAt;
      const expectedDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      
      // Allow 1 second difference for test execution time
      expect(Math.abs(expiryDate.getTime() - expectedDate.getTime())).toBeLessThan(1000);
    });
  });

  describe('requestMobileVerification', () => {
    const dto = { mobile: '01234567890' };

    it('should send OTP successfully', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.otpCode.findFirst.mockResolvedValue(null);
      mockPrismaService.otpCode.create.mockResolvedValue({});

      const result = await service.requestMobileVerification(dto);

      expect(result).toEqual({ message: 'OTP sent to your mobile number' });
      expect(mockPrismaService.otpCode.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.requestMobileVerification(dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if resend cooldown not expired', async () => {
      const futureDate = new Date(Date.now() + 10000);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() + 180000),
        resendAllowedAt: futureDate,
        createdAt: new Date(),
      });

      await expect(service.requestMobileVerification(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyMobile', () => {
    const dto = { mobile: '01234567890', otp: '123456' };

    beforeEach(() => {
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
    });

    it('should verify mobile successfully', async () => {
      mockPrismaService.otpAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() + 180000),
        resendAllowedAt: new Date(),
        createdAt: new Date(),
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue({ ...mockUser, isVerified: true });
      mockPrismaService.otpCode.deleteMany.mockResolvedValue({});
      mockPrismaService.otpAttempt.upsert.mockResolvedValue({});

      const result = await service.verifyMobile(dto);

      expect(result).toEqual({ message: 'Mobile number verified successfully' });
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { mobile: '+201234567890' },
        data: { isVerified: true },
      });
    });

    it('should throw BadRequestException if OTP not found', async () => {
      mockPrismaService.otpAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.otpCode.findFirst.mockResolvedValue(null);

      await expect(service.verifyMobile(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if OTP expired', async () => {
      mockPrismaService.otpAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() - 1000),
        resendAllowedAt: new Date(),
        createdAt: new Date(),
      });

      await expect(service.verifyMobile(dto)).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.otpCode.deleteMany).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid OTP', async () => {
      mockPrismaService.otpAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() + 180000),
        resendAllowedAt: new Date(),
        createdAt: new Date(),
      });
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

      await expect(service.verifyMobile(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.otpAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() + 180000),
        resendAllowedAt: new Date(),
        createdAt: new Date(),
      });
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.verifyMobile(dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if already verified', async () => {
      mockPrismaService.otpAttempt.findUnique.mockResolvedValue(null);
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() + 180000),
        resendAllowedAt: new Date(),
        createdAt: new Date(),
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        isVerified: true,
      });

      await expect(service.verifyMobile(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('forgotPassword', () => {
    const dto = { mobile: '01234567890' };

    it('should send OTP for password reset', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.otpCode.findFirst.mockResolvedValue(null);
      mockPrismaService.otpCode.create.mockResolvedValue({});

      const result = await service.forgotPassword(dto);

      expect(result).toEqual({
        message: 'If the mobile number is registered, an OTP has been sent',
      });
      expect(mockPrismaService.otpCode.create).toHaveBeenCalled();
    });

    it('should return generic message if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword(dto);

      expect(result).toEqual({
        message: 'If the mobile number is registered, an OTP has been sent',
      });
      expect(mockPrismaService.otpCode.create).not.toHaveBeenCalled();
    });

    it('should respect resend cooldown', async () => {
      const futureDate = new Date(Date.now() + 10000);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() + 180000),
        resendAllowedAt: futureDate,
        createdAt: new Date(),
      });

      await expect(service.forgotPassword(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    const dto = {
      mobile: '01234567890',
      otp: '123456',
      newPassword: 'NewPassword123!',
      newPasswordConfirm: 'NewPassword123!',
    };

    beforeEach(() => {
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
      jest.spyOn(bcrypt, 'hash').mockImplementation(async () => 'new-hashed-password');
    });

    it('should reset password successfully', async () => {
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() + 180000),
        resendAllowedAt: new Date(),
        createdAt: new Date(),
      });
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockPrismaService.otpCode.deleteMany.mockResolvedValue({});
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({});

      const result = await service.resetPassword(dto);

      expect(result).toEqual({ message: 'Password reset successfully' });
      expect(mockPrismaService.user.update).toHaveBeenCalled();
      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalled();
    });

    it('should throw BadRequestException if passwords do not match', async () => {
      const mismatchDto = { ...dto, newPasswordConfirm: 'DifferentPassword123!' };

      await expect(service.resetPassword(mismatchDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if password too short', async () => {
      const shortPasswordDto = {
        ...dto,
        newPassword: 'short',
        newPasswordConfirm: 'short',
      };

      await expect(service.resetPassword(shortPasswordDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if OTP not found', async () => {
      mockPrismaService.otpCode.findFirst.mockResolvedValue(null);

      await expect(service.resetPassword(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if OTP expired', async () => {
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() - 1000),
        resendAllowedAt: new Date(),
        createdAt: new Date(),
      });

      await expect(service.resetPassword(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid OTP', async () => {
      mockPrismaService.otpCode.findFirst.mockResolvedValue({
        mobile: '+201234567890',
        hashedCode: 'hashed',
        expiresAt: new Date(Date.now() + 180000),
        resendAllowedAt: new Date(),
        createdAt: new Date(),
      });
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

      await expect(service.resetPassword(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshToken', () => {
    const dto = { refreshToken: 'valid-refresh-token' };

    it('should refresh token successfully', async () => {
      const mockRefreshToken = {
        id: 'token-123',
        userId: mockUser.id,
        token: dto.refreshToken,
        expiresAt: new Date(Date.now() + 100000),
        user: mockUser,
        createdAt: new Date(),
      };

      mockPrismaService.refreshToken.findUnique.mockResolvedValue(mockRefreshToken);
      mockPrismaService.refreshToken.delete.mockResolvedValue(mockRefreshToken);
      mockPrismaService.refreshToken.create.mockResolvedValue({
        token: 'new-refresh-token',
      });
      mockJwtService.sign.mockReturnValue('new-access-token');

      const result = await service.refreshToken(dto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockPrismaService.refreshToken.delete).toHaveBeenCalledWith({
        where: { token: dto.refreshToken },
      });
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for expired token', async () => {
      const expiredToken = {
        id: 'token-123',
        userId: mockUser.id,
        token: dto.refreshToken,
        expiresAt: new Date(Date.now() - 1000),
        user: mockUser,
        createdAt: new Date(),
      };

      mockPrismaService.refreshToken.findUnique.mockResolvedValue(expiredToken);

      await expect(service.refreshToken(dto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired tokens', async () => {
      mockPrismaService.refreshToken.deleteMany.mockResolvedValue({ count: 5 });

      await service.cleanupExpiredTokens();

      expect(mockPrismaService.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });
  });
});