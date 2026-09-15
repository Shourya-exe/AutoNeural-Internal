import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateProgressDto {
  @ApiProperty({ example: 80, minimum: 0, maximum: 100, description: 'Task progress percentage (0 - 100)' })
  @IsInt()
  @Min(0, { message: 'Progress percentage cannot be less than 0' })
  @Max(100, { message: 'Progress percentage cannot exceed 100' })
  @IsNotEmpty()
  progress: number;

  @ApiPropertyOptional({ example: 'Completed database integration and wrote unit test suite.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
