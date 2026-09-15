import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeFilterDto } from './dto/employee-filter.dto';
import { AccountStatus, NotificationType, RemovalRequestStatus, Role, TaskStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(organizationId: string, dto: CreateEmployeeDto) {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`An employee with email ${email} already exists`);
    }

    const rawPassword = dto.password || crypto.randomBytes(8).toString('base64url');
    const passwordHash = await bcrypt.hash(rawPassword, 12);

    const employee = await this.prisma.user.create({
      data: {
        organizationId,
        email,
        name: dto.name.trim(),
        role: dto.role || Role.EMPLOYEE,
        status: AccountStatus.ACTIVE,
        department: dto.department?.trim() || null,
        jobTitle: dto.jobTitle?.trim() || null,
        avatarUrl: dto.avatarUrl || null,
        passwordHash,
        mustChangePassword: true,
      },
    });

    const { passwordHash: _, ...sanitized } = employee;
    return {
      ...sanitized,
      initialPassword: dto.password ? undefined : rawPassword,
    };
  }

  async findAll(organizationId: string, query: EmployeeFilterDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (query.role) {
      where.role = query.role;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
        { jobTitle: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          email: true,
          name: true,
          role: true,
          status: true,
          department: true,
          jobTitle: true,
          avatarUrl: true,
          mustChangePassword: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              assignments: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: users.map((u) => ({
        ...u,
        assignedTasksCount: u._count.assignments,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        organizationId: true,
        email: true,
        name: true,
        role: true,
        status: true,
        department: true,
        jobTitle: true,
        avatarUrl: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
        assignments: {
          include: {
            task: {
              select: {
                id: true,
                number: true,
                title: true,
                status: true,
                priority: true,
                progress: true,
                dueDate: true,
              },
            },
          },
          orderBy: { assignedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    // Compute task counts
    const counts = await this.prisma.taskAssignment.groupBy({
      by: ['employeeId'],
      where: { employeeId: id },
      _count: true,
    });

    const completedCount = await this.prisma.taskAssignment.count({
      where: {
        employeeId: id,
        task: { status: TaskStatus.COMPLETED },
      },
    });

    const inProgressCount = await this.prisma.taskAssignment.count({
      where: {
        employeeId: id,
        task: { status: TaskStatus.IN_PROGRESS },
      },
    });

    return {
      ...user,
      stats: {
        totalAssigned: counts[0]?._count || 0,
        completed: completedCount,
        inProgress: inProgressCount,
      },
    };
  }

  async update(organizationId: string, id: string, dto: UpdateEmployeeDto) {
    const existing = await this.prisma.user.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    if (dto.email && dto.email.toLowerCase().trim() !== existing.email) {
      const emailConflict = await this.prisma.user.findUnique({
        where: {
          organizationId_email: {
            organizationId,
            email: dto.email.toLowerCase().trim(),
          },
        },
      });

      if (emailConflict) {
        throw new ConflictException(`Email ${dto.email} is already in use`);
      }
    }

    if (dto.role === Role.EMPLOYEE && existing.role === Role.ADMIN) {
      const adminCount = await this.prisma.user.count({
        where: { organizationId, role: Role.ADMIN, status: AccountStatus.ACTIVE },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot demote the last remaining active administrator');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        email: dto.email !== undefined ? dto.email.toLowerCase().trim() : undefined,
        role: dto.role !== undefined ? dto.role : undefined,
        department: dto.department !== undefined ? dto.department?.trim() : undefined,
        jobTitle: dto.jobTitle !== undefined ? dto.jobTitle?.trim() : undefined,
        avatarUrl: dto.avatarUrl !== undefined ? dto.avatarUrl : undefined,
      },
      select: {
        id: true,
        organizationId: true,
        email: true,
        name: true,
        role: true,
        status: true,
        department: true,
        jobTitle: true,
        avatarUrl: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async requestRemoval(
    organizationId: string,
    employeeId: string,
    requestedById: string,
    requestedByName: string,
    reason?: string,
  ) {
    if (employeeId === requestedById) {
      throw new BadRequestException('You cannot request your own removal');
    }

    const employee = await this.prisma.user.findFirst({
      where: { id: employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${employeeId} not found`);
    }

    // Check if there is already an active pending request
    const existingPending = await this.prisma.employeeRemovalRequest.findFirst({
      where: {
        organizationId,
        employeeId,
        status: RemovalRequestStatus.PENDING,
      },
    });

    if (existingPending) {
      throw new ConflictException('A removal request for this employee is already pending review');
    }

    const request = await this.prisma.employeeRemovalRequest.create({
      data: {
        organizationId,
        employeeId,
        requestedById,
        reason: reason?.trim() || null,
        status: RemovalRequestStatus.PENDING,
      },
      include: {
        employee: {
          select: { id: true, name: true, email: true, jobTitle: true, role: true },
        },
        requestedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Notify all other active admins in the organization
    const otherAdmins = await this.prisma.user.findMany({
      where: {
        organizationId,
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        id: { not: requestedById },
      },
    });

    for (const admin of otherAdmins) {
      await this.notificationsService.create({
        userId: admin.id,
        type: NotificationType.REMOVAL_REQUESTED,
        title: 'Employee Removal Approval Required',
        message: `Admin ${requestedByName} has requested removal of ${employee.name} (${employee.email}). Second admin approval is required.`,
      });
    }

    return request;
  }

  async findAllRemovalRequests(organizationId: string, status?: RemovalRequestStatus) {
    const where: any = { organizationId };
    if (status) {
      where.status = status;
    }

    return this.prisma.employeeRemovalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: { id: true, name: true, email: true, role: true, status: true, jobTitle: true },
        },
        requestedBy: {
          select: { id: true, name: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async approveRemoval(
    organizationId: string,
    requestId: string,
    reviewerId: string,
    reviewerName: string,
    note?: string,
  ) {
    const request = await this.prisma.employeeRemovalRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { employee: true, requestedBy: true },
    });

    if (!request) {
      throw new NotFoundException(`Removal request with ID ${requestId} not found`);
    }

    if (request.status !== RemovalRequestStatus.PENDING) {
      throw new BadRequestException(`Removal request has already been ${request.status.toLowerCase()}`);
    }

    // DUAL-AUTHORIZATION RULE: An admin cannot approve their own removal request!
    if (request.requestedById === reviewerId) {
      throw new ForbiddenException(
        'Dual-authorization required: You cannot approve your own employee removal request. Another admin must review and approve it.',
      );
    }

    // Execute deactivation and update request in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.employeeRemovalRequest.update({
        where: { id: requestId },
        data: {
          status: RemovalRequestStatus.APPROVED,
          reviewedById: reviewerId,
          reviewNote: note?.trim() || null,
          reviewedAt: new Date(),
        },
        include: {
          employee: {
            select: { id: true, name: true, email: true },
          },
          requestedBy: {
            select: { id: true, name: true, email: true },
          },
          reviewedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      // Deactivate the employee
      await tx.user.update({
        where: { id: request.employeeId },
        data: { status: AccountStatus.INACTIVE },
      });

      // Revoke all active sessions
      await tx.refreshToken.updateMany({
        where: { userId: request.employeeId, revoked: false },
        data: { revoked: true },
      });

      return updatedRequest;
    });

    // Notify the requesting admin
    await this.notificationsService.create({
      userId: request.requestedById,
      type: NotificationType.REMOVAL_APPROVED,
      title: 'Employee Removal Request Approved',
      message: `Admin ${reviewerName} approved the removal of ${request.employee.name}. Account is now deactivated.`,
    });

    return {
      success: true,
      message: `Removal of ${request.employee.name} has been approved and executed.`,
      request: result,
    };
  }

  async rejectRemoval(
    organizationId: string,
    requestId: string,
    reviewerId: string,
    reviewerName: string,
    note?: string,
  ) {
    const request = await this.prisma.employeeRemovalRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { employee: true, requestedBy: true },
    });

    if (!request) {
      throw new NotFoundException(`Removal request with ID ${requestId} not found`);
    }

    if (request.status !== RemovalRequestStatus.PENDING) {
      throw new BadRequestException(`Removal request has already been ${request.status.toLowerCase()}`);
    }

    const updatedRequest = await this.prisma.employeeRemovalRequest.update({
      where: { id: requestId },
      data: {
        status: RemovalRequestStatus.REJECTED,
        reviewedById: reviewerId,
        reviewNote: note?.trim() || null,
        reviewedAt: new Date(),
      },
      include: {
        employee: {
          select: { id: true, name: true, email: true },
        },
        requestedBy: {
          select: { id: true, name: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Notify the requesting admin
    await this.notificationsService.create({
      userId: request.requestedById,
      type: NotificationType.REMOVAL_REJECTED,
      title: 'Employee Removal Request Rejected',
      message: `Admin ${reviewerName} rejected the removal of ${request.employee.name}.${note ? ` Reason: "${note}"` : ''}`,
    });

    return {
      success: true,
      message: `Removal request for ${request.employee.name} was rejected.`,
      request: updatedRequest,
    };
  }

  async deactivate(organizationId: string, id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('You cannot deactivate your own admin account');
    }

    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
    });

    if (!user) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { status: AccountStatus.INACTIVE },
      }),
      // Revoke all refresh tokens
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true },
      }),
    ]);

    return { success: true, message: `Account for ${user.name} has been deactivated` };
  }

  async reactivate(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
    });

    if (!user) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    await this.prisma.user.update({
      where: { id },
      data: { status: AccountStatus.ACTIVE },
    });

    return { success: true, message: `Account for ${user.name} has been reactivated` };
  }
}
