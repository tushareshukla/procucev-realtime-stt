import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Raw `ws` rather than socket.io — the browser sends binary PCM frames.
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
  new Logger('bootstrap').log(`listening on http://localhost:${port}`);
}

bootstrap();
