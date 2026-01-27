import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { UserRole } from '@prisma/client';



export function RequirePermissions(...roles: UserRole[]) {
    return applyDecorators(
        Roles(...roles),
        UseGuards(JwtAuthGuard, RolesGuard),
        ApiBearerAuth(),
        ApiResponse({
            status: 401,
            description: 'Unauthorized - Invalid or missing token.'
        }),
        ApiResponse({
            status: 403,
            description: 'Forbidden - Insufficient permissions.'
        }),
    );
}

export function AdminOnly() {
    return RequirePermissions(UserRole.ADMIN);
}


export function HOSTOnly() {
    return RequirePermissions(UserRole.HOST);
}


export function HOSTOrAdmin() {
    return RequirePermissions(UserRole.HOST, UserRole.ADMIN);
}

export function AuthenticatedOnly() {
    return applyDecorators(
        UseGuards(JwtAuthGuard),
        ApiBearerAuth(),
        ApiResponse({
            status: 401,
            description: 'Unauthorized - Invalid or missing token.'
        }),
    );
}