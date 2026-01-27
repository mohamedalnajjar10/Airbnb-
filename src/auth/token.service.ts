// import { Injectable } from "@nestjs/common";
// import { JwtService } from "@nestjs/jwt";

// @Injectable()
// export class TokenService {
//   constructor(private readonly jwtService: JwtService) {}

//   generateTokens(payload: any): { accessToken: string; refreshToken: string } {
//     const accessToken = this.jwtService.sign(payload);
//     const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });
//     return { accessToken, refreshToken };
//   }
// }
