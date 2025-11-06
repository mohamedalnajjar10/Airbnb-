import { UserType, UserRole } from '@prisma/client';

export interface AuthResponse {
    accessToken: string;
    refreshToken?: string;
    user: SafeUser;
    expiresIn: number;
}

export interface SafeUser {
    id: string;
    fullName: string;
    mobile: string;
    email: string | null;
    type: UserType;
    role: UserRole;
    isVerified: boolean;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}


