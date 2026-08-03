import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators';
import { RecordingPipelineService } from '../session/recording-pipeline.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: RecordingPipelineService,
  ) {}

  @Public()
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    const video = this.pipeline.videoRemoteStatus();
    return {
      status: 'ok',
      service: 'miru-api',
      time: new Date().toISOString(),
      video: {
        remoteReady: video.remoteReady,
        allowLocalLivekit: video.allowLocalLivekit,
        clientUrlHost: video.clientUrlHost,
      },
    };
  }
}
