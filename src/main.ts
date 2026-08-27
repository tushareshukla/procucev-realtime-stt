import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Raw `ws` rather than socket.io — the browser sends binary PCM frames.
  app.useWebSocketAdapter(new WsAdapter(app));
  // Saved recordings are posted as base64 WAV; the 100kb express default
  // rejects anything past a couple of seconds of audio.
  const bodyLimit = process.env.BODY_LIMIT ?? '25mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ limit: bodyLimit, extended: true }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
  new Logger('bootstrap').log(`listening on http://localhost:${port}`);
}

bootstrap();
