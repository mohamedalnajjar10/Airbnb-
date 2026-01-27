import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
  } from '@nestjs/websockets';
  import { Server, Socket } from 'socket.io';
  import { ChatService } from './chat.service';
import { PrismaService } from 'Prisma/prisma.service';
  
  @WebSocketGateway({
    cors: {
      origin: '*',
    },
  })
  export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;
  
    private userSockets: Map<string, string> = new Map(); // userId -> socketId
  
    constructor(
      private chatService: ChatService,
      private prisma: PrismaService,
    ) {}
  
    handleConnection(client: Socket) {
      console.log(`Client connected: ${client.id}`);
    }
  
    handleDisconnect(client: Socket) {
      console.log(`Client disconnected: ${client.id}`);
      // Remove user from map
      for (const [userId, socketId] of this.userSockets.entries()) {
        if (socketId === client.id) {
          this.userSockets.delete(userId);
          break;
        }
      }
    }
  
    @SubscribeMessage('join')
    handleJoin(@MessageBody() data: { userId: string }, @ConnectedSocket() client: Socket) {
      this.userSockets.set(data.userId, client.id);
      client.emit('joined', { message: 'Successfully joined' });
      console.log(`User ${data.userId} joined with socket ${client.id}`);
    }
  
    @SubscribeMessage('send_message')
    async handleSendMessage(
      @MessageBody() data: { conversationId: string; content: string; userId: string },
      @ConnectedSocket() client: Socket,
    ) {
      try {
        const message = await this.chatService.sendMessage(
          data.conversationId,
          { content: data.content },
          data.userId,
        );
  
        // Broadcast to all users in conversation
        this.server.emit('new_message', {
          conversationId: data.conversationId,
          message,
        });
  
        client.emit('message_sent', { success: true, message });
      } catch (error) {
        client.emit('error', { message: error.message });
      }
    }
  
    @SubscribeMessage('typing')
    handleTyping(
      @MessageBody() data: { conversationId: string; userId: string; isTyping: boolean },
      @ConnectedSocket() client: Socket,
    ) {
      this.server.emit('user_typing', {
        conversationId: data.conversationId,
        userId: data.userId,
        isTyping: data.isTyping,
      });
    }
  
    @SubscribeMessage('mark_as_read')
    async handleMarkAsRead(
      @MessageBody() data: { messageId: string; userId: string },
      @ConnectedSocket() client: Socket,
    ) {
      try {
        await this.chatService.markMessageAsRead(data.messageId, data.userId);
        this.server.emit('message_read', { messageId: data.messageId });
      } catch (error) {
        client.emit('error', { message: error.message });
      }
    }
  }
  