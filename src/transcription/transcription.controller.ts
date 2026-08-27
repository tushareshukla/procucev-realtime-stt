import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { TranscriptionService } from './transcription.service';

class UpdateTranscriptionDto {
  @IsString()
  @MinLength(1)
  text: string;
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
  constructor(private readonly service: TranscriptionService) {}

  @Get()
  findAll(@Query('limit') limit?: string, @Query('user') user?: string) {
    return this.service.findAll(limit ? parseInt(limit, 10) : 100, user || undefined);
  }

  @Post()
  create(@Body() dto: CreateTranscriptionDto) {
    return this.service.create({
      sessionId: dto.sessionId ?? 'manual',
      text: dto.text,
      language: dto.language ?? '',
      durationS: dto.durationS ?? 0,
      confidence: 1,
      userName: (dto.userName ?? '').slice(0, 80),
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
