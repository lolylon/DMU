import { Module } from '@nestjs/common';
import { NcaLayerSigningAdapter } from './ncalayer.adapter';
import { SIGNING_PORT } from './signing.tokens';

@Module({
  providers: [
    NcaLayerSigningAdapter,
    { provide: SIGNING_PORT, useExisting: NcaLayerSigningAdapter },
  ],
  exports: [SIGNING_PORT, NcaLayerSigningAdapter],
})
export class SigningModule {}
