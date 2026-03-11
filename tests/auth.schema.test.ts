import { describe, expect, it } from 'vitest';
import {
  ResetPasswordBodySchema,
  VerifyOtpBodySchema,
  ResendOtpBodySchema,
} from '../src/modules/auth/auth.schema.js';

describe('auth schema contracts', () => {
  it('accepts reset-password payload with email identifier', () => {
    const result = ResetPasswordBodySchema.safeParse({
      email: 'jane@example.com',
      code: '123456',
      newPassword: 'NewPassword1!',
      confirmPassword: 'NewPassword1!',
    });

    expect(result.success).toBe(true);
  });

  it('rejects reset-password payload using legacy userId identifier', () => {
    const result = ResetPasswordBodySchema.safeParse({
      userId: 'user_1',
      code: '123456',
      newPassword: 'NewPassword1!',
      confirmPassword: 'NewPassword1!',
    });

    expect(result.success).toBe(false);
  });

  it('supports verify-otp with either email or userId', () => {
    const emailResult = VerifyOtpBodySchema.safeParse({
      email: 'jane@example.com',
      code: '123456',
    });
    const userIdResult = VerifyOtpBodySchema.safeParse({
      userId: 'user_1',
      code: '123456',
      purpose: 'email_verification',
    });

    expect(emailResult.success).toBe(true);
    expect(userIdResult.success).toBe(true);
  });

  it('supports resend-otp with either email or userId', () => {
    const emailResult = ResendOtpBodySchema.safeParse({
      email: 'jane@example.com',
    });
    const userIdResult = ResendOtpBodySchema.safeParse({
      userId: 'user_1',
      purpose: 'password_reset',
    });

    expect(emailResult.success).toBe(true);
    expect(userIdResult.success).toBe(true);
  });
});
