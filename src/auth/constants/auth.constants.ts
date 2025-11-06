/**
 * Authentication constants for security and configuration
 */
export const AUTH_CONSTANTS = {
  // Password requirements
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  
  // OTP configuration
  OTP_LENGTH: 6,
  OTP_EXPIRY_SECONDS: 180, // 3 minutes
  OTP_RESEND_LOCK_SECONDS: 60, // 1 minute
  
  // Rate limiting
  MAX_LOGIN_ATTEMPTS: 5,
  MAX_OTP_ATTEMPTS: 5,
  LOGIN_BLOCK_SECONDS: 900, // 15 minutes
  OTP_BLOCK_SECONDS: 900, // 15 minutes
  
  // Token configuration
  JWT_EXPIRY_DEFAULT: '90d',
  REFRESH_TOKEN_LENGTH: 32,
  
  // User types allowed for mobile registration
  ALLOWED_MOBILE_TYPES: ['GUEST', 'HOST', 'ADMIN'],
  
  // Security
  BCRYPT_ROUNDS: 12,
  MAX_FULL_NAME_LENGTH: 100,
} as const;

/**
 * Error messages for authentication
 */
export const AUTH_ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Invalid credentials',
  ACCOUNT_LOCKED: 'Account temporarily locked',
  ACCOUNT_DEACTIVATED: 'Account is deactivated',
  MOBILE_ALREADY_VERIFIED: 'Mobile already verified',
  OTP_EXPIRED: 'OTP has expired. Please request a new one.',
  OTP_INVALID: 'Invalid OTP',
  NO_OTP_FOUND: 'No OTP found. Please request a new one.',
  USER_NOT_FOUND: 'User not found',
  MOBILE_ALREADY_REGISTERED: 'Mobile number already registered',
  EMAIL_ALREADY_REGISTERED: 'Email already registered',
  INVALID_USER_TYPE: 'Invalid user type for mobile registration',
  INVALID_PHONE_NUMBER: 'Invalid phone number',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Try again later.',
} as const;
