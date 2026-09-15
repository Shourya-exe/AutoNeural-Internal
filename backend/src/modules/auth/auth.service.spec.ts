import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let authService: AuthService;
  let prismaService: any;
  let jwtService: any;

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
            get: jest.fn((key: string) => {
              if (key === 'JWT_ACCESS_SECRET') return 'test-access-secret';
              if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
              return null;
            }),
          },
        },
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
});
