import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { UserType, UserRole } from '@prisma/client';
import { Response } from 'express';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { MobileVerificationDto, VerifyMobileDto } from '../dto/mobile-verification.dto';
import { ResetDto } from '../dto/reset.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    googleLogin: jest.fn(),
    refreshToken: jest.fn(),
    requestMobileVerification: jest.fn(),
    verifyMobile: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  };

  const mockUser = {
    id: 'user-123',
    fullName: 'Test User',
    mobile: '+201234567890',
    email: 'test@example.com',
    type: UserType.GUEST,
    role: UserRole.GUEST,
    isVerified: true,
    isActive: true,
    lastLoginAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAuthResponse = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    user: mockUser,
    expiresIn: 3600,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    const registerDto: any = {
      fullName: 'Test User',
      mobile: '01234567890',
      email: 'test@example.com',
      password: 'Password123!',
      userType: UserType.GUEST,
      acceptTerms: true,
    };

    it('should register a new user', async () => {
      const expectedResponse = {
        message: 'Registration successful. Please verify your mobile number.',
        mobile: '+201234567890',
      };

      mockAuthService.register.mockResolvedValue(expectedResponse);

      const result = await controller.register(registerDto);

      expect(result).toEqual(expectedResponse);
      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(authService.register).toHaveBeenCalledTimes(1);
    });

    it('should pass through service errors', async () => {
      const error = new Error('Registration failed');
      mockAuthService.register.mockRejectedValue(error);

      await expect(controller.register(registerDto)).rejects.toThrow(error);
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      mobile: '01234567890',
      password: 'Password123!',
      rememberMe: false,
    };

    it('should login successfully', async () => {
      mockAuthService.login.mockResolvedValue(mockAuthResponse);

      const result = await controller.login(loginDto);

      expect(result).toEqual(mockAuthResponse);
      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(authService.login).toHaveBeenCalledTimes(1);
    });

    it('should login with rememberMe enabled', async () => {
      const loginDtoWithRememberMe = { ...loginDto, rememberMe: true };
      mockAuthService.login.mockResolvedValue(mockAuthResponse);

      const result = await controller.login(loginDtoWithRememberMe);

      expect(result).toEqual(mockAuthResponse);
      expect(authService.login).toHaveBeenCalledWith(loginDtoWithRememberMe);
    });

    it('should pass through service errors', async () => {
      const error = new Error('Invalid credentials');
      mockAuthService.login.mockRejectedValue(error);

      await expect(controller.login(loginDto)).rejects.toThrow(error);
    });
  });

  describe('redirectToGoogle', () => {
    it('should redirect to Google OAuth', async () => {
      const mockResponse = {
        redirect: jest.fn(),
      } as unknown as Response;

      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback';

      await controller.redirectToGoogle(mockResponse);

      expect(mockResponse.redirect).toHaveBeenCalled();
      const redirectUrl = (mockResponse.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(redirectUrl).toContain('test-client-id');
    });
  });

  describe('googleCallback', () => {
    it('should handle Google OAuth callback', async () => {
      const code = 'google-auth-code';
      mockAuthService.googleLogin.mockResolvedValue(mockAuthResponse);

      const result = await controller.googleCallback(code);

      expect(result).toEqual(mockAuthResponse);
      expect(authService.googleLogin).toHaveBeenCalledWith(code);
    });

    it('should pass through service errors', async () => {
      const code = 'invalid-code';
      const error = new Error('Google login failed');
      mockAuthService.googleLogin.mockRejectedValue(error);

      await expect(controller.googleCallback(code)).rejects.toThrow(error);
    });
  });

  describe('refreshToken', () => {
    const refreshTokenDto: RefreshTokenDto = {
      refreshToken: 'valid-refresh-token',
    };

    it('should refresh token successfully', async () => {
      const expectedResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mockAuthService.refreshToken.mockResolvedValue(expectedResponse);

      const result = await controller.refreshToken(refreshTokenDto);

      expect(result).toEqual(expectedResponse);
      expect(authService.refreshToken).toHaveBeenCalledWith(refreshTokenDto);
    });

    it('should pass through service errors', async () => {
      const error = new Error('Invalid refresh token');
      mockAuthService.refreshToken.mockRejectedValue(error);

      await expect(controller.refreshToken(refreshTokenDto)).rejects.toThrow(error);
    });
  });

  describe('requestMobileVerification', () => {
    const dto: MobileVerificationDto = {
      mobile: '01234567890',
    };

    it('should request mobile verification', async () => {
      const expectedResponse = {
        message: 'OTP sent to your mobile number',
      };

      mockAuthService.requestMobileVerification.mockResolvedValue(expectedResponse);

      const result = await controller.requestMobileVerification(dto);

      expect(result).toEqual(expectedResponse);
      expect(authService.requestMobileVerification).toHaveBeenCalledWith(dto);
    });

    it('should pass through service errors', async () => {
      const error = new Error('User not found');
      mockAuthService.requestMobileVerification.mockRejectedValue(error);

      await expect(controller.requestMobileVerification(dto)).rejects.toThrow(error);
    });
  });

  describe('verifyMobile', () => {
    const dto: VerifyMobileDto = {
      mobile: '01234567890',
      otp: '123456',
    };

    it('should verify mobile successfully', async () => {
      const expectedResponse = {
        message: 'Mobile number verified successfully',
      };

      mockAuthService.verifyMobile.mockResolvedValue(expectedResponse);

      const result = await controller.verifyMobile(dto);

      expect(result).toEqual(expectedResponse);
      expect(authService.verifyMobile).toHaveBeenCalledWith(dto);
    });

    it('should pass through service errors', async () => {
      const error = new Error('Invalid OTP');
      mockAuthService.verifyMobile.mockRejectedValue(error);

      await expect(controller.verifyMobile(dto)).rejects.toThrow(error);
    });
  });

  describe('forgotPassword', () => {
    const dto: MobileVerificationDto = {
      mobile: '01234567890',
    };

    it('should request password reset OTP', async () => {
      const expectedResponse = {
        message: 'If the mobile number is registered, an OTP has been sent',
      };

      mockAuthService.forgotPassword.mockResolvedValue(expectedResponse);

      const result = await controller.forgotPassword(dto);

      expect(result).toEqual(expectedResponse);
      expect(authService.forgotPassword).toHaveBeenCalledWith(dto);
    });

    it('should pass through service errors', async () => {
      const error = new Error('Rate limit exceeded');
      mockAuthService.forgotPassword.mockRejectedValue(error);

      await expect(controller.forgotPassword(dto)).rejects.toThrow(error);
    });
  });

  describe('resetPassword', () => {
    const dto: ResetDto = {
      mobile: '01234567890',
      otp: '123456',
      newPassword: 'NewPassword123!',
      newPasswordConfirm: 'NewPassword123!',
    };

    it('should reset password successfully', async () => {
      const expectedResponse = {
        message: 'Password reset successfully',
      };

      mockAuthService.resetPassword.mockResolvedValue(expectedResponse);

      const result = await controller.resetPassword(dto);

      expect(result).toEqual(expectedResponse);
      expect(authService.resetPassword).toHaveBeenCalledWith(dto);
    });

    it('should pass through service errors', async () => {
      const error = new Error('Invalid OTP');
      mockAuthService.resetPassword.mockRejectedValue(error);

      await expect(controller.resetPassword(dto)).rejects.toThrow(error);
    });
  });

  describe('ThrottlerGuard', () => {
    it('should be applied to the controller', () => {
      const guards = Reflect.getMetadata('__guards__', AuthController);
      expect(guards).toBeDefined();
    });
  });
});