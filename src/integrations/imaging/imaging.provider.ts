/**
 * Seam for acquiring imaging (DICOM/device layer). The application only ever
 * talks to this interface. The default implementation is a no-op that keeps
 * orders moving without hardware; a real PACS vendor integration can be
 * supplied behind the same token without touching the radiology module.
 * Payloads carry IDs and study metadata only — never PHI beyond what the order
 * already couples to.
 */
export interface ImagingProvider {
  /** Request the modality acquisition for an order (no-op by default). */
  capture(input: {
    orderId: string;
    patientId: string;
    modality: string;
    region?: string | null;
  }): Promise<void>;
}

/** Seam for publishing finished reports to the picture archive. */
export interface PacsGateway {
  /** Publish a completed imaging report (no-op by default). */
  publish(input: {
    orderId: string;
    reportId: string;
    patientId: string;
  }): Promise<void>;
}

/** Default no-op acquisition endpoint (brief: do not fake DICOM). */
export class NoopImagingProvider implements ImagingProvider {
  async capture(): Promise<void> {
    return;
  }
}

/** Default no-op archive publisher. */
export class NoopPacsGateway implements PacsGateway {
  async publish(): Promise<void> {
    return;
  }
}