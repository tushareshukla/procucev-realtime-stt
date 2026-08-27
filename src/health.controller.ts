import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SttService } from './stt/stt.service';

/**
 * Health and readiness. Reports what the process is actually wired to, so a
 * misconfigured deploy is visible without shelling into the container.
 */
@Controller()
export class HealthController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly stt: SttService,
  ) {}

  @Get('healthz')
  healthz() {
    return { ok: true };
  }

  @Get('readyz')
  async readyz() {
    let db = { dialect: this.ds.options.type as string, connected: false };
    try {
      await this.ds.query('SELECT 1');
      db.connected = true;
    } catch {
      /* reported as connected:false */
    }

    const upstream = await this.stt.health();

    return {
      ok: db.connected && upstream.reachable,
      db,
      stt: upstream,
      uptimeS: Math.round(process.uptime()),
    };
  }
}
