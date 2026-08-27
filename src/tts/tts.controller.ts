import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Logger } from '@nestjs/common';
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
  private readonly log = new Logger(TtsController.name);

  constructor(private readonly tts: TtsService) {}

  @Get('voices')
  voices(@Query('language') language = 'en') {
    return this.tts.listVoices(language);
  }

  @Post('stream')
  async stream(@Body() dto: SpeakDto, @Res() res: Response) {
    try {
      const upstream = await this.tts.speakStream({
        text: dto.text,
        language: dto.language ?? 'en',
        voice: dto.voice,
        speed: dto.speed ?? 1,
      });

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');

      // Chunked passthrough: the first sentence reaches the browser while
      // later ones are still being synthesised.
      upstream.on('error', (err: Error) => {
        this.log.error(`tts stream aborted: ${err.message}`);
        if (!res.headersSent) res.status(502).json({ error: err.message });
        else res.destroy(err);
      });
      upstream.pipe(res);
    } catch (err) {
      // Nest would otherwise mask this as a bare "Internal server error",
      // which makes a proxy failure indistinguishable from a bug here.
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`tts stream failed: ${message}`);
      if (!res.headersSent) res.status(502).json({ error: message });
    }
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
