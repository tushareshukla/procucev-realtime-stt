import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { MastraService } from './mastra.service';

class AskDto {
  @IsString()
  @MinLength(1)
  prompt: string;
}

@Controller('api/agent')
export class MastraController {
  constructor(private readonly mastra: MastraService) {}

  @Get('status')
  status() {
    return { enabled: this.mastra.enabled };
  }

  @Post('ask')
  async ask(@Body() dto: AskDto) {
    return { answer: await this.mastra.ask(dto.prompt) };
  }

  @Post('cleanup/:sessionId')
  async cleanup(@Param('sessionId') sessionId: string) {
    return { text: await this.mastra.cleanup(sessionId) };
  }

  @Post('summarize/:sessionId')
  async summarize(@Param('sessionId') sessionId: string) {
    return { summary: await this.mastra.summarize(sessionId) };
  }
}
