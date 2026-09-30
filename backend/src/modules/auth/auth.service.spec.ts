import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let authService: AuthService;
  let prismaService: any;
  let jwtService: any;
  let emailService: { sendEmail: jest.Mock };
  let config: Record<string, string | null>;

  const mockUser = {
    id: 'user-1',
    organizationId: 'org-1',
    email: 'info@autoneural.in',
    name: 'Admin User',
    role: Role.ADMIN,
    status: AccountStatus.ACTIVE,
    passwordHash: '',
    mustChangePassword: false,
  };

  beforeAll(async () => {
    mockUser.passwordHash = await bcrypt.hash('Password123!', 10);
  });

  beforeEach(async () => {
    prismaService = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: 'rt-1' }),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      organization: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => (typeof cb === 'function' ? cb(prismaService) : Promise.all(cb))),
    };

    emailService = { sendEmail: jest.fn().mockResolvedValue({ success: true }) };
    config = {
      JWT_ACCESS_SECRET: "test-access-secret-that-is-long-enough-123",
      JWT_REFRESH_SECRET: "test-refresh-secret-that-is-long-enough-456",
      FRONTEND_URL: "https://app.example.com",
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mocked.jwt.token'),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => config[key] ?? null),
          },
        },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  describe('login', () => {
    it('should successfully log in user with valid credentials', async () => {
      prismaService.user.findFirst.mockResolvedValue(mockUser);

      const result = await authService.login({
        email: 'info@autoneural.in',
        password: 'Password123!',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(mockUser.email);
      expect((result.user as any).passwordHash).toBeUndefined(); // Verify passwordHash is stripped
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      prismaService.user.findFirst.mockResolvedValue(mockUser);

      await expect(
        authService.login({
          email: 'info@autoneural.in',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user does not exist', async () => {
      prismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'nonexistent@autoneural.in',
          password: 'Password123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if account is inactive', async () => {
      prismaService.user.findFirst.mockResolvedValue({
        ...mockUser,
        status: AccountStatus.INACTIVE,
      });

      await expect(
        authService.login({
          email: 'info@autoneural.in',
          password: 'Password123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('should throw BadRequestException if current password does not match', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        authService.changePassword(mockUser.id, {
          currentPassword: 'WrongCurrentPassword',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if new password is same as current password', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        authService.changePassword(mockUser.id, {
          currentPassword: 'Password123!',
          newPassword: 'Password123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('forgotPassword', () => {
    it('emails a single-use link and never returns or exposes the token', async () => {
      prismaService.user.findFirst.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('reset.jwt.token');

      const result = await authService.forgotPassword('info@autoneural.in');

      expect(result).not.toHaveProperty('resetToken');
      expect(JSON.stringify(result)).not.toContain('reset.jwt.token');
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      const mail = emailService.sendEmail.mock.calls[0][0];
      expect(mail.to).toBe(mockUser.email);
      expect(mail.text).toContain('https://app.example.com/reset-password?token=reset.jwt.token');
      // Signed with a dedicated key (not the access-token secret) and bound to the current password.
      const [payload, options] = jwtService.sign.mock.calls[0];
      expect(payload.purpose).toBe('password_reset');
      expect(payload.pwd).toHaveLength(16);
      expect(options.secret).not.toBe(config.JWT_ACCESS_SECRET);
    });

    it('gives the same answer for unknown emails and sends nothing', async () => {
      prismaService.user.findFirst.mockResolvedValue(null);
      const unknown = await authService.forgotPassword('nobody@example.com');
      prismaService.user.findFirst.mockResolvedValue(mockUser);
      const known = await authService.forgotPassword('info@autoneural.in');
      expect(unknown).toEqual(known);
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetPassword', () => {
    it('rejects a link that was already used (password changed since)', async () => {
      jwtService.verify.mockReturnValue({ sub: mockUser.id, purpose: 'password_reset', pwd: 'stale-fingerprint' });
      prismaService.user.findUnique.mockResolvedValue(mockUser);
      await expect(authService.resetPassword({ token: 't', newPassword: 'BrandNewPass123!' })).rejects.toThrow(BadRequestException);
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('is disabled unless ALLOW_PUBLIC_REGISTRATION=true', async () => {
      await expect(
        authService.register({ organizationName: 'X', organizationSlug: 'x', adminName: 'A', adminEmail: 'a@x.com', password: 'Password123!' } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaService.organization.create).not.toHaveBeenCalled();
    });
  });
});
