import { Controller, Post, Get, Delete, Put, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CreateConversationDto } from './dto/create-converstion.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('conversations')
  async createConversation(
    @Body() createConversationDto: CreateConversationDto,
    @CurrentUser() user: any,
  ) {
    return this.chatService.createConversation(createConversationDto, user.id);
  }

  @Get('conversations')
  async getUserConversations(@CurrentUser() user: any) {
    return this.chatService.getUserConversations(user.id);
  }

  @Get('conversations/:conversationId')
  async getConversation(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: any,
  ) {
    return this.chatService.getConversationById(conversationId, user.id);
  }

  @Post('conversations/:conversationId/messages')
  async sendMessage(
    @Param('conversationId') conversationId: string,
    @Body() sendMessageDto: SendMessageDto,
    @CurrentUser() user: any,
  ) {
    return this.chatService.sendMessage(conversationId, sendMessageDto, user.id);
  }

  @Get('conversations/:conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
    @CurrentUser() user: any,
  ) {
    return this.chatService.getMessages(conversationId, user.id, limit, offset);
  }

  @Put('messages/:messageId/read')
  async markMessageAsRead(
    @Param('messageId') messageId: string,
    @CurrentUser() user: any,
  ) {
    return this.chatService.markMessageAsRead(messageId, user.id);
  }

  @Delete('messages/:messageId')
  async deleteMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: any,
  ) {
    return this.chatService.deleteMessage(messageId, user.id);
  }
}
