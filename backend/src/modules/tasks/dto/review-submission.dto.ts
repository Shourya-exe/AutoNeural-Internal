import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewSubmissionDto {
  @ApiPropertyOptional({
    example: 'Approved. Great work on meeting the client acceptance criteria.',
    description: 'Review note or feedback from the administrator',
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}
