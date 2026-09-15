import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TaskPriority, TaskStatus } from '@prisma/client';

export class CreateTaskDto {
  @ApiProperty({ example: 'Implement Redis caching layer', description: 'Task title' })
  @IsString()
  @IsNotEmpty({ message: 'Task title is required' })
  @MaxLength(180, { message: 'Title cannot exceed 180 characters' })
  title: string;

  @ApiPropertyOptional({ example: 'Configure key expiry and cache eviction policies.' })
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Array of employee UUIDs to assign to this task',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority = TaskPriority.MEDIUM;

  @ApiPropertyOptional({ enum: TaskStatus, default: TaskStatus.TODO })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus = TaskStatus.TODO;

  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number = 0;

  @ApiPropertyOptional({ example: 'Core Platform' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  project?: string;

  @ApiPropertyOptional({ example: '2026-09-15T09:00:00Z' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-09-25T18:00:00Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
