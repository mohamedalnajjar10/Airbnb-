import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'Prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, ListingStatus, CancellationPolicy } from '@prisma/client';
import { ListingService } from '../listing.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';


describe('ListingService', () => {
  let service: ListingService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
    listing: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    listingImage: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ListingService>(ListingService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createListing', () => {
    const userId = 'user-123';
    const validCreateDto: CreateListingDto = {
      title: 'Beautiful Apartment',
      description: 'A lovely place to stay',
      address: '123 Main Street, Downtown',
      city: 'Cairo',
      price: 1000,
      googleMapsUrl: 'https://maps.google.com/maps?q=cairo',
      rules: 'No smoking',
      cancellationPolicy: 'FLEXIBLE',
    };

    const mockUser = {
      id: userId,
      role: UserRole.HOST,
      totalLimit: 10,
      dailyLimit: 3,
      _count: { listings: 5 },
    };

    const mockListing = {
      id: 'listing-123',
      title: validCreateDto.title,
      description: validCreateDto.description,
      address: validCreateDto.address,
      city: validCreateDto.city,
      price: validCreateDto.price,
      status: ListingStatus.DRAFT,
      hostId: userId,
      images: [],
      host: {
        id: userId,
        fullName: 'Test User',
        mobile: '1234567890',
        email: 'test@example.com',
      },
    };

    it('should create a listing successfully', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          listing: {
            count: jest.fn().mockResolvedValue(2),
            create: jest.fn().mockResolvedValue(mockListing),
          },
        };
        return callback(tx);
      });

      const result = await service.createListing(userId, validCreateDto);

      expect(result.message).toBe('Listing created successfully');
      expect(result.data).toEqual(mockListing);
    });

    it('should throw NotFoundException if user does not exist', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(
        service.createListing(userId, validCreateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not a HOST', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue({
              ...mockUser,
              role: UserRole.GUEST,
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        service.createListing(userId, validCreateDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if total limit is reached', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue({
              ...mockUser,
              _count: { listings: 10 },
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        service.createListing(userId, validCreateDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if daily limit is reached', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          listing: {
            count: jest.fn().mockResolvedValue(3),
          },
        };
        return callback(tx);
      });

      await expect(
        service.createListing(userId, validCreateDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if title is too short', async () => {
      const invalidDto = { ...validCreateDto, title: 'Short' };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          listing: {
            count: jest.fn().mockResolvedValue(2),
          },
        };
        return callback(tx);
      });

      await expect(
        service.createListing(userId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if price is invalid', async () => {
      const invalidDto = { ...validCreateDto, price: 0 };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          listing: {
            count: jest.fn().mockResolvedValue(2),
          },
        };
        return callback(tx);
      });

      await expect(
        service.createListing(userId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid Google Maps URL', async () => {
      const invalidDto = {
        ...validCreateDto,
        googleMapsUrl: 'https://invalid-url.com',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          listing: {
            count: jest.fn().mockResolvedValue(2),
          },
        };
        return callback(tx);
      });

      await expect(
        service.createListing(userId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create listing with images', async () => {
      const mockImages: Express.Multer.File[] = [
        {
          path: '/uploads/image1.jpg',
          filename: 'image1.jpg',
          mimetype: 'image/jpeg',
        } as Express.Multer.File,
      ];

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          listing: {
            count: jest.fn().mockResolvedValue(2),
            create: jest.fn().mockResolvedValue({
              ...mockListing,
              images: [{ path: '/uploads/image1.jpg' }],
            }),
          },
        };
        return callback(tx);
      });

      const result = await service.createListing(
        userId,
        validCreateDto,
        mockImages,
      );

      expect(result.data.images).toHaveLength(1);
    });
  });

  describe('findAllListingForOneUser', () => {
    const userId = 'user-123';
    const mockListings = [
      {
        id: 'listing-1',
        title: 'Listing 1',
        hostId: userId,
      },
      {
        id: 'listing-2',
        title: 'Listing 2',
        hostId: userId,
      },
    ];

    it('should return all listings for a user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: userId });
      mockPrismaService.listing.findMany.mockResolvedValue(mockListings);

      const result = await service.findAllListingForOneUser(userId);

      expect(result.message).toBe('Listings fetched successfully');
      expect(result.data).toEqual(mockListings);
      expect(mockPrismaService.listing.findMany).toHaveBeenCalledWith({
        where: { hostId: userId },
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
    });

    it('should throw NotFoundException if user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.findAllListingForOneUser(userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateListing', () => {
    const userId = 'user-123';
    const listingId = 'listing-123';
    const updateDto: UpdateListingDto = {
      title: 'Updated Title Here',
      price: 2000,
    };

    const mockExistingListing = {
      id: listingId,
      hostId: userId,
      title: 'Old Title',
    };

    const mockUpdatedListing = {
      ...mockExistingListing,
      ...updateDto,
    };

    it('should update listing successfully', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          listing: {
            findUnique: jest.fn().mockResolvedValue(mockExistingListing),
            update: jest.fn().mockResolvedValue(mockUpdatedListing),
          },
        };
        return callback(tx);
      });

      const result = await service.updateListing(
        userId,
        listingId,
        updateDto,
      );

      expect(result.message).toBe('Listing updated successfully');
      expect(result.data.title).toBe(updateDto.title);
    });

    it('should throw NotFoundException if listing does not exist', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          listing: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(
        service.updateListing(userId, listingId, updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid title length', async () => {
      const invalidDto = { title: 'Short' };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          listing: {
            findUnique: jest.fn().mockResolvedValue(mockExistingListing),
          },
        };
        return callback(tx);
      });

      await expect(
        service.updateListing(userId, listingId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid price', async () => {
      const invalidDto = { price: -100 };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          listing: {
            findUnique: jest.fn().mockResolvedValue(mockExistingListing),
          },
        };
        return callback(tx);
      });

      await expect(
        service.updateListing(userId, listingId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteListing', () => {
    const userId = 'user-123';
    const listingId = 'listing-123';

    const mockUser = { id: userId };
    const mockListing = { id: listingId, hostId: userId };

    it('should delete listing successfully', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.listing.findUnique.mockResolvedValue(mockListing);
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.deleteListing(userId, listingId);

      expect(result.message).toBe('Listing deleted successfully');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteListing(userId, listingId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if listing does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.listing.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteListing(userId, listingId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not the listing owner', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.listing.findUnique.mockResolvedValue({
        ...mockListing,
        hostId: 'different-user-id',
      });

      await expect(
        service.deleteListing(userId, listingId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validateListingData', () => {
    it('should validate correct data without throwing', () => {
      const validDto: CreateListingDto = {
        title: 'Valid Title Here',
        description: 'Valid description',
        address: '123 Main Street, City',
        city: 'Cairo',
        price: 1000,
        googleMapsUrl: 'https://maps.google.com/maps?q=cairo',
      };

      expect(() => service['validateListingData'](validDto)).not.toThrow();
    });

    it('should throw for description exceeding 2000 characters', () => {
      const invalidDto: CreateListingDto = {
        title: 'Valid Title Here',
        description: 'a'.repeat(2001),
        address: '123 Main Street, City',
        city: 'Cairo',
        price: 1000,
      };

      expect(() => service['validateListingData'](invalidDto)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('isValidGoogleMapsUrl', () => {
    it('should return true for valid Google Maps URLs', () => {
      const validUrls = [
        'https://maps.google.com/maps?q=cairo',
        'https://www.google.com/maps/place/cairo',
        'https://maps.google.com.eg/maps',
      ];

      validUrls.forEach((url) => {
        expect(service['isValidGoogleMapsUrl'](url)).toBe(true);
      });
    });

    it('should return false for invalid URLs', () => {
      const invalidUrls = [
        'https://example.com',
        'not-a-url',
        'https://facebook.com',
      ];

      invalidUrls.forEach((url) => {
        expect(service['isValidGoogleMapsUrl'](url)).toBe(false);
      });
    });
  });
});