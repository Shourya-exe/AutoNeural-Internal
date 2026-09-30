import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { jwtSecret } from '../../common/config/secrets';
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
    private readonly emailService: EmailService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** Reset tokens use their own key so they can never pass as access tokens. */
  private resetSecret() {
    return crypto.createHmac('sha256', jwtSecret(this.configService, 'JWT_ACCESS_SECRET')).update('password-reset').digest('hex');
  }

  /** Binds a reset token to the current password, so it stops working once used. */
  private passwordFingerprint(passwordHash: string) {
    return crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
  }

  async register(dto: RegisterDto) {
    // Creating a new organization is an operator decision, not a public sign-up form.
    if (this.configService.get<string>('ALLOW_PUBLIC_REGISTRATION') !== 'true') {
      throw new ForbiddenException('Registration is disabled.');
    }
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
      this.jwtService.verify(refreshToken, {
        secret: jwtSecret(this.configService, 'JWT_REFRESH_SECRET'),
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
      throw new UnauthorizedException('Invalid or expired refresh token');
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

  /**
   * Emails a one-hour, single-use reset link. The response is identical whether or not the
   * account exists, and the token is never returned or logged: only the mailbox owner can use it.
   */
  async forgotPassword(email: string) {
    const neutral = {
      success: true,
      message: 'If an account exists with that email, a password reset link has been sent to it.',
    };
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || user.status === AccountStatus.INACTIVE) return neutral;

    const resetToken = this.jwtService.sign(
      { sub: user.id, purpose: 'password_reset', pwd: this.passwordFingerprint(user.passwordHash) },
      { secret: this.resetSecret(), expiresIn: '1h' },
    );
    const base = (
      this.configService.get<string>('PASSWORD_RESET_URL')?.trim() ||
      `${(this.configService.get<string>('FRONTEND_URL') ?? '').split(',')[0].trim().replace(/\/+$/, '')}/reset-password`
    );
    const link = `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(resetToken)}`;
    const result = await this.emailService.sendEmail({
      to: user.email,
      subject: 'Reset your AutoNeural password',
      html: `<p>Hello,</p><p>Someone asked to reset the password for this account. If it was you, open the link below within one hour. It works once.</p><p><a href="${link.replace(/"/g, '&quot;')}">Reset my password</a></p><p>If you did not ask for this, ignore this email; your password is unchanged.</p>`,
      text: `Someone asked to reset the password for this account. If it was you, open this link within one hour (it works once):\n${link}\n\nIf you did not ask for this, ignore this email.`,
    });
    if (!result.success) this.logger.error(`Password reset email to user ${user.id} failed: ${result.error}`);
    else this.logger.log(`Password reset link sent to user ${user.id}`);
    return neutral;
  }

  async resetPassword(dto: ResetPasswordDto) {
    try {
      const payload = this.jwtService.verify(dto.token, { secret: this.resetSecret() });

      if (payload.purpose !== 'password_reset') {
        throw new BadRequestException('Invalid token purpose');
      }

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status === AccountStatus.INACTIVE) {
        throw new NotFoundException('User not found');
      }
      if (payload.pwd !== this.passwordFingerprint(user.passwordHash)) {
        throw new BadRequestException('This reset link has already been used.');
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
      secret: jwtSecret(this.configService, 'JWT_ACCESS_SECRET'),
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
      secret: jwtSecret(this.configService, 'JWT_REFRESH_SECRET'),
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
