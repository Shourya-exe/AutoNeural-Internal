import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { organization: true },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    const { passwordHash, ...sanitized } = user;
    return sanitized;
  }

  async findByEmailWithPassword(email: string) {
    return this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
      include: { organization: true },
    });
  }

  async findByEmailAndOrg(email: string, organizationId: string) {
    return this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email: email.toLowerCase().trim(),
        },
      },
      include: { organization: true },
    });
  }
}
