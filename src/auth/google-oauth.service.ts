import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuth2Client } from "google-auth-library";

@Injectable()
export class GoogleOauthService {
  private readonly logger = new Logger(GoogleOauthService.name);
  private client: OAuth2Client;

  constructor(private readonly config: ConfigService) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.config.get<string>('GOOGLE_REDIRECT_URI');
    this.client = new OAuth2Client(clientId, clientSecret, redirectUri);
  }

  async getUserProfile(code: string): Promise<{ sub: string; name: string; email: string; picture?: string; }> {
    try {
      const { tokens } = await this.client.getToken(code);
      this.client.setCredentials(tokens);
      const userInfo = await this.client.request({
        url: 'https://www.googleapis.com/oauth2/v3/userinfo',
      });
      const profile = userInfo.data as { sub: string; name: string; email: string; picture?: string; };
      if (!profile || !profile.email) {
        throw new UnauthorizedException('Google login failed: no email');
      }
      return profile;
    } catch (error) {
      this.logger.error('Failed to get Google user profile', error);
      throw new UnauthorizedException('Google login failed');
    }
  }

  getRedirectUrl(): string {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.config.get<string>('GOOGLE_REDIRECT_URI');
    const scope = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ].join(' ');
    return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`;
  }
}
