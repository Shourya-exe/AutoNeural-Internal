import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewRemovalDto {
  @ApiPropertyOptional({
    description: 'Optional review note or reason for decision',
    example: 'Confirmed with team lead and verified all access revoked.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
