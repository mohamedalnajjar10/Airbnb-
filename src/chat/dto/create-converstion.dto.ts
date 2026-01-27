import { IsArray, IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateConversationDto {
  @IsArray()
  participantIds: string[];

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;
}
