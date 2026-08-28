import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { SESSION_COOKIE } from '../session/session.controller';
import { SessionService } from '../session/session.service';
import { SttService } from '../stt/stt.service';
import { TranscriptionService } from './transcription.service';

class UpdateTranscriptionDto {
  @IsString()
  @MinLength(1)
  text: string;
}

class TranscribeDto {
  /** Base64 WAV, 16kHz mono as captured by the browser. */
  @IsString()
  @MinLength(1)
  audioBase64: string;

  @IsOptional() @IsString()
  language?: string;
}

class CreateTranscriptionDto {
  @IsString() @MinLength(1)
  text: string;

  @IsOptional() @IsString()
  language?: string;

  @IsOptional() @IsNumber()
  durationS?: number;

  @IsOptional() @IsString()
  sessionId?: string;

  @IsOptional() @IsString()
  userName?: string;

  @IsOptional() @IsIn(['stt', 'tts'])
  kind?: string;

  /** Base64 WAV of the recording, saved so it can be replayed later. */
  @IsOptional() @IsString()
  audioBase64?: string;
}

@Controller('api/transcriptions')
export class TranscriptionController {
  constructor(
    private readonly service: TranscriptionService,
    private readonly stt: SttService,
    private readonly sessions: SessionService,
  ) {}

  /** The signed-in name, taken from the session rather than trusted from the body. */
  private async userOf(req: Request): Promise<string> {
    return (await this.sessions.resolve(
      SessionService.readCookie(req.headers.cookie, SESSION_COOKIE),
    )) ?? '';
  }

  @Get()
  async findAll(@Req() req: Request, @Query('limit') limit?: string) {
    // Scoped server-side: a client cannot ask for someone else's history.
    // With no session there is no history to show — returning everything would
    // leak every user's recordings to an anonymous visitor.
    const user = await this.userOf(req);
    if (!user) return [];
    return this.service.findAll(limit ? parseInt(limit, 10) : 100, user);
  }

  /**
   * Transcribe a finished recording. The live stream already produces text
   * while speaking, but this lets the client ask for a transcript on demand —
   * and recover if streaming returned nothing.
   */
  @Post('transcribe')
  async transcribe(@Body() dto: TranscribeDto) {
    const wav = Buffer.from(dto.audioBase64, 'base64');
    return this.stt.transcribeWav(wav, dto.language ?? 'en');
  }

  @Post()
  async create(@Body() dto: CreateTranscriptionDto, @Req() req: Request) {
    return this.service.create({
      sessionId: dto.sessionId ?? 'manual',
      text: dto.text,
      language: dto.language ?? '',
      durationS: dto.durationS ?? 0,
      confidence: 1,
      userName: await this.userOf(req),
      kind: dto.kind ?? 'stt',
      audio: dto.audioBase64,
      hasAudio: Boolean(dto.audioBase64),
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Get(':id/audio')
  async audio(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const base64 = await this.service.findAudio(id);
    const buf = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTranscriptionDto) {
    return this.service.update(id, dto.text);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
