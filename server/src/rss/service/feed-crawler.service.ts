import { BadRequestException, Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { FeedRepository } from '../../feed/repository/feed.repository';
import { RssParserService } from '../service/rss-parser.service';
import { Feed } from '../../feed/entity/feed.entity';
import { RssAccept } from '../entity/rss.entity';

@Injectable()
export class FeedCrawlerService {
  constructor(
    private readonly feedRepository: FeedRepository,
    private readonly rssParser: RssParserService,
  ) {}

  async loadRssFeeds(rssUrl: string) {
    return await this.fetchRss(rssUrl);
  }

  async saveRssFeeds(feeds: Partial<Feed>[], newRssAccept: RssAccept) {
    feeds.forEach((feed) => (feed.blog = newRssAccept));
    await this.feedRepository.insert(feeds);
  }

  private async fetchRss(rssUrl: string): Promise<Partial<Feed>[]> {
    const xmlParser = new XMLParser();
    const response = await fetch(rssUrl, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });

    if (!response.ok) {
      throw new BadRequestException(`${rssUrl}에서 xml 추출 실패`);
    }

    const xmlData = await response.text();
    const objFromXml = xmlParser.parse(xmlData);

    if (!Array.isArray(objFromXml.rss.channel.item)) {
      objFromXml.rss.channel.item = [objFromXml.rss.channel.item];
    }

    return await Promise.all(
      objFromXml.rss.channel.item.map(async (feed) => {
        const date = new Date(feed.pubDate);
        const formattedDate = date.toISOString().slice(0, 19).replace('T', ' ');
        const thumbnail = await this.rssParser.getThumbnailUrl(feed.link);

        return {
          title: this.rssParser.customUnescape(feed.title),
          path: decodeURIComponent(feed.link),
          thumbnail,
          createdAt: formattedDate,
        };
      }),
    );
  }
}
