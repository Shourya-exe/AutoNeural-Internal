import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestRemovalDto {
  @ApiPropertyOptional({
    description: 'Reason for requesting employee removal/deactivation',
    example: 'Employee has resigned and handover is completed.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
