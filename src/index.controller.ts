import { Controller, Get, Header } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Serves the app shell with a per-process build id stamped into asset URLs.
 *
 * Doing this at runtime rather than image-build time is deliberate: Docker
 * caches the build-time stamping layer, so a rebuild could reuse a previous
 * value, leaving browsers on a cached app.js that no longer matches the HTML.
 * A boot-time id always changes when a new container starts.
 */
@Controller()
export class IndexController {
  private readonly buildId = process.env.BUILD_ID || String(Date.now());
  private readonly indexPath = join(__dirname, '..', 'public', 'index.html');

  @Get('app.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-cache, must-revalidate')
  appJs(): string {
    // Its module imports carry the same placeholder, so they must be stamped
    // with the identical id or the browser fetches two different versions.
    return readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf8')
      .replace(/__BUILD__/g, this.buildId);
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-cache, must-revalidate')
  index(): string {
    // Read per request: cheap, and avoids serving a stale shell after a
    // hot-reload in development.
    return readFileSync(this.indexPath, 'utf8').replace(/__BUILD__/g, this.buildId);
  }
}
