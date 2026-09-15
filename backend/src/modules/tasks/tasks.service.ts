import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { TaskFilterDto } from './dto/task-filter.dto';
import {
  AccountStatus,
  ActivityAction,
  AttachmentPurpose,
  AttachmentType,
  ApprovalStatus,
  NotificationType,
  Role,
  TaskStatus,
} from '@prisma/client';
import { AttachLinkDto } from './dto/attach-link.dto';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(
    organizationId: string,
    createdById: string,
    creatorName: string,
    dto: CreateTaskDto,
  ) {
    // Validate employees if provided
    if (dto.employeeIds && dto.employeeIds.length > 0) {
      const activeEmployees = await this.prisma.user.findMany({
        where: {
          id: { in: dto.employeeIds },
          organizationId,
          status: AccountStatus.ACTIVE,
        },
      });

      if (activeEmployees.length !== dto.employeeIds.length) {
        throw new BadRequestException('One or more selected employees are invalid or inactive');
      }
    }

    let progress = dto.progress ?? 0;
    let status = dto.status ?? TaskStatus.TODO;
    let completedAt: Date | null = null;

    if (status === TaskStatus.COMPLETED) {
      progress = 100;
      completedAt = new Date();
    } else if (progress === 100) {
      status = TaskStatus.COMPLETED;
      completedAt = new Date();
    }

    const task = await this.prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          organizationId,
          createdById,
          title: dto.title.trim(),
          description: dto.description?.trim() || '',
          priority: dto.priority,
          status,
          progress,
          project: dto.project?.trim() || null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          completedAt,
          assignments: dto.employeeIds && dto.employeeIds.length > 0
            ? {
                create: dto.employeeIds.map((empId) => ({
                  employeeId: empId,
                })),
              }
            : undefined,
        },
        include: {
          assignments: {
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                  department: true,
                },
              },
            },
          },
        },
      });

      return newTask;
    });

    // Log Activity: Created
    await this.activitiesService.log({
      taskId: task.id,
      userId: createdById,
      action: ActivityAction.CREATED,
      newValue: `Created task "${task.title}"`,
    });

    // Log and notify assignees
    if (task.assignments && task.assignments.length > 0) {
      const assigneeNames = task.assignments.map((a) => a.employee.name).join(', ');
      await this.activitiesService.log({
        taskId: task.id,
        userId: createdById,
        action: ActivityAction.ASSIGNED,
        newValue: `Assigned to ${assigneeNames}`,
      });

      for (const assignment of task.assignments) {
        await this.notificationsService.create({
          userId: assignment.employeeId,
          taskId: task.id,
          type: NotificationType.TASK_ASSIGNED,
          title: 'New Task Assigned',
          message: `You were assigned task "${task.title}" by ${creatorName}.`,
        });
      }
    }

    return task;
  }

  async findAll(
    organizationId: string,
    userId: string,
    userRole: Role,
    filter: TaskFilterDto,
  ) {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    // Employee isolation: Employees only see tasks assigned to them
    if (userRole === Role.EMPLOYEE) {
      where.assignments = {
        some: { employeeId: userId },
      };
    } else if (filter.employeeId) {
      where.assignments = {
        some: { employeeId: filter.employeeId },
      };
    }

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.priority) {
      where.priority = filter.priority;
    }

    if (filter.project) {
      where.project = { contains: filter.project, mode: 'insensitive' };
    }

    if (filter.overdue) {
      where.dueDate = { lt: new Date() };
      where.status = { not: TaskStatus.COMPLETED };
    }

    if (filter.search) {
      const search = filter.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { project: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          assignments: {
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                  department: true,
                },
              },
            },
          },
          _count: {
            select: {
              comments: true,
              activities: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: tasks.map((t) => ({
        ...t,
        commentCount: t._count.comments,
        activityCount: t._count.activities,
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

  async findOne(
    organizationId: string,
    taskId: string,
    userId: string,
    userRole: Role,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        assignments: {
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
                department: true,
                jobTitle: true,
              },
            },
          },
        },
        attachments: {
          include: {
            uploader: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            comments: true,
            activities: true,
            attachments: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const isAssigned = task.assignments.some((a) => a.employeeId === userId);
    if (userRole === Role.EMPLOYEE && !isAssigned) {
      throw new ForbiddenException('You do not have permission to view this task');
    }

    return {
      ...task,
      commentCount: task._count.comments,
      activityCount: task._count.activities,
      attachmentCount: task._count.attachments,
    };
  }

  async update(
    organizationId: string,
    taskId: string,
    userId: string,
    userName: string,
    dto: UpdateTaskDto,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignments: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    // Validate employee IDs if updated
    if (dto.employeeIds) {
      const activeEmployees = await this.prisma.user.findMany({
        where: {
          id: { in: dto.employeeIds },
          organizationId,
          status: AccountStatus.ACTIVE,
        },
      });

      if (activeEmployees.length !== dto.employeeIds.length) {
        throw new BadRequestException('One or more assignees are invalid or inactive');
      }
    }

    let progress = dto.progress !== undefined ? dto.progress : task.progress;
    let status = dto.status !== undefined ? dto.status : task.status;
    let completedAt = task.completedAt;

    if (status === TaskStatus.COMPLETED) {
      progress = 100;
      completedAt = completedAt || new Date();
    } else if (progress === 100) {
      status = TaskStatus.COMPLETED;
      completedAt = completedAt || new Date();
    } else if (task.status === TaskStatus.COMPLETED) {
      completedAt = null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Reassign if specified
      if (dto.employeeIds) {
        await tx.taskAssignment.deleteMany({ where: { taskId } });
        if (dto.employeeIds.length > 0) {
          await tx.taskAssignment.createMany({
            data: dto.employeeIds.map((empId) => ({
              taskId,
              employeeId: empId,
            })),
          });
        }
      }

      return tx.task.update({
        where: { id: taskId },
        data: {
          title: dto.title !== undefined ? dto.title.trim() : undefined,
          description: dto.description !== undefined ? dto.description.trim() : undefined,
          priority: dto.priority !== undefined ? dto.priority : undefined,
          status,
          progress,
          project: dto.project !== undefined ? dto.project?.trim() || null : undefined,
          startDate: dto.startDate !== undefined ? (dto.startDate ? new Date(dto.startDate) : null) : undefined,
          dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
          completedAt,
          version: { increment: 1 },
        },
        include: {
          assignments: {
            include: {
              employee: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      });
    });

    // Log Activity
    await this.activitiesService.log({
      taskId,
      userId,
      action: ActivityAction.UPDATED,
      newValue: `Updated task details: ${dto.title || task.title}`,
    });

    // Notify assignees of update
    for (const assignment of updated.assignments) {
      if (assignment.employeeId !== userId) {
        await this.notificationsService.create({
          userId: assignment.employeeId,
          taskId,
          type: NotificationType.TASK_UPDATED,
          title: 'Task Details Updated',
          message: `Task "${updated.title}" was updated by ${userName}.`,
        });
      }
    }

    return updated;
  }

  async assign(
    organizationId: string,
    taskId: string,
    adminId: string,
    adminName: string,
    dto: AssignTaskDto,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const activeEmployees = await this.prisma.user.findMany({
      where: {
        id: { in: dto.employeeIds },
        organizationId,
        status: AccountStatus.ACTIVE,
      },
    });

    if (activeEmployees.length !== dto.employeeIds.length) {
      throw new BadRequestException('One or more employees are invalid or inactive');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.taskAssignment.deleteMany({ where: { taskId } });
      await tx.taskAssignment.createMany({
        data: dto.employeeIds.map((empId) => ({
          taskId,
          employeeId: empId,
        })),
      });
    });

    const assigneeNames = activeEmployees.map((e) => e.name).join(', ');

    // Log Activity
    await this.activitiesService.log({
      taskId,
      userId: adminId,
      action: ActivityAction.REASSIGNED,
      newValue: `Reassigned task to ${assigneeNames}`,
    });

    // Notify newly assigned employees
    for (const emp of activeEmployees) {
      await this.notificationsService.create({
        userId: emp.id,
        taskId,
        type: NotificationType.TASK_REASSIGNED,
        title: 'Task Assignment Updated',
        message: `You were assigned to task "${task.title}" by ${adminName}.`,
      });
    }

    return this.findOne(organizationId, taskId, adminId, Role.ADMIN);
  }

  async updateStatus(
    organizationId: string,
    taskId: string,
    userId: string,
    userRole: Role,
    userName: string,
    dto: UpdateStatusDto,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignments: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const isAssigned = task.assignments.some((a) => a.employeeId === userId);
    if (userRole === Role.EMPLOYEE && !isAssigned) {
      throw new ForbiddenException('You can only update status for tasks assigned to you');
    }

    const oldStatus = task.status;
    let progress = task.progress;
    let completedAt = task.completedAt;

    if (dto.status === TaskStatus.COMPLETED) {
      progress = 100;
      completedAt = new Date();
    } else if (oldStatus === TaskStatus.COMPLETED) {
      completedAt = null;
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: dto.status,
        progress,
        completedAt,
        version: { increment: 1 },
      },
      include: {
        assignments: true,
      },
    });

    // Log Activity
    await this.activitiesService.log({
      taskId,
      userId,
      action: ActivityAction.STATUS_CHANGED,
      previousValue: oldStatus,
      newValue: dto.status,
      comment: dto.comment,
    });

    // Dispatch Notifications
    if (userRole === Role.EMPLOYEE) {
      // Notify creator/admin
      await this.notificationsService.create({
        userId: task.createdById,
        taskId,
        type: NotificationType.STATUS_CHANGED,
        title: 'Task Status Changed',
        message: `${userName} changed status of task "${task.title}" to ${dto.status}.`,
      });
    } else {
      // Admin changed status: notify assignees
      for (const a of task.assignments) {
        if (a.employeeId !== userId) {
          await this.notificationsService.create({
            userId: a.employeeId,
            taskId,
            type: NotificationType.STATUS_CHANGED,
            title: 'Task Status Changed by Admin',
            message: `Admin ${userName} changed status of "${task.title}" to ${dto.status}.`,
          });
        }
      }
    }

    return updated;
  }

  async updateProgress(
    organizationId: string,
    taskId: string,
    userId: string,
    userRole: Role,
    userName: string,
    dto: UpdateProgressDto,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignments: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const isAssigned = task.assignments.some((a) => a.employeeId === userId);
    if (userRole === Role.EMPLOYEE && !isAssigned) {
      throw new ForbiddenException('You can only update progress for tasks assigned to you');
    }

    const oldProgress = task.progress;
    let status = task.status;
    let completedAt = task.completedAt;

    if (dto.progress === 100) {
      status = TaskStatus.COMPLETED;
      completedAt = completedAt || new Date();
    } else if (task.status === TaskStatus.COMPLETED && dto.progress < 100) {
      status = TaskStatus.IN_PROGRESS;
      completedAt = null;
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        progress: dto.progress,
        status,
        completedAt,
        version: { increment: 1 },
      },
      include: {
        assignments: true,
      },
    });

    // Log Activity
    await this.activitiesService.log({
      taskId,
      userId,
      action: ActivityAction.PROGRESS_CHANGED,
      previousValue: `${oldProgress}%`,
      newValue: `${dto.progress}%`,
      comment: dto.comment,
    });

    // Dispatch Notifications
    if (userRole === Role.EMPLOYEE) {
      await this.notificationsService.create({
        userId: task.createdById,
        taskId,
        type: NotificationType.PROGRESS_UPDATED,
        title: 'Task Progress Updated',
        message: `${userName} updated task "${task.title}" progress to ${dto.progress}%.`,
      });
    }

    return updated;
  }

  async delete(organizationId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    await this.prisma.task.delete({ where: { id: taskId } });
    return { success: true, message: 'Task deleted successfully' };
  }

  async attachLink(
    organizationId: string,
    taskId: string,
    user: AuthenticatedUser,
    dto: AttachLinkDto,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignments: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const isAssigned = task.assignments.some((a) => a.employeeId === user.id);
    if (user.role === Role.EMPLOYEE && !isAssigned) {
      throw new ForbiddenException('You do not have permission to attach links to this task');
    }

    const purpose = dto.purpose || (user.role === Role.ADMIN ? AttachmentPurpose.REFERENCE : AttachmentPurpose.OUTPUT);
    const isApproval = purpose === AttachmentPurpose.FOR_APPROVAL;

    const attachment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.taskAttachment.create({
        data: {
          taskId,
          uploaderId: user.id,
          name: dto.name.trim(),
          type: AttachmentType.LINK,
          url: dto.url.trim(),
          purpose,
          approvalStatus: isApproval ? ApprovalStatus.PENDING : null,
        },
        include: {
          uploader: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      });

      if (isApproval && task.status !== TaskStatus.COMPLETED) {
        await tx.task.update({
          where: { id: taskId },
          data: { status: TaskStatus.IN_REVIEW },
        });
      }

      return created;
    });

    const action = isApproval
      ? ActivityAction.SUBMISSION_FOR_APPROVAL
      : ActivityAction.ATTACHMENT_ADDED;

    await this.activitiesService.log({
      taskId,
      userId: user.id,
      action,
      newValue: dto.name,
      comment: isApproval ? 'Submitted link for approval' : `Attached link: ${dto.name}`,
    });

    if (user.role === Role.EMPLOYEE) {
      await this.notificationsService.create({
        userId: task.createdById,
        taskId,
        type: isApproval ? NotificationType.SUBMISSION_FOR_APPROVAL : NotificationType.ATTACHMENT_ADDED,
        title: isApproval ? 'Task Submission Awaiting Approval' : 'Deliverable Link Added',
        message: `${user.name} ${isApproval ? 'submitted a link for approval' : 'added a work deliverable link'}: "${dto.name}" on task "${task.title}".`,
      });
    } else {
      for (const assignment of task.assignments) {
        if (assignment.employeeId !== user.id) {
          await this.notificationsService.create({
            userId: assignment.employeeId,
            taskId,
            type: NotificationType.ATTACHMENT_ADDED,
            title: 'Task Reference Link Added',
            message: `Admin ${user.name} added a reference link "${dto.name}" to task "${task.title}".`,
          });
        }
      }
    }

    return attachment;
  }

  async uploadAttachment(
    organizationId: string,
    taskId: string,
    user: AuthenticatedUser,
    file: Express.Multer.File,
    dto: UploadAttachmentDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided for upload');
    }

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignments: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const isAssigned = task.assignments.some((a) => a.employeeId === user.id);
    if (user.role === Role.EMPLOYEE && !isAssigned) {
      throw new ForbiddenException('You do not have permission to upload files to this task');
    }

    const purpose = dto.purpose || (user.role === Role.ADMIN ? AttachmentPurpose.REFERENCE : AttachmentPurpose.OUTPUT);
    const isApproval = purpose === AttachmentPurpose.FOR_APPROVAL;

    const mime = file.mimetype.toLowerCase();
    const isDoc =
      mime.includes('pdf') ||
      mime.includes('word') ||
      mime.includes('document') ||
      mime.includes('text') ||
      mime.includes('sheet') ||
      mime.includes('presentation');
    const type = isDoc ? AttachmentType.DOCUMENT : AttachmentType.FILE;

    const uploadsDir = path.resolve(process.cwd(), 'uploads', 'tasks', taskId);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const fileId = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    const safeStorageName = `${fileId}${ext}`;
    const storagePath = path.join(uploadsDir, safeStorageName);
    fs.writeFileSync(storagePath, file.buffer);

    const displayName = dto.name?.trim() || file.originalname;
    const downloadUrl = `/api/v1/tasks/${taskId}/attachments/${fileId}/download`;

    const attachment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.taskAttachment.create({
        data: {
          id: fileId,
          taskId,
          uploaderId: user.id,
          name: displayName,
          type,
          url: downloadUrl,
          storagePath,
          fileSize: file.size,
          mimeType: file.mimetype,
          purpose,
          approvalStatus: isApproval ? ApprovalStatus.PENDING : null,
        },
        include: {
          uploader: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      });

      if (isApproval && task.status !== TaskStatus.COMPLETED) {
        await tx.task.update({
          where: { id: taskId },
          data: { status: TaskStatus.IN_REVIEW },
        });
      }

      return created;
    });

    const action = isApproval
      ? ActivityAction.SUBMISSION_FOR_APPROVAL
      : ActivityAction.ATTACHMENT_ADDED;

    await this.activitiesService.log({
      taskId,
      userId: user.id,
      action,
      newValue: displayName,
      comment: isApproval ? 'Uploaded deliverable for approval' : `Uploaded ${type.toLowerCase()}: ${displayName}`,
    });

    if (user.role === Role.EMPLOYEE) {
      await this.notificationsService.create({
        userId: task.createdById,
        taskId,
        type: isApproval ? NotificationType.SUBMISSION_FOR_APPROVAL : NotificationType.ATTACHMENT_ADDED,
        title: isApproval ? 'Task Submission Awaiting Approval' : 'Deliverable File Uploaded',
        message: `${user.name} ${isApproval ? 'uploaded a file for approval' : 'uploaded a work deliverable'}: "${displayName}" on task "${task.title}".`,
      });
    } else {
      for (const assignment of task.assignments) {
        if (assignment.employeeId !== user.id) {
          await this.notificationsService.create({
            userId: assignment.employeeId,
            taskId,
            type: NotificationType.ATTACHMENT_ADDED,
            title: 'Task Reference Document Added',
            message: `Admin ${user.name} attached document "${displayName}" to task "${task.title}".`,
          });
        }
      }
    }

    return attachment;
  }

  async findAllAttachments(
    organizationId: string,
    taskId: string,
    userId: string,
    userRole: Role,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignments: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const isAssigned = task.assignments.some((a) => a.employeeId === userId);
    if (userRole === Role.EMPLOYEE && !isAssigned) {
      throw new ForbiddenException('You do not have permission to view attachments for this task');
    }

    return this.prisma.taskAttachment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploader: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  async getAttachmentFile(
    organizationId: string,
    taskId: string,
    attachmentId: string,
    userId: string,
    userRole: Role,
  ) {
    const attachment = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, taskId },
      include: {
        task: {
          include: { assignments: true },
        },
      },
    });

    if (!attachment || attachment.task.organizationId !== organizationId) {
      throw new NotFoundException(`Attachment with ID ${attachmentId} not found`);
    }

    const isAssigned = attachment.task.assignments.some((a) => a.employeeId === userId);
    if (userRole === Role.EMPLOYEE && !isAssigned) {
      throw new ForbiddenException('You do not have permission to download this file');
    }

    if (!attachment.storagePath || !fs.existsSync(attachment.storagePath)) {
      throw new NotFoundException('The requested file is no longer available on disk');
    }

    return {
      storagePath: attachment.storagePath,
      fileName: attachment.name,
      mimeType: attachment.mimeType || 'application/octet-stream',
    };
  }

  async approveSubmission(
    organizationId: string,
    taskId: string,
    attachmentId: string,
    adminUser: AuthenticatedUser,
    dto: ReviewSubmissionDto,
  ) {
    const attachment = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, taskId },
      include: {
        task: true,
        uploader: true,
      },
    });

    if (!attachment || attachment.task.organizationId !== organizationId) {
      throw new NotFoundException(`Attachment with ID ${attachmentId} not found`);
    }

    if (attachment.purpose !== AttachmentPurpose.FOR_APPROVAL) {
      throw new BadRequestException('Only submissions tagged FOR_APPROVAL can be approved');
    }

    const updated = await this.prisma.taskAttachment.update({
      where: { id: attachmentId },
      data: {
        approvalStatus: ApprovalStatus.APPROVED,
        reviewNote: dto.note?.trim() || null,
      },
      include: {
        uploader: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.activitiesService.log({
      taskId,
      userId: adminUser.id,
      action: ActivityAction.SUBMISSION_APPROVED,
      newValue: attachment.name,
      comment: dto.note ? `Approved: "${dto.note}"` : 'Approved submission',
    });

    await this.notificationsService.create({
      userId: attachment.uploaderId,
      taskId,
      type: NotificationType.SUBMISSION_APPROVED,
      title: 'Submission Approved!',
      message: `Admin ${adminUser.name} approved your deliverable "${attachment.name}" on task "${attachment.task.title}".${dto.note ? ` Note: "${dto.note}"` : ''}`,
    });

    return updated;
  }

  async rejectSubmission(
    organizationId: string,
    taskId: string,
    attachmentId: string,
    adminUser: AuthenticatedUser,
    dto: ReviewSubmissionDto,
  ) {
    const attachment = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, taskId },
      include: {
        task: true,
        uploader: true,
      },
    });

    if (!attachment || attachment.task.organizationId !== organizationId) {
      throw new NotFoundException(`Attachment with ID ${attachmentId} not found`);
    }

    if (attachment.purpose !== AttachmentPurpose.FOR_APPROVAL) {
      throw new BadRequestException('Only submissions tagged FOR_APPROVAL can be rejected');
    }

    const updated = await this.prisma.taskAttachment.update({
      where: { id: attachmentId },
      data: {
        approvalStatus: ApprovalStatus.REJECTED,
        reviewNote: dto.note?.trim() || null,
      },
      include: {
        uploader: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.activitiesService.log({
      taskId,
      userId: adminUser.id,
      action: ActivityAction.SUBMISSION_REJECTED,
      newValue: attachment.name,
      comment: dto.note ? `Changes requested: "${dto.note}"` : 'Submission rejected',
    });

    await this.notificationsService.create({
      userId: attachment.uploaderId,
      taskId,
      type: NotificationType.SUBMISSION_REJECTED,
      title: 'Submission Requires Changes',
      message: `Admin ${adminUser.name} reviewed your deliverable "${attachment.name}" on task "${attachment.task.title}" and requested updates.${dto.note ? ` Reason: "${dto.note}"` : ''}`,
    });

    return updated;
  }

  async deleteAttachment(
    organizationId: string,
    taskId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ) {
    const attachment = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, taskId },
      include: { task: true },
    });

    if (!attachment || attachment.task.organizationId !== organizationId) {
      throw new NotFoundException(`Attachment with ID ${attachmentId} not found`);
    }

    if (user.role !== Role.ADMIN && attachment.uploaderId !== user.id) {
      throw new ForbiddenException('You do not have permission to delete this attachment');
    }

    if (attachment.storagePath && fs.existsSync(attachment.storagePath)) {
      try {
        fs.unlinkSync(attachment.storagePath);
      } catch {}
    }

    await this.prisma.taskAttachment.delete({ where: { id: attachmentId } });

    await this.activitiesService.log({
      taskId,
      userId: user.id,
      action: ActivityAction.ATTACHMENT_REMOVED,
      previousValue: attachment.name,
      comment: `Removed ${attachment.type.toLowerCase()}: ${attachment.name}`,
    });

    return { success: true, message: 'Attachment deleted successfully' };
  }
}

