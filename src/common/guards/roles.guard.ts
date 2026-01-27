// import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
// import { Reflector } from '@nestjs/core';
// import { ROLES_KEY } from '../decorators/roles.decorator';
// import { Role } from '../enums/role.enum';

// @Injectable()
// export class RolesGuard implements CanActivate {
//   constructor(private reflector: Reflector) {}
//   canActivate(ctx: ExecutionContext): boolean {
//     const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
//       ctx.getHandler(),
//       ctx.getClass(),
//     ]);
//     if (!required?.length) return true;
//     const { user } = ctx.switchToHttp().getRequest();
//     return required.some((r) => user?.roles?.includes(r));
//   }
// }

import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  canActivate(ctx: ExecutionContext): boolean {
    // console.log('🛡️ RolesGuard: Starting...');

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // console.log('📋 Required roles:', requiredRoles);

    if (!requiredRoles?.length) {
      // console.log('✅ No roles required');
      return true;
    }

    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    // console.log('👤 User from request:', JSON.stringify(user, null, 2));

    if (!user) {
      // console.log('❌ No user found in request');
      throw new ForbiddenException('No user found in request');
    }

    // دعم كل من role و roles
    const userRole = user.role;
    const userRoles = user.roles || (userRole ? [userRole] : []);

    // console.log('🔑 User role:', userRole);
    // console.log('🔑 User roles array:', userRoles);

    const hasRole = requiredRoles.some((role) => {
      // console.log(`  Checking: ${role} in [${userRoles.join(', ')}]`);
      return userRoles.includes(role);
    });

    // console.log('🎯 Has required role:', hasRole);

    if (!hasRole) {
      throw new ForbiddenException(
        `Required roles: [${requiredRoles.join(', ')}], but user has: [${userRoles.join(', ')}]`
      );
    }

    return true;
  }
}