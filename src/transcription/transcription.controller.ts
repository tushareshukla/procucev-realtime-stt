import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { TranscriptionService } from './transcription.service';

class UpdateTranscriptionDto {
  @IsString()
  @MinLength(1)
  text: string;
}

@Controller('api/transcriptions')
export class TranscriptionController {
  constructor(private readonly service: TranscriptionService) {}

  @Get()
  findAll(@Query('limit') limit?: string) {
    return this.service.findAll(limit ? parseInt(limit, 10) : 100);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
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
