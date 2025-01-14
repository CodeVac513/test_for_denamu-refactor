import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { loadDBSetting } from './common/database/load.config';
import { AdminModule } from './admin/module/admin.module';
import { RedisModule } from './common/redis/redis.module';
import { RssModule } from './rss/module/rss.module';
import { FeedModule } from './feed/module/feed.module';
import { WinstonLoggerModule } from './common/logger/logger.module';
import { ChatModule } from './chat/module/chat.module';
import { StatisticModule } from './statistic/module/statistic.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `${process.cwd()}/configs/.env`,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        loadDBSetting(configService),
    }),
    AdminModule,
    RedisModule,
    WinstonLoggerModule,
    RssModule,
    FeedModule,
    ChatModule,
    StatisticModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
