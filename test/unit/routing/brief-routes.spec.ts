import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PublicEmergencyController } from '../../../src/modules/emergency-intake/public-emergency.controller';
import { PublicEmergencyRequestsController } from '../../../src/modules/emergency-intake/public-emergency-requests.controller';
import { DisplayController } from '../../../src/modules/display/display.controller';
import { DisplayPairAliasController } from '../../../src/modules/display/display-pair-alias.controller';
import { PublicDirectoryController } from '../../../src/modules/directory/public.controller';

/**
 * ADR-052 claims the brief's route spellings are registered *alongside* the
 * deployed ones. A prefix array on a controller does not do that: `@Controller([
 * 'public/emergency', 'public/emergency-requests'])` plus `@Post('requests')`
 * yields `/public/emergency-requests/requests`, not the brief's flat
 * `/public/emergency-requests`. The claim in the ADR and in PROGRESS.md was
 * therefore untrue while reading as though it had been delivered.
 *
 * These tests read the real Nest path metadata, so a routing mistake fails here
 * instead of in a client.
 */
type Route = { method: RequestMethod; path: string; handler: string };

function routesOf(...controllers: Array<new (...args: never[]) => object>): Route[] {
  const out: Route[] = [];
  for (const controller of controllers) {
    const raw = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
    // Nest accepts a prefix array and registers the handler under every entry,
    // so the helper has to expand one — otherwise a prefix-array mistake
    // crashes this file instead of being reported as a failing route.
    const prefixes = (Array.isArray(raw) ? raw : [raw ?? '']).map((p) =>
      p.replace(/^\//, '').replace(/\/$/, ''),
    );
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === 'constructor') continue;
      const handler = controller.prototype[name] as object;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      if (method === undefined || path === undefined) continue;
      // Nest normalizes a leading slash and an empty method path to the bare
      // controller path.
      const suffix = path === '' || path === '/' ? '' : path.replace(/^\//, '');
      for (const prefix of prefixes) {
        out.push({
          method,
          path: '/' + [prefix, suffix].filter(Boolean).join('/'),
          handler: name,
        });
      }
    }
  }
  return out;
}

function pathsOf(routes: Route[], method: RequestMethod): string[] {
  return routes.filter((r) => r.method === method).map((r) => r.path);
}

describe('brief route spellings (ADR-052)', () => {
  describe('emergency public surface', () => {
    const routes = routesOf(PublicEmergencyController, PublicEmergencyRequestsController);

    it('registers the brief §6.15 flat submit path', () => {
      expect(pathsOf(routes, RequestMethod.POST)).toContain('/public/emergency-requests');
    });

    it('registers the brief §6.15 token operations flat', () => {
      const posts = pathsOf(routes, RequestMethod.POST);
      expect(posts).toContain('/public/emergency-requests/track');
      expect(posts).toContain('/public/emergency-requests/update');
      expect(posts).toContain('/public/emergency-requests/cancel');
    });

    it('keeps the deployed contract intact', () => {
      const posts = pathsOf(routes, RequestMethod.POST);
      expect(posts).toContain('/public/emergency/requests');
      expect(posts).toContain('/public/emergency/requests/track');
      expect(posts).toContain('/public/emergency/requests/update');
      expect(posts).toContain('/public/emergency/requests/cancel');
    });

    it('does not register the doubled path the prefix array would have produced', () => {
      expect(pathsOf(routes, RequestMethod.POST)).not.toContain('/public/emergency-requests/requests');
    });

    it('serves the anonymous reference data at the deployed path', () => {
      const gets = pathsOf(routes, RequestMethod.GET);
      expect(gets).toContain('/public/emergency/numbers');
      expect(gets).toContain('/public/emergency/notice');
    });

    it('registers each path exactly once', () => {
      // Two controllers claiming one path means which one answers is a
      // registration-order detail, not a decision.
      const posts = pathsOf(routes, RequestMethod.POST);
      const seen = new Set<string>();
      const dupes = posts.filter((p) => (seen.has(p) ? true : (seen.add(p), false)));
      expect(dupes).toEqual([]);
    });
  });

  describe('display pairing', () => {
    const routes = routesOf(DisplayController, DisplayPairAliasController);

    it('registers the brief §5.16 pairing path', () => {
      expect(pathsOf(routes, RequestMethod.POST)).toContain('/display/pair');
    });

    it('keeps the deployed pairing path', () => {
      expect(pathsOf(routes, RequestMethod.POST)).toContain('/display/devices/pair');
    });

    it('does not alias the other device routes onto /display', () => {
      // Pairing is the only route the brief spells without the `devices`
      // segment; promoting the rest would hand out tokens at the wrong path.
      const posts = pathsOf(routes, RequestMethod.POST);
      expect(posts).not.toContain('/display/board');
      expect(posts).not.toContain('/display/revoke');
    });
  });

  describe('public directory', () => {
    const routes = routesOf(PublicDirectoryController);
    const gets = pathsOf(routes, RequestMethod.GET);

    it('registers both config spellings', () => {
      expect(gets).toContain('/public/config');
      expect(gets).toContain('/public/facilities/config');
    });

    it('registers both autocomplete spellings', () => {
      expect(gets).toContain('/public/locations/suggest');
      expect(gets).toContain('/public/geocode');
    });
  });
});