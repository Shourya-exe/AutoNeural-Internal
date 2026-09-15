import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AccountStatus,
  ApprovalStatus,
  AttachmentPurpose,
  AttachmentType,
  Role,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';

describe('TasksService', () => {
  let tasksService: TasksService;
  let prisma: any;
  let activitiesService: any;
  let notificationsService: any;

  const mockOrgId = 'org-123';
  const mockAdminId = 'admin-123';
  const mockEmpId = 'emp-123';

  const mockAdminUser = {
    id: mockAdminId,
    email: 'admin@autoneural.in',
    organizationId: mockOrgId,
    role: Role.ADMIN,
    name: 'Admin User',
  };

  const mockEmpUser = {
    id: mockEmpId,
    email: 'emp@autoneural.in',
    organizationId: mockOrgId,
    role: Role.EMPLOYEE,
    name: 'Manyu Employee',
  };

  const mockTask = {
    id: 'task-1',
    number: 1,
    organizationId: mockOrgId,
    createdById: mockAdminId,
    title: 'Test Task Title',
    description: 'Test description',
    priority: TaskPriority.MEDIUM,
    status: TaskStatus.TODO,
    progress: 0,
    project: 'Testing',
    completedAt: null,
    version: 1,
    assignments: [{ employeeId: mockEmpId, employee: { name: 'Manyu' } }],
  };

  beforeEach(async () => {
    prisma = {
      task: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      taskAssignment: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      taskAttachment: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => (typeof cb === 'function' ? cb(prisma) : Promise.all(cb))),
    };

    activitiesService = {
      log: jest.fn().mockResolvedValue({ id: 'act-1' }),
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActivitiesService, useValue: activitiesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    tasksService = module.get<TasksService>(TasksService);
  });

  it('should be defined', () => {
    expect(tasksService).toBeDefined();
  });

  describe('create', () => {
    it('should throw BadRequestException if assigned employee is inactive or not found', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await expect(
        tasksService.create(mockOrgId, mockAdminId, 'Admin', {
          title: 'Deploy microservices',
          employeeIds: ['invalid-or-inactive-id'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should automatically set progress to 100 if status is COMPLETED', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: mockEmpId, status: AccountStatus.ACTIVE },
      ]);
      prisma.task.create.mockImplementation(({ data }) => ({
        ...mockTask,
        ...data,
      }));

      const created = await tasksService.create(mockOrgId, mockAdminId, 'Admin', {
        title: 'Review codebase',
        status: TaskStatus.COMPLETED,
        employeeIds: [mockEmpId],
      });

      expect(created.progress).toBe(100);
      expect(created.status).toBe(TaskStatus.COMPLETED);
      expect(created.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateStatus', () => {
    it('should forbid employee from updating status on unassigned tasks', async () => {
      prisma.task.findFirst.mockResolvedValue({
        ...mockTask,
        assignments: [{ employeeId: 'different-emp-id' }],
      });

      await expect(
        tasksService.updateStatus(mockOrgId, mockTask.id, 'unauthorized-emp', Role.EMPLOYEE, 'Hacker', {
          status: TaskStatus.IN_PROGRESS,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow assigned employee to update status and log activity', async () => {
      prisma.task.findFirst.mockResolvedValue(mockTask);
      prisma.task.update.mockResolvedValue({
        ...mockTask,
        status: TaskStatus.IN_PROGRESS,
      });

      const updated = await tasksService.updateStatus(mockOrgId, mockTask.id, mockEmpId, Role.EMPLOYEE, 'Manyu', {
        status: TaskStatus.IN_PROGRESS,
        comment: 'Started working on this task',
      });

      expect(updated.status).toBe(TaskStatus.IN_PROGRESS);
      expect(activitiesService.log).toHaveBeenCalled();
      expect(notificationsService.create).toHaveBeenCalled();
    });
  });

  describe('updateProgress', () => {
    it('should auto-complete task when progress reaches 100%', async () => {
      prisma.task.findFirst.mockResolvedValue(mockTask);
      prisma.task.update.mockImplementation(({ data }) => ({
        ...mockTask,
        ...data,
      }));

      const updated = await tasksService.updateProgress(mockOrgId, mockTask.id, mockEmpId, Role.EMPLOYEE, 'Manyu', {
        progress: 100,
        comment: 'All finished!',
      });

      expect(updated.progress).toBe(100);
      expect(updated.status).toBe(TaskStatus.COMPLETED);
      expect(updated.completedAt).toBeDefined();
    });
  });

  describe('Task Attachments, Deliverables & Approval Workflow', () => {
    it('should allow Admin to attach a reference link', async () => {
      prisma.task.findFirst.mockResolvedValue(mockTask);
      prisma.taskAttachment.create.mockResolvedValue({
        id: 'att-1',
        taskId: mockTask.id,
        name: 'Figma UI Mockups',
        type: AttachmentType.LINK,
        url: 'https://figma.com/design/123',
        purpose: AttachmentPurpose.REFERENCE,
      });

      const att = await tasksService.attachLink(mockOrgId, mockTask.id, mockAdminUser as any, {
        name: 'Figma UI Mockups',
        url: 'https://figma.com/design/123',
        purpose: AttachmentPurpose.REFERENCE,
      });

      expect(att.name).toBe('Figma UI Mockups');
      expect(att.type).toBe(AttachmentType.LINK);
      expect(activitiesService.log).toHaveBeenCalled();
      expect(notificationsService.create).toHaveBeenCalled(); // Notifies assigned employee
    });

    it('should allow Employee to submit a link for approval and advance task to IN_REVIEW', async () => {
      prisma.task.findFirst.mockResolvedValue(mockTask);
      prisma.taskAttachment.create.mockResolvedValue({
        id: 'att-2',
        taskId: mockTask.id,
        name: 'GitHub Pull Request',
        type: AttachmentType.LINK,
        url: 'https://github.com/autoneural/crm/pull/42',
        purpose: AttachmentPurpose.FOR_APPROVAL,
        approvalStatus: ApprovalStatus.PENDING,
      });

      const att = await tasksService.attachLink(mockOrgId, mockTask.id, mockEmpUser as any, {
        name: 'GitHub Pull Request',
        url: 'https://github.com/autoneural/crm/pull/42',
        purpose: AttachmentPurpose.FOR_APPROVAL,
      });

      expect(att.purpose).toBe(AttachmentPurpose.FOR_APPROVAL);
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: mockTask.id },
        data: { status: TaskStatus.IN_REVIEW },
      });
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockTask.createdById,
          title: 'Task Submission Awaiting Approval',
        }),
      );
    });

    it('should forbid unassigned employee from uploading or attaching to a task', async () => {
      prisma.task.findFirst.mockResolvedValue({
        ...mockTask,
        assignments: [{ employeeId: 'another-user' }],
      });

      await expect(
        tasksService.attachLink(mockOrgId, mockTask.id, mockEmpUser as any, {
          name: 'Unauthorized Link',
          url: 'https://google.com',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow Admin to approve an employee submission', async () => {
      prisma.taskAttachment.findFirst.mockResolvedValue({
        id: 'att-2',
        taskId: mockTask.id,
        uploaderId: mockEmpId,
        name: 'GitHub Pull Request',
        purpose: AttachmentPurpose.FOR_APPROVAL,
        approvalStatus: ApprovalStatus.PENDING,
        task: { organizationId: mockOrgId, title: 'Build CRM' },
      });
      prisma.taskAttachment.update.mockResolvedValue({
        id: 'att-2',
        approvalStatus: ApprovalStatus.APPROVED,
        reviewNote: 'Looks great! Merged.',
      });

      const approved = await tasksService.approveSubmission(
        mockOrgId,
        mockTask.id,
        'att-2',
        mockAdminUser as any,
        { note: 'Looks great! Merged.' },
      );

      expect(approved.approvalStatus).toBe(ApprovalStatus.APPROVED);
      expect(activitiesService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUBMISSION_APPROVED',
        }),
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockEmpId,
          title: 'Submission Approved!',
        }),
      );
    });

    it('should allow Admin to reject an employee submission with change request note', async () => {
      prisma.taskAttachment.findFirst.mockResolvedValue({
        id: 'att-2',
        taskId: mockTask.id,
        uploaderId: mockEmpId,
        name: 'GitHub Pull Request',
        purpose: AttachmentPurpose.FOR_APPROVAL,
        approvalStatus: ApprovalStatus.PENDING,
        task: { organizationId: mockOrgId, title: 'Build CRM' },
      });
      prisma.taskAttachment.update.mockResolvedValue({
        id: 'att-2',
        approvalStatus: ApprovalStatus.REJECTED,
        reviewNote: 'Please add unit tests before approval.',
      });

      const rejected = await tasksService.rejectSubmission(
        mockOrgId,
        mockTask.id,
        'att-2',
        mockAdminUser as any,
        { note: 'Please add unit tests before approval.' },
      );

      expect(rejected.approvalStatus).toBe(ApprovalStatus.REJECTED);
      expect(activitiesService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUBMISSION_REJECTED',
        }),
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockEmpId,
          title: 'Submission Requires Changes',
        }),
      );
    });
  });
});
