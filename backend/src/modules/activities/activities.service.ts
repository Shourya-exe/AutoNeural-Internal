import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityAction } from '@prisma/client';

export interface LogActivityParams {
  taskId: string;
  userId: string;
  action: ActivityAction;
  previousValue?: string;
  newValue?: string;
  comment?: string;
}

@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: LogActivityParams) {
    return this.prisma.taskActivity.create({
      data: {
        taskId: params.taskId,
        userId: params.userId,
        action: params.action,
        previousValue: params.previousValue || null,
        newValue: params.newValue || null,
        comment: params.comment || null,
      },
    });
  }

  async findByTaskId(taskId: string) {
    return this.prisma.taskActivity.findMany({
      where: { taskId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
