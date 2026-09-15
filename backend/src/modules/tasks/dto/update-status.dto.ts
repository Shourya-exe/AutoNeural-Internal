import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class UpdateStatusDto {
  @ApiProperty({ enum: TaskStatus, example: TaskStatus.IN_PROGRESS })
  @IsEnum(TaskStatus)
  @IsNotEmpty({ message: 'Status is required' })
  status: TaskStatus;

  @ApiPropertyOptional({ example: 'Started working on unit tests' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
