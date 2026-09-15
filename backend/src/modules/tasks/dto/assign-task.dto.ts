import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class AssignTaskDto {
  @ApiProperty({
    description: 'Array of employee UUIDs assigned to this task',
    example: ['d9237699-281b-4f9e-b2d6-444a1e94119d'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ message: 'At least one employee must be selected' })
  employeeIds: string[];
}
