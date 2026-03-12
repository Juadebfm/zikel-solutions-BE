-- Add dedicated OTP purpose for privileged-session MFA challenges.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'mfa_challenge';
