import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SendMessageDto } from './dto/send-message.dto';
import { PrismaService } from 'Prisma/prisma.service';
import { CreateConversationDto } from './dto/create-converstion.dto';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  // Create a new conversation (1-to-1 or group)
  async createConversation(createConversationDto: CreateConversationDto, userId: string) {
    const { participantIds, name, isGroup } = createConversationDto;

    // Ensure user is included in participants
    const allParticipants = [...new Set([userId, ...participantIds])];

    if (allParticipants.length < 2) {
      throw new BadRequestException('Conversation must have at least 2 participants');
    }

    // Check if 1-to-1 conversation already exists
    if (!isGroup && allParticipants.length === 2) {
      const existingConversation = await this.prisma.conversation.findFirst({
        where: {
          isGroup: false,
          users: {
            every: {
              userId: { in: allParticipants },
            },
          },
        },
        include: { users: true },
      });

      if (existingConversation) {
        return existingConversation;
      }
    }

    // Create new conversation
    const conversation = await this.prisma.conversation.create({
      data: {
        name: isGroup ? name : null,
        isGroup,
        users: {
          createMany: {
            data: allParticipants.map((participantId) => ({
              userId: participantId,
            })),
          },
        },
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName : true,
                profileImage: true,
              },
            },
          },
        },
      },
    });

    return conversation;
  }

  // Get all conversations for a user
  async getUserConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        users: {
          some: {
            userId,
          },
        },
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                profileImage: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return conversations;
  }

  // Get conversation by ID
  async getConversationById(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                profileImage: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: {
                id: true,
                email: true,
                fullName: true,
                profileImage: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Check if user is part of conversation
    const userInConversation = conversation.users.some((u) => u.userId === userId);
    if (!userInConversation) {
      throw new BadRequestException('User is not part of this conversation');
    }

    return conversation;
  }

  // Send a message
  async sendMessage(conversationId: string, sendMessageDto: SendMessageDto, userId: string) {
    const { content } = sendMessageDto;

    // Verify conversation exists and user is part of it
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { users: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const userInConversation = conversation.users.some((u) => u.userId === userId);
    if (!userInConversation) {
      throw new BadRequestException('User is not part of this conversation');
    }

    // For 1-to-1 conversations, determine receiver
    let receiverId: string | null = null;
    if (!conversation.isGroup) {
      const otherUser = conversation.users.find((u) => u.userId !== userId);
      receiverId = otherUser?.userId || null;
    }

    // Create message
    const message = await this.prisma.message.create({
      data: {
        content,
        senderId: userId,
        receiverId: receiverId || userId, // For group chats, set to sender
        conversationId,
      },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            fullName : true,
            profileImage: true,
          },
        },
      },
    });

    return message;
  }

  // Get messages for a conversation
  async getMessages(conversationId: string, userId: string, limit: number = 50, offset: number = 0) {
    // Verify user is part of conversation
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { users: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const userInConversation = conversation.users.some((u) => u.userId === userId);
    if (!userInConversation) {
      throw new BadRequestException('User is not part of this conversation');
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            fullName : true,
            profileImage: true,
          },
        },
      },
    });

    return messages.reverse();
  }

  // Mark message as read
  async markMessageAsRead(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.receiverId !== userId) {
      throw new BadRequestException('User cannot mark this message as read');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { isRead: true },
    });
  }

  // Delete message
  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new BadRequestException('User can only delete their own messages');
    }

    return this.prisma.message.delete({
      where: { id: messageId },
    });
  }
}
