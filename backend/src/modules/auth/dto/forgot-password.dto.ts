import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'info@autoneural.in', description: 'User account email' })
  @IsEmail({}, { message: 'Valid email is required' })
  email: string;
}
