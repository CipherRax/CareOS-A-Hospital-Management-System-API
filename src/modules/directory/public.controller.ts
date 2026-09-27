import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { DirectoryService } from './directory.service';
import {
  GeocodeQueryDto,
  NearbyFacilitiesQueryDto,
  SearchFacilitiesQueryDto,
  SuggestFacilityDto,
} from './dto/directory.dto';

const SEARCH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const GEOCODE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const SUGGEST_THROTTLE = { default: { limit: 5, ttl: 3_600_000 } };

/**
 * Anonymous public facility directory (brief §6.14 contract path
 * `/public/facilities`). Every route is @Public, IP-rate-limited, and reads
 * ONLY the cross-tenant sanitized projection (never a tenant table).
 */
@Controller('public')
export class PublicDirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get('facilities/nearby')
  @ApiEndpoint({
    summary: 'Facilities near a location (anonymous, IP rate-limited)',
    operationId: 'publicFacilitiesNearby',
    public: true,
    errors: [
      { status: 422, description: 'Invalid coordinates' },
      { status: 429, description: 'Rate limited', code: 'RATE_LIMITED' },
    ],
    example: {
      data: [
        {
          id: '…',
          slug: 'st-matthews',
          name: 'St Matthews Hospital',
          distanceKm: 1.24,
          town: 'Nairobi',
        },
      ],
      meta: { latitude: -1.29, longitude: 36.82, radiusKm: 10, count: 1, rank: 'distance' },
    },
  })
  @Throttle(SEARCH_THROTTLE)
  nearby(@Query() query: NearbyFacilitiesQueryDto) {
    return this.directory.nearby(query);
  }

  @Get('facilities/search')
  @ApiEndpoint({
    summary: 'Search the public directory (anonymous, IP rate-limited)',
    operationId: 'publicFacilitiesSearch',
    public: true,
    errors: [{ status: 429, description: 'Rate limited', code: 'RATE_LIMITED' }],
    example: {
      data: [{ slug: 'st-matthews', name: 'St Matthews Hospital', town: 'Nairobi' }],
      meta: { count: 1, ranked: false },
    },
  })
  @Throttle(SEARCH_THROTTLE)
  search(@Query() query: SearchFacilitiesQueryDto) {
    return this.directory.search(query);
  }

  @Get('facilities/:slug')
  @ApiEndpoint({
    summary: 'Full public profile of one published facility',
    operationId: 'publicFacilityProfile',
    public: true,
    errors: [
      { status: 404, description: 'No published listing for this slug', code: 'PUBLIC_LISTING_NOT_PUBLISHED' },
    ],
  })
  profile(@Param('slug') slug: string) {
    return this.directory.profile(slug);
  }

  @Get('facilities/config')
  @ApiEndpoint({
    summary: 'Public directory configuration/intro',
    operationId: 'publicFacilityConfig',
    public: true,
  })
  config() {
    return this.directory.config();
  }

  @Get('geocode')
  @ApiEndpoint({
    summary: 'Geocode an address (geocoder-dependent; currently unavailable)',
    operationId: 'publicGeocode',
    public: true,
    errors: [
      { status: 422, description: 'Geocoding unavailable', code: 'GEOCODING_UNAVAILABLE' },
      { status: 429, description: 'Rate limited', code: 'RATE_LIMITED' },
    ],
  })
  @Throttle(GEOCODE_THROTTLE)
  geocode(@Query() query: GeocodeQueryDto) {
    return this.directory.geocode(query);
  }

  @Post('facilities/suggest')
  @ApiEndpoint({
    summary: 'Suggest a missing facility for the directory (moderated)',
    operationId: 'publicSuggestFacility',
    public: true,
    statusCode: 201,
    errors: [{ status: 429, description: 'Rate limited', code: 'RATE_LIMITED' }],
  })
  @Throttle(SUGGEST_THROTTLE)
  suggest(@Body() body: SuggestFacilityDto) {
    return this.directory.suggest(body, 'FACILITY_SUGGESTION');
  }

  @Post('onboarding-inquiries')
  @ApiEndpoint({
    summary: 'Submit a directory onboarding/correction request (moderated)',
    operationId: 'publicOnboardingInquiry',
    public: true,
    statusCode: 201,
    errors: [{ status: 429, description: 'Rate limited', code: 'RATE_LIMITED' }],
  })
  @Throttle(SUGGEST_THROTTLE)
  onboardingInquiry(@Body() body: SuggestFacilityDto) {
    return this.directory.suggest(body, 'ONBOARDING_REQUEST');
  }
}