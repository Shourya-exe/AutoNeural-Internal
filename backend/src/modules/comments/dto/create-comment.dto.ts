import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ example: 'I have finished the initial architecture review.', description: 'Comment text content' })
  @IsString()
  @IsNotEmpty({ message: 'Comment content cannot be empty' })
  @MaxLength(3000, { message: 'Comment cannot exceed 3000 characters' })
  content: string;
}
