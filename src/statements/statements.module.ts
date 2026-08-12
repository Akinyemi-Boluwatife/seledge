import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { StatementsService } from './statements.service';

@Module({
  imports: [JobsModule],
  providers: [StatementsService],
  exports: [StatementsService],
})
export class StatementsModule {}
