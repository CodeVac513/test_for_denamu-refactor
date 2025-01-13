import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FeedRepository,
  FeedViewRepository,
} from '../repository/feed.repository';
import { FeedPaginationRequestDto } from '../dto/request/feed-pagination.dto';
import { FeedView } from '../entity/feed.entity';
import {
  FeedPaginationResponseDto,
  FeedPaginationResult,
  FeedResult,
  FeedTrendResponseDto,
} from '../dto/response/feed-pagination.dto';
import { RedisService } from '../../common/redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SearchFeedRequestDto } from '../dto/request/search-feed.dto';
import { Response, Request } from 'express';
import { cookieConfig } from '../../common/cookie/cookie.config';
import { redisKeys } from '../../common/redis/redis.constant';
import {
  SearchFeedResponseDto,
  SearchFeedResult,
} from '../dto/response/search-feed.dto';
import {
  FeedRecentRedis,
  FeedRecentResponseDto,
} from '../dto/response/recent.dto';

@Injectable()
export class FeedService {
  constructor(
    private readonly feedRepository: FeedRepository,
    private readonly feedViewRepository: FeedViewRepository,
    private readonly redisService: RedisService,
    private readonly eventService: EventEmitter2,
  ) {}

  async readFeedPagination(queryFeedDto: FeedPaginationRequestDto) {
    const feedList = await this.feedViewRepository.findFeedPagination(
      queryFeedDto.lastId,
      queryFeedDto.limit,
    );
    const hasMore = this.existNextFeed(feedList, queryFeedDto.limit);
    if (hasMore) feedList.pop();
    const lastId = this.getLastIdFromFeedList(feedList);
    const newCheckFeedList = await this.checkNewFeeds(feedList);
    const feedPagination = FeedResult.toResultDtoArray(newCheckFeedList);
    return FeedPaginationResponseDto.toResponseDto(
      feedPagination,
      lastId,
      hasMore,
    );
  }

  private existNextFeed(feedList: FeedView[], limit: number) {
    return feedList.length > limit;
  }

  private getLastIdFromFeedList(feedList: FeedView[]) {
    return feedList.length ? feedList[feedList.length - 1].feedId : 0;
  }

  private async checkNewFeeds(feedList: FeedView[]) {
    const newFeedIds = (
      await this.redisService.keys(redisKeys.FEED_RECENT_ALL_KEY)
    ).map((key) => {
      const feedId = key.match(/feed:recent:(\d+)/);
      return parseInt(feedId[1]);
    });

    return feedList.map((feed): FeedPaginationResult => {
      return {
        ...feed,
        isNew: newFeedIds.includes(feed.feedId),
      };
    });
  }

  async readTrendFeedList() {
    const trendFeedIdList = await this.redisService.lrange(
      redisKeys.FEED_ORIGIN_TREND_KEY,
      0,
      -1,
    );
    const trendFeeds = await Promise.all(
      trendFeedIdList.map(async (feedId) =>
        this.feedViewRepository.findFeedById(parseInt(feedId)),
      ),
    );
    return FeedTrendResponseDto.toResponseDtoArray(
      trendFeeds.filter((feed) => feed !== null),
    );
  }

  async searchFeedList(searchFeedReq: SearchFeedRequestDto) {
    const { find, page, limit, type } = searchFeedReq;
    const offset = (page - 1) * limit;

    if (!this.validateSearchType(type)) {
      throw new BadRequestException('검색 타입이 잘못되었습니다.');
    }

    const [searchResult, totalCount] = await this.feedRepository.searchFeedList(
      find,
      limit,
      type,
      offset,
    );

    const feeds = SearchFeedResult.toResultDtoArray(searchResult);
    const totalPages = Math.ceil(totalCount / limit);

    return SearchFeedResponseDto.toResponseDto(
      totalCount,
      feeds,
      totalPages,
      limit,
    );
  }

  private validateSearchType(type: string) {
    const searchType = {
      title: 'title',
      blogName: 'blogName',
      all: 'all',
    };

    return searchType.hasOwnProperty(type);
  }

  async updateFeedViewCount(
    feedId: number,
    request: Request,
    response: Response,
  ) {
    const cookie = request.headers.cookie;
    const ip = this.getIp(request);
    if (ip && this.isString(ip)) {
      const [feed, hasCookie, hasIpFlag] = await Promise.all([
        this.feedRepository.findOne({ where: { id: feedId } }),
        Boolean(cookie?.includes(`View_count_${feedId}=${feedId}`)),
        this.redisService.sismember(`feed:${feedId}:ip`, ip),
      ]);

      if (!feed) {
        throw new NotFoundException(`${feedId}번 피드를 찾을 수 없습니다.`);
      }

      if (!hasCookie) {
        this.createCookie(response, feedId);
      }

      if (hasCookie || hasIpFlag) {
        return null;
      }

      await Promise.all([
        this.redisService.sadd(`feed:${feedId}:ip`, ip),
        this.feedRepository.update(feedId, {
          viewCount: () => 'view_count + 1',
        }),
        this.redisService.zincrby(
          redisKeys.FEED_TREND_KEY,
          1,
          feedId.toString(),
        ),
      ]);
    }
  }

  private isString(ip: string | string[]): ip is string {
    return !Array.isArray(ip);
  }

  private createCookie(response: Response, feedId: number) {
    const cookieConfigWithExpiration = {
      ...cookieConfig[process.env.NODE_ENV],
      expires: this.getExpirationTime(),
    };
    response.cookie(`View_count_${feedId}`, feedId, cookieConfigWithExpiration);
  }

  private getExpirationTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }

  async readRecentFeedList() {
    const recentKeys = await this.redisService.keys(
      redisKeys.FEED_RECENT_ALL_KEY,
    );

    if (!recentKeys.length) {
      return [];
    }

    const recentFeeds = await this.redisService.executePipeline((pipeline) => {
      for (const key of recentKeys) {
        pipeline.hgetall(key);
      }
    });

    let recentFeedList: FeedRecentRedis[] = recentFeeds.map(
      ([, feed]: [any, FeedRecentRedis]) => {
        return { ...feed, isNew: true };
      },
    );

    recentFeedList = recentFeedList.sort((currentFeed, nextFeed) => {
      const dateCurrent = new Date(currentFeed.createdAt);
      const dateNext = new Date(nextFeed.createdAt);
      return dateNext.getTime() - dateCurrent.getTime();
    });

    return FeedRecentResponseDto.toResponseDtoArray(recentFeedList);
  }

  private getIp(request: Request) {
    const forwardedFor = request.headers['x-forwarded-for'];

    if (typeof forwardedFor === 'string') {
      const forwardedIps = forwardedFor.split(',');
      return forwardedIps[0].trim();
    }

    return request.socket.remoteAddress;
  }
}
