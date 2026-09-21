import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'careos:isPublic';

/** Marks a route as reachable without authentication/authorization. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
