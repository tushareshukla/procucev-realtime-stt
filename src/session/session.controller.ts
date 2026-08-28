import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsString, MinLength } from 'class-validator';
import { SessionService } from './session.service';

export const SESSION_COOKIE = 'procucev_sid';

class StartSessionDto {
  @IsString()
  @MinLength(1)
  name: string;
}

@Controller('api/session')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  async current(@Req() req: Request) {
    const id = SessionService.readCookie(req.headers.cookie, SESSION_COOKIE);
    return { userName: await this.sessions.resolve(id) };
  }

  @Post()
  async start(@Body() dto: StartSessionDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const existing = SessionService.readCookie(req.headers.cookie, SESSION_COOKIE);
    const id = existing ?? (await this.sessions.create(dto.name));
    if (existing) await this.sessions.remember(existing, dto.name);

    res.cookie(SESSION_COOKIE, id, {
      httpOnly: true,      // not reachable from page scripts
      sameSite: 'lax',
      secure: req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https',
      maxAge: Number(process.env.SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000),
      path: '/',
    });
    return { userName: await this.sessions.resolve(id) };
  }
}
