import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { TtsService } from './tts.service';

class SpeakDto {
  @IsString()
  @MinLength(1)
  text: string;

  @IsOptional() @IsString()
  language?: string;

  @IsOptional() @IsString()
  voice?: string;

  @IsOptional() @IsNumber() @Min(0.5) @Max(2)
  speed?: number;
}

@Controller('api/tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Get('voices')
  voices(@Query('language') language = 'en') {
    return this.tts.listVoices(language);
  }

  @Post('stream')
  async stream(@Body() dto: SpeakDto, @Res() res: Response) {
    const upstream = await this.tts.speakStream({
      text: dto.text,
      language: dto.language ?? 'en',
      voice: dto.voice,
      speed: dto.speed ?? 1,
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    // Chunked passthrough: the first sentence reaches the browser while later
    // ones are still being synthesised.
    upstream.pipe(res);
  }

  @Post('speak')
  async speak(@Body() dto: SpeakDto, @Res() res: Response) {
    const wav = await this.tts.speak({
      text: dto.text,
      language: dto.language ?? 'en',
      voice: dto.voice,
      speed: dto.speed ?? 1,
    });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.send(wav);
  }
}
