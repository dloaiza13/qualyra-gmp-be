export const ErrorCode = {
  Forbidden: 'FORBIDDEN',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  InternalError: 'INTERNAL_ERROR',
  NotFound: 'NOT_FOUND',
  PasswordResetInvalid: 'PASSWORD_RESET_INVALID',
  PublicRegistrationDisabled: 'PUBLIC_REGISTRATION_DISABLED',
  RateLimitExceeded: 'RATE_LIMIT_EXCEEDED',
  SessionExpired: 'SESSION_EXPIRED',
  SessionRevoked: 'SESSION_REVOKED',
  SlugAlreadyExists: 'SLUG_ALREADY_EXISTS',
  Unauthorized: 'UNAUTHORIZED',
  ValidationError: 'VALIDATION_ERROR',
  VerificationTokenInvalid: 'VERIFICATION_TOKEN_INVALID',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
