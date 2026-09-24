import { Module } from '@nestjs/common';
import { NoopImagingProvider, NoopPacsGateway } from './imaging.provider';

/**
 * Imaging vendor seam. Registers the no-op adapters by default; swap these
 * providers when a real PACS/DICOM integration lands. Kept OUT of
 * modules/ so the boundary check treats it as shared infrastructure, and the
 * radiology module depends only on the tokens, not the implementations.
 */
export const IMAGING_PROVIDER = Symbol('IMAGING_PROVIDER');
export const PACS_GATEWAY = Symbol('PACS_GATEWAY');

@Module({
  providers: [
    { provide: IMAGING_PROVIDER, useClass: NoopImagingProvider },
    { provide: PACS_GATEWAY, useClass: NoopPacsGateway },
  ],
  exports: [IMAGING_PROVIDER, PACS_GATEWAY],
})
export class ImagingModule {}

export type { ImagingProvider, PacsGateway } from './imaging.provider';