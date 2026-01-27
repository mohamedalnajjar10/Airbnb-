import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { PrismaService } from 'Prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  UserRole,
  ListingStatus,
  CancellationPolicy,
  Prisma,
} from '@prisma/client';
import { ListingQueryDto } from './dto/listing-query.dto';
import { ListingForUserQueryDto } from './dto/listing-user-query.dto';
import { SearchListingDto } from './dto/search-listing.dto';
import { ListingQueryBuilder } from './utils/listing-query.builder';

@Injectable()
export class ListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) { }

  async createListing(userId: string, createListingDto: CreateListingDto, images?: Express.Multer.File[]) {
    // transaction 
    const result = await this.prisma.$transaction(async (tx) => {
      //  User verification and validity
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          totalLimit: true,
          dailyLimit: true,
          _count: {
            select: { listings: true }
          },
        },
      });

      if (!user) throw new NotFoundException('User not found');
      if (user.role !== UserRole.HOST) {
        throw new ForbiddenException('Only hosts can create listings');
      }

      // Check the total ad limit
      if (user._count.listings >= user.totalLimit) {
        throw new ForbiddenException(
          `You have reached your total listing limit (${user.totalLimit})`,
        );
      }

      // Check the daily ad limit
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayListingsCount = await tx.listing.count({
        where: {
          hostId: userId,
          createdAt: { gte: today },
        },
      });

      if (todayListingsCount >= user.dailyLimit) {
        throw new ForbiddenException(
          `You have reached your daily listing limit (${user.dailyLimit})`,
        );
      }

      // Verify the data before creation
      this.validateListingData(createListingDto);

      // Create the listing and images within the same transaction
      const newListing = await tx.listing.create({
        data: {
          title: createListingDto.title.trim(),
          description: createListingDto.description?.trim() || '',
          address: createListingDto.address.trim(),
          city: createListingDto.city.trim(),
          price: new Prisma.Decimal(createListingDto.price),
          googleMapsUrl: createListingDto.googleMapsUrl?.trim() || null,
          rules: createListingDto.rules?.trim() || null,
          cancellationPolicy:
            (createListingDto.cancellationPolicy as CancellationPolicy) ||
            CancellationPolicy.FLEXIBLE,
          status: ListingStatus.DRAFT,
          hostId: userId,
          images: images?.length
            ? {
              create: images.map((f) => ({
                path: f.path,
                filename: f.filename,
                mime: f.mimetype,
              })),
            }
            : undefined,
        },
        include: {
          images: true,
          host: {
            select: {
              id: true,
              fullName: true,
              mobile: true,
              email: true,
            },
          },
        },
      });

      // Return the result within the transaction
      return newListing;
    });

    // Return the final response after successful transaction
    return {
      message: 'Listing created successfully',
      data: result,
    };
  }

  // Validate listing data
  private validateListingData(dto: CreateListingDto): void {
    if (dto.title.length < 10 || dto.title.length > 100) {
      throw new BadRequestException(
        'Title must be between 10 and 100 characters',
      );
    }

    if (dto.description && dto.description.length > 2000) {
      throw new BadRequestException(
        'Description must not exceed 2000 characters',
      );
    }

    if (dto.address.length < 10 || dto.address.length > 500) {
      throw new BadRequestException(
        'Address must be between 10 and 500 characters',
      );
    }

    if (dto.price < 1 || dto.price > 1000000) {
      throw new BadRequestException('Price must be between 1 and 1,000,000');
    }

    if (dto.googleMapsUrl && !this.isValidGoogleMapsUrl(dto.googleMapsUrl)) {
      throw new BadRequestException('Invalid Google Maps URL');
    }
  }

  // Helper function to validate Google Maps URL
  private isValidGoogleMapsUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.hostname.includes('google.com') &&
        (urlObj.pathname.includes('/maps') ||
          urlObj.hostname.includes('maps.google'))
      );
    } catch {
      return false;
    }
  }

  async findAllListingForOneUser(userId: string, query: ListingForUserQueryDto) {
    const existsUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existsUser) {
      throw new NotFoundException('User not found');
    }

    // Pagination
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 10;
    const skip = (page - 1) * limit;

    // Count total listings for this user
    const total = await this.prisma.listing.count({
      where: { hostId: userId },
    });

    // Fetch paginated listings
    const listings = await this.prisma.listing.findMany({
      where: { hostId: userId },
      skip,
      take: limit,
      include: {
        images: true,
        host: {
          select: {
            id: true,
            fullName: true,
            email: true,
            mobile: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      message: 'Listings fetched successfully',
      pagination: {
        totalItems: total,
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        limit,
      },
      results: listings.length,
      data: listings,
    };
  }

  async updateListing(userId: string, listingId: string, updateListingDto: UpdateListingDto, images?: Express.Multer.File[],) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Verify listing exists
      const existsListing = await tx.listing.findUnique({
        where: { id: listingId },
      });

      if (!existsListing) {
        throw new NotFoundException('Listing not found');
      }

      // Validate provided fields (partial validation for updates)
      if (updateListingDto.title) {
        if (updateListingDto.title.length < 10 || updateListingDto.title.length > 100) {
          throw new BadRequestException('Title must be between 10 and 100 characters');
        }
        updateListingDto.title = updateListingDto.title.trim();
      }

      if (updateListingDto.description && updateListingDto.description.length > 2000) {
        throw new BadRequestException('Description must not exceed 2000 characters');
      }

      if (updateListingDto.address) {
        if (updateListingDto.address.length < 10 || updateListingDto.address.length > 500) {
          throw new BadRequestException('Address must be between 10 and 500 characters');
        }
        updateListingDto.address = updateListingDto.address.trim();
      }

      if (updateListingDto.price !== undefined) {
        if (updateListingDto.price < 1 || updateListingDto.price > 1000000) {
          throw new BadRequestException('Price must be between 1 and 1,000,000');
        }
      }

      if (updateListingDto.googleMapsUrl && !this.isValidGoogleMapsUrl(updateListingDto.googleMapsUrl)) {
        throw new BadRequestException('Invalid Google Maps URL');
      }

      // Build update data
      const data: Prisma.ListingUpdateInput = {
        title: updateListingDto.title ?? undefined,
        description: updateListingDto.description ?? undefined,
        address: updateListingDto.address ?? undefined,
        city: updateListingDto.city ?? undefined,
        price:
          updateListingDto.price !== undefined
            ? new Prisma.Decimal(updateListingDto.price)
            : undefined,
        googleMapsUrl: updateListingDto.googleMapsUrl ?? undefined,
        rules: updateListingDto.rules ?? undefined,
        cancellationPolicy: updateListingDto.cancellationPolicy
          ? (updateListingDto.cancellationPolicy as CancellationPolicy)
          : undefined,
        status: ListingStatus.DRAFT,
        images: images?.length
          ? {
            create: images.map((f) => ({
              path: f.path,
              filename: f.filename,
              mime: f.mimetype,
            })),
          }
          : undefined,
      };

      const updated = await tx.listing.update({
        where: { id: listingId },
        data,
        include: {
          images: true,
          host: {
            select: {
              id: true,
              fullName: true,
              mobile: true,
              email: true,
            },
          },
        },
      });

      return updated;
    });

    return {
      message: 'Listing updated successfully',
      data: result,
    };
  }

  async deleteListing(userId: string, listingId: string) {
    const existsUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!existsUser) {
      throw new NotFoundException('User not found')
    }
    // Verify listing exists
    const existsListing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!existsListing) {
      throw new NotFoundException('Listing not found');
    }
    if (existsListing.hostId !== userId) {
      throw new ForbiddenException('You are not allowed to delete this listing');
    }

    await this.prisma.$transaction([
      this.prisma.listingImage.deleteMany({
        where: { listingId },
      }),
      this.prisma.listing.delete({
        where: { id: listingId },
      }),
    ]);
    return { message: "Listing deleted successfully" };
  }

  async findAllListing(query: ListingQueryDto) {
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 10;
    const skip = (page - 1) * limit;

    const filters: Prisma.ListingWhereInput = {};

    if (query.city) {
      filters.city = { equals: query.city };
    }

    if (query.status) {
      filters.status = query.status;
    }

    if (query.minPrice || query.maxPrice) {
      filters.price = {};
      if (query.minPrice) filters.price.gte = Number(query.minPrice);
      if (query.maxPrice) filters.price.lte = Number(query.maxPrice);
    }

    const total = await this.prisma.listing.count({ where: filters });

    const listings = await this.prisma.listing.findMany({
      where: filters,
      skip,
      take: limit,
      include: {
        images: true,
        host: {
          select: {
            id: true,
            fullName: true,
            email: true,
            mobile: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      message: 'Listings fetched successfully',
      pagination: {
        totalItems: total,
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        limit,
      },
      results: listings.length,
      data: listings,
    };
  }

  async searchListings(query: SearchListingDto) {
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 10;
    const skip = (page - 1) * limit;

    const minPrice = query.minPrice ? Number(query.minPrice) : undefined;
    const maxPrice = query.maxPrice ? Number(query.maxPrice) : undefined;

    // Combine Filters
    const baseFilters = ListingQueryBuilder.buildFilters({
      ...query,
      minPrice,
      maxPrice,
    });

    const dateFilters = ListingQueryBuilder.buildDateFilter(
      query.startDate,
      query.endDate
    );

    const finalWhere: Prisma.ListingWhereInput = {
      AND: [
        baseFilters,
        dateFilters
      ]
    };

    const total = await this.prisma.listing.count({
      where: finalWhere,
    });

    const data = await this.prisma.listing.findMany({
      where: finalWhere,
      skip,
      take: limit,
      include: {
        images: true,
        host: {
          select: {
            id: true,
            fullName: true,
            email: true,
            mobile: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      message: 'Listings fetched successfully',
      pagination: {
        totalItems: total,
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        limit,
      },
      results: data.length,
      data,
    };
  }


}
