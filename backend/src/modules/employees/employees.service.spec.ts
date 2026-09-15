import { Test, TestingModule } from '@nestjs/testing';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, RemovalRequestStatus, Role } from '@prisma/client';

describe('EmployeesService', () => {
  let employeesService: EmployeesService;
  let prisma: any;
  let notificationsService: any;

  const mockOrgId = 'org-1';
  const mockAdmin1Id = 'admin-1';
  const mockAdmin2Id = 'admin-2';
  const mockEmpId = 'emp-1';
  const mockRequestId = 'req-1';

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      employeeRemovalRequest: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        updateMany: jest.fn(),
      },
      taskAssignment: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockImplementation((cb) => {
        if (typeof cb === 'function') {
          return cb(prisma);
        }
        return Promise.all(cb);
      }),
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    employeesService = module.get<EmployeesService>(EmployeesService);
  });

  it('should be defined', () => {
    expect(employeesService).toBeDefined();
  });

  describe('create', () => {
    it('should throw ConflictException if email is already in use within organization', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(
        employeesService.create(mockOrgId, {
          name: 'Jane Doe',
          email: 'jane@autoneural.in',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully create employee with manually entered domain email and designation', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: mockEmpId,
        organizationId: mockOrgId,
        name: 'Jane Doe',
        email: 'jane@autoneural.in',
        role: Role.EMPLOYEE,
        status: AccountStatus.ACTIVE,
        jobTitle: 'Frontend Engineer',
        passwordHash: 'hashed',
        mustChangePassword: true,
      });

      const created = await employeesService.create(mockOrgId, {
        name: 'Jane Doe',
        email: 'jane@autoneural.in',
        jobTitle: 'Frontend Engineer',
      });

      expect(created.name).toBe('Jane Doe');
      expect(created.email).toBe('jane@autoneural.in');
      expect(created.jobTitle).toBe('Frontend Engineer');
      expect(created.status).toBe(AccountStatus.ACTIVE);
      expect((created as any).passwordHash).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should allow admin to update designation and role', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: mockEmpId,
        organizationId: mockOrgId,
        email: 'emp@autoneural.in',
        role: Role.EMPLOYEE,
        jobTitle: 'Junior Dev',
      });
      prisma.user.update.mockResolvedValue({
        id: mockEmpId,
        role: Role.ADMIN,
        jobTitle: 'Technical Lead',
      });

      const updated = await employeesService.update(mockOrgId, mockEmpId, {
        role: Role.ADMIN,
        jobTitle: 'Technical Lead',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockEmpId },
        data: expect.objectContaining({
          role: Role.ADMIN,
          jobTitle: 'Technical Lead',
        }),
        select: expect.any(Object),
      });
      expect(updated.jobTitle).toBe('Technical Lead');
    });

    it('should prevent demoting the last active administrator', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: mockAdmin1Id,
        organizationId: mockOrgId,
        role: Role.ADMIN,
      });
      prisma.user.count.mockResolvedValue(1); // Only 1 active admin

      await expect(
        employeesService.update(mockOrgId, mockAdmin1Id, {
          role: Role.EMPLOYEE,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Dual-Admin Removal Workflow', () => {
    describe('requestRemoval', () => {
      it('should prevent admin from requesting their own removal', async () => {
        await expect(
          employeesService.requestRemoval(
            mockOrgId,
            mockAdmin1Id,
            mockAdmin1Id,
            'Admin One',
            'Leaving company',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw NotFoundException if employee does not exist', async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        await expect(
          employeesService.requestRemoval(
            mockOrgId,
            'non-existent-id',
            mockAdmin1Id,
            'Admin One',
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw ConflictException if a pending request already exists for this employee', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: mockEmpId, name: 'Target Emp' });
        prisma.employeeRemovalRequest.findFirst.mockResolvedValue({ id: 'existing-req-id' });

        await expect(
          employeesService.requestRemoval(
            mockOrgId,
            mockEmpId,
            mockAdmin1Id,
            'Admin One',
          ),
        ).rejects.toThrow(ConflictException);
      });

      it('should successfully create removal request and notify other admins', async () => {
        prisma.user.findFirst.mockResolvedValue({
          id: mockEmpId,
          name: 'Target Emp',
          email: 'target@autoneural.in',
        });
        prisma.employeeRemovalRequest.findFirst.mockResolvedValue(null);
        prisma.employeeRemovalRequest.create.mockResolvedValue({
          id: mockRequestId,
          employeeId: mockEmpId,
          requestedById: mockAdmin1Id,
          status: RemovalRequestStatus.PENDING,
          reason: 'Resigned',
        });
        prisma.user.findMany.mockResolvedValue([
          { id: mockAdmin2Id, name: 'Admin Two', email: 'admin2@autoneural.in' },
        ]);

        const req = await employeesService.requestRemoval(
          mockOrgId,
          mockEmpId,
          mockAdmin1Id,
          'Admin One',
          'Resigned',
        );

        expect(req.id).toBe(mockRequestId);
        expect(req.status).toBe(RemovalRequestStatus.PENDING);
        expect(notificationsService.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: mockAdmin2Id,
            title: 'Employee Removal Approval Required',
          }),
        );
      });
    });

    describe('approveRemoval', () => {
      it('should throw NotFoundException if removal request is not found', async () => {
        prisma.employeeRemovalRequest.findFirst.mockResolvedValue(null);

        await expect(
          employeesService.approveRemoval(
            mockOrgId,
            'missing-req',
            mockAdmin2Id,
            'Admin Two',
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('should reject approval if the requesting admin attempts to approve their own request', async () => {
        prisma.employeeRemovalRequest.findFirst.mockResolvedValue({
          id: mockRequestId,
          employeeId: mockEmpId,
          requestedById: mockAdmin1Id, // requested by admin-1
          status: RemovalRequestStatus.PENDING,
          employee: { name: 'Emp' },
        });

        // Reviewer is also admin-1
        await expect(
          employeesService.approveRemoval(
            mockOrgId,
            mockRequestId,
            mockAdmin1Id,
            'Admin One',
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should successfully approve removal when approved by a second different admin', async () => {
        prisma.employeeRemovalRequest.findFirst.mockResolvedValue({
          id: mockRequestId,
          employeeId: mockEmpId,
          requestedById: mockAdmin1Id, // requested by Admin 1
          status: RemovalRequestStatus.PENDING,
          employee: { id: mockEmpId, name: 'Target Emp', email: 'target@autoneural.in' },
          requestedBy: { id: mockAdmin1Id, name: 'Admin One' },
        });

        prisma.employeeRemovalRequest.update.mockResolvedValue({
          id: mockRequestId,
          status: RemovalRequestStatus.APPROVED,
          reviewedById: mockAdmin2Id,
        });

        // Reviewer is Admin 2
        const result = await employeesService.approveRemoval(
          mockOrgId,
          mockRequestId,
          mockAdmin2Id,
          'Admin Two',
          'Confirmed resignation letter',
        );

        expect(result.success).toBe(true);
        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: mockEmpId },
          data: { status: AccountStatus.INACTIVE },
        });
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
          where: { userId: mockEmpId, revoked: false },
          data: { revoked: true },
        });
        // Notifies original requesting admin
        expect(notificationsService.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: mockAdmin1Id,
            title: 'Employee Removal Request Approved',
          }),
        );
      });
    });

    describe('rejectRemoval', () => {
      it('should allow another admin to reject a removal request', async () => {
        prisma.employeeRemovalRequest.findFirst.mockResolvedValue({
          id: mockRequestId,
          employeeId: mockEmpId,
          requestedById: mockAdmin1Id,
          status: RemovalRequestStatus.PENDING,
          employee: { id: mockEmpId, name: 'Target Emp' },
        });

        prisma.employeeRemovalRequest.update.mockResolvedValue({
          id: mockRequestId,
          status: RemovalRequestStatus.REJECTED,
          reviewedById: mockAdmin2Id,
        });

        const result = await employeesService.rejectRemoval(
          mockOrgId,
          mockRequestId,
          mockAdmin2Id,
          'Admin Two',
          'Role is still essential',
        );

        expect(result.success).toBe(true);
        expect(notificationsService.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: mockAdmin1Id,
            title: 'Employee Removal Request Rejected',
          }),
        );
      });
    });
  });

  describe('deactivate (legacy direct)', () => {
    it('should prevent admin from deactivating their own account', async () => {
      await expect(
        employeesService.deactivate(mockOrgId, mockAdmin1Id, mockAdmin1Id),
      ).rejects.toThrow(BadRequestException);
    });

    it('should deactivate employee and revoke active sessions', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: mockEmpId,
        name: 'Employee',
      });

      const result = await employeesService.deactivate(mockOrgId, mockEmpId, mockAdmin1Id);

      expect(result.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockEmpId },
        data: { status: AccountStatus.INACTIVE },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockEmpId, revoked: false },
        data: { revoked: true },
      });
    });
  });
});
