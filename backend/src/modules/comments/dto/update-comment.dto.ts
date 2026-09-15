import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateCommentDto {
  @ApiProperty({ example: 'Updated comment content', description: 'Updated text content' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  content: string;
}
