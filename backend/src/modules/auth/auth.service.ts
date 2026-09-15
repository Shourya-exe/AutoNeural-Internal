import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RegisterDto } from './dto/register.dto';
import { AccountStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async register(dto: RegisterDto) {
    const existingOrg = await this.prisma.organization.findUnique({
      where: { slug: dto.organizationSlug.toLowerCase() },
    });
    if (existingOrg) {
      throw new ConflictException('Organization slug is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const result = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.organizationName,
          slug: dto.organizationSlug.toLowerCase(),
        },
      });

      const admin = await tx.user.create({
        data: {
          organizationId: org.id,
          name: dto.adminName,
          email: dto.adminEmail.toLowerCase().trim(),
          role: Role.ADMIN,
          status: AccountStatus.ACTIVE,
          passwordHash,
        },
      });

      return { org, admin };
    });

    const tokens = await this.generateTokens(result.admin);
    return {
      organization: result.org,
      user: this.sanitizeUser(result.admin),
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({
      where: { email },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === AccountStatus.INACTIVE) {
      throw new UnauthorizedException('Account has been deactivated. Contact your administrator.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokens(user);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'autoneural-jwt-refresh-secret-fallback',
      });

      const tokenHash = this.hashToken(refreshToken);
      const storedToken = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
        throw new UnauthorizedException('Refresh token is invalid, expired, or revoked');
      }

      if (storedToken.user.status === AccountStatus.INACTIVE) {
        throw new UnauthorizedException('Account is deactivated');
      }

      // Rotate token: revoke old, issue new
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      });

      const tokens = await this.generateTokens(storedToken.user);
      return tokens;
    } catch (err: any) {
      this.logger.warn(`Refresh token failure: ${err?.message || err}`);
      throw new UnauthorizedException(err?.message || 'Invalid or expired refresh token');
    }
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash },
        data: { revoked: true },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });
    }
    return { success: true, message: 'Logged out successfully' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const validCurrent = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!validCurrent) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const newHash = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
        },
      }),
      // Revoke all existing sessions upon password change
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
    ]);

    return { success: true, message: 'Password changed successfully. Please log in again.' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      // Return neutral message to prevent user enumeration
      return {
        success: true,
        message: 'If an account exists with that email, password reset instructions have been generated.',
      };
    }

    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'password_reset' },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '1h',
      },
    );

    this.logger.log(`Password reset requested for ${user.email}. Token: ${resetToken}`);

    return {
      success: true,
      message: 'Password reset token generated.',
      resetToken, // Provided in development response for easy testing
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    try {
      const payload = this.jwtService.verify(dto.token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      if (payload.purpose !== 'password_reset') {
        throw new BadRequestException('Invalid token purpose');
      }

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const newHash = await bcrypt.hash(dto.newPassword, 12);

      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: newHash,
            mustChangePassword: false,
          },
        }),
        this.prisma.refreshToken.updateMany({
          where: { userId: user.id, revoked: false },
          data: { revoked: true },
        }),
      ]);

      return { success: true, message: 'Password reset successfully. You may now log in.' };
    } catch (e) {
      throw new BadRequestException('Password reset token is invalid or has expired');
    }
  }

  private async generateTokens(user: { id: string; email: string; role: Role; organizationId: string }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET') || 'autoneural-jwt-access-secret-fallback',
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m',
    });

    const refreshPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      jti: crypto.randomUUID(),
    };

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'autoneural-jwt-refresh-secret-fallback',
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d',
    });

    // Store hashed refresh token in database
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
