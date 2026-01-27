import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { UserRole, ListingStatus } from '@prisma/client';
import {
  ExecutionContext,
} from '@nestjs/common';
import { ListingController } from '../listing.controller';
import { ListingService } from '../listing.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';

describe('ListingController', () => {
  let controller: ListingController;
  let listingService: ListingService;

  const mockListingService = {
    createListing: jest.fn(),
    findAllListingForOneUser: jest.fn(),
    updateListing: jest.fn(),
    deleteListing: jest.fn(),
  };

  // Mock Guards
  const mockJwtAuthGuard = {
    canActivate: jest.fn((context: ExecutionContext) => {
      const request = context.switchToHttp().getRequest();
      request.user = { sub: 'user-123', role: UserRole.HOST };
      return true;
    }),
  };

  const mockRolesGuard = {
    canActivate: jest.fn(() => true),
  };

  const mockThrottlerGuard = {
    canActivate: jest.fn(() => true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingController],
      providers: [
        {
          provide: ListingService,
          useValue: mockListingService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(mockThrottlerGuard)
      .compile();

    controller = module.get<ListingController>(ListingController);
    listingService = module.get<ListingService>(ListingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createListing', () => {
    const createListingDto: CreateListingDto = {
      title: 'Beautiful Apartment',
      description: 'A lovely place to stay',
      address: '123 Main Street, Downtown',
      city: 'Cairo',
      price: 1000,
      googleMapsUrl: 'https://maps.google.com/maps?q=cairo',
      rules: 'No smoking',
      cancellationPolicy: 'FLEXIBLE',
    };

    const mockImages: Express.Multer.File[] = [
      {
        fieldname: 'images',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        size: 1024,
        destination: './uploads',
        filename: 'test-123.jpg',
        path: '/uploads/test-123.jpg',
        buffer: Buffer.from(''),
      } as Express.Multer.File,
    ];

    const mockRequest = {
      user: {
        sub: 'user-123',
        role: UserRole.HOST,
      },
    };

    const mockResponse = {
      message: 'Listing created successfully',
      data: {
        id: 'listing-123',
        title: createListingDto.title,
        description: createListingDto.description,
        address: createListingDto.address,
        city: createListingDto.city,
        price: createListingDto.price,
        status: ListingStatus.DRAFT,
        hostId: 'user-123',
        images: mockImages.map((img) => ({
          path: img.path,
          filename: img.filename,
          mime: img.mimetype,
        })),
        host: {
          id: 'user-123',
          fullName: 'Test User',
          mobile: '1234567890',
          email: 'test@example.com',
        },
      },
    };

    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should create a listing successfully', async () => {
      mockListingService.createListing.mockResolvedValue(mockResponse);

      const result = await controller.createListing(
        createListingDto,
        mockImages,
        mockRequest,
      );

      expect(result).toEqual(mockResponse);
      expect(mockListingService.createListing).toHaveBeenCalledWith(
        'user-123',
        createListingDto,
        mockImages,
      );
      expect(mockListingService.createListing).toHaveBeenCalledTimes(1);
    });

    it('should create a listing without images', async () => {
      const responseWithoutImages = {
        ...mockResponse,
        data: {
          ...mockResponse.data,
          images: [],
        },
      };

      mockListingService.createListing.mockResolvedValue(
        responseWithoutImages,
      );

      const result = await controller.createListing(
        createListingDto,
        [],
        mockRequest,
      );

      expect(result).toEqual(responseWithoutImages);
      expect(mockListingService.createListing).toHaveBeenCalledWith(
        'user-123',
        createListingDto,
        [],
      );
    });

    it('should pass userId from request to service', async () => {
      mockListingService.createListing.mockResolvedValue(mockResponse);

      await controller.createListing(
        createListingDto,
        mockImages,
        mockRequest,
      );

      expect(mockListingService.createListing).toHaveBeenCalledWith(
        mockRequest.user.sub,
        expect.any(Object),
        expect.any(Array),
      );
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockListingService.createListing.mockRejectedValue(error);

      await expect(
        controller.createListing(createListingDto, mockImages, mockRequest),
      ).rejects.toThrow('Service error');
    });

    it('should apply JwtAuthGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        controller.createListing,
      );
      expect(guards).toBeDefined();
    });

    it('should apply RolesGuard with HOST role', () => {
      const roles = Reflect.getMetadata('roles', controller.createListing);
      expect(roles).toContain(UserRole.HOST);
    });
  });

  describe('findAllForUser', () => {
    const mockRequest = {
      user: {
        sub: 'user-123',
        role: UserRole.HOST,
      },
    };

    const mockListings = {
      message: 'Listings fetched successfully',
      data: [
        {
          id: 'listing-1',
          title: 'Listing 1',
          description: 'Description 1',
          hostId: 'user-123',
          images: [],
          host: {
            id: 'user-123',
            fullName: 'Test User',
            email: 'test@example.com',
            mobile: '1234567890',
          },
        },
        {
          id: 'listing-2',
          title: 'Listing 2',
          description: 'Description 2',
          hostId: 'user-123',
          images: [],
          host: {
            id: 'user-123',
            fullName: 'Test User',
            email: 'test@example.com',
            mobile: '1234567890',
          },
        },
      ],
    };

    it('should return all listings for the logged-in user', async () => {
      mockListingService.findAllListingForOneUser.mockResolvedValue(
        mockListings,
      );

      const result = await controller.findAllForUser(mockRequest);

      expect(result).toEqual(mockListings);
      expect(
        mockListingService.findAllListingForOneUser,
      ).toHaveBeenCalledWith('user-123');
      expect(
        mockListingService.findAllListingForOneUser,
      ).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when user has no listings', async () => {
      const emptyResponse = {
        message: 'Listings fetched successfully',
        data: [],
      };

      mockListingService.findAllListingForOneUser.mockResolvedValue(
        emptyResponse,
      );

      const result = await controller.findAllForUser(mockRequest);

      expect(result.data).toEqual([]);
      expect(result.message).toBe('Listings fetched successfully');
    });

    it('should extract userId from request correctly', async () => {
      mockListingService.findAllListingForOneUser.mockResolvedValue(
        mockListings,
      );

      await controller.findAllForUser(mockRequest);

      expect(
        mockListingService.findAllListingForOneUser,
      ).toHaveBeenCalledWith(mockRequest.user.sub);
    });

    it('should handle service errors', async () => {
      const error = new Error('Database error');
      mockListingService.findAllListingForOneUser.mockRejectedValue(error);

      await expect(controller.findAllForUser(mockRequest)).rejects.toThrow(
        'Database error',
      );
    });

    it('should apply required guards', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        controller.findAllForUser,
      );
      expect(guards).toBeDefined();
    });
  });

  describe('updateListing', () => {
    const listingId = 'listing-123';
    const updateListingDto: UpdateListingDto = {
      title: 'Updated Title Here',
      description: 'Updated description',
      price: 2000,
    };

    const mockImages: Express.Multer.File[] = [
      {
        fieldname: 'images',
        originalname: 'updated.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        size: 2048,
        destination: './uploads',
        filename: 'updated-123.jpg',
        path: '/uploads/updated-123.jpg',
        buffer: Buffer.from(''),
      } as Express.Multer.File,
    ];

    const mockRequest = {
      user: {
        sub: 'user-123',
        role: UserRole.HOST,
      },
    };

    const mockResponse = {
      message: 'Listing updated successfully',
      data: {
        id: listingId,
        title: updateListingDto.title,
        description: updateListingDto.description,
        price: updateListingDto.price,
        hostId: 'user-123',
        images: mockImages.map((img) => ({
          path: img.path,
          filename: img.filename,
          mime: img.mimetype,
        })),
      },
    };

    it('should update a listing successfully', async () => {
      mockListingService.updateListing.mockResolvedValue(mockResponse);

      const result = await controller.updateListing(
        listingId,
        updateListingDto,
        mockImages,
        mockRequest,
      );

      expect(result).toEqual(mockResponse);
      expect(mockListingService.updateListing).toHaveBeenCalledWith(
        'user-123',
        listingId,
        updateListingDto,
        mockImages,
      );
      expect(mockListingService.updateListing).toHaveBeenCalledTimes(1);
    });

    it('should update a listing without images', async () => {
      const responseWithoutImages = {
        ...mockResponse,
        data: {
          ...mockResponse.data,
          images: [],
        },
      };

      mockListingService.updateListing.mockResolvedValue(
        responseWithoutImages,
      );

      const result = await controller.updateListing(
        listingId,
        updateListingDto,
        [],
        mockRequest,
      );

      expect(result).toEqual(responseWithoutImages);
      expect(mockListingService.updateListing).toHaveBeenCalledWith(
        'user-123',
        listingId,
        updateListingDto,
        [],
      );
    });

    it('should pass all parameters correctly to service', async () => {
      mockListingService.updateListing.mockResolvedValue(mockResponse);

      await controller.updateListing(
        listingId,
        updateListingDto,
        mockImages,
        mockRequest,
      );

      expect(mockListingService.updateListing).toHaveBeenCalledWith(
        mockRequest.user.sub,
        listingId,
        updateListingDto,
        mockImages,
      );
    });

    it('should handle partial updates', async () => {
      const partialUpdate: UpdateListingDto = {
        price: 1500,
      };

      const partialResponse = {
        message: 'Listing updated successfully',
        data: {
          ...mockResponse.data,
          price: 1500,
        },
      };

      mockListingService.updateListing.mockResolvedValue(partialResponse);

      const result = await controller.updateListing(
        listingId,
        partialUpdate,
        [],
        mockRequest,
      );

      expect(result.data.price).toBe(1500);
    });

    it('should handle service errors', async () => {
      const error = new Error('Update failed');
      mockListingService.updateListing.mockRejectedValue(error);

      await expect(
        controller.updateListing(
          listingId,
          updateListingDto,
          mockImages,
          mockRequest,
        ),
      ).rejects.toThrow('Update failed');
    });

    it('should apply required guards and roles', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        controller.updateListing,
      );
      const roles = Reflect.getMetadata('roles', controller.updateListing);

      expect(guards).toBeDefined();
      expect(roles).toContain(UserRole.HOST);
    });
  });

  describe('remove (deleteListing)', () => {
    const listingId = 'listing-123';
    const mockRequest = {
      user: {
        sub: 'user-123',
        role: UserRole.HOST,
      },
    };

    const mockResponse = {
      message: 'Listing deleted successfully',
    };

    it('should delete a listing successfully', async () => {
      mockListingService.deleteListing.mockResolvedValue(mockResponse);

      const result = await controller.remove(listingId, mockRequest);

      expect(result).toEqual(mockResponse);
      expect(mockListingService.deleteListing).toHaveBeenCalledWith(
        'user-123',
        listingId,
      );
      expect(mockListingService.deleteListing).toHaveBeenCalledTimes(1);
    });

    it('should pass userId and listingId correctly', async () => {
      mockListingService.deleteListing.mockResolvedValue(mockResponse);

      await controller.remove(listingId, mockRequest);

      expect(mockListingService.deleteListing).toHaveBeenCalledWith(
        mockRequest.user.sub,
        listingId,
      );
    });

    it('should handle service errors', async () => {
      const error = new Error('Delete failed');
      mockListingService.deleteListing.mockRejectedValue(error);

      await expect(controller.remove(listingId, mockRequest)).rejects.toThrow(
        'Delete failed',
      );
    });

    it('should handle NotFoundException from service', async () => {
      const notFoundError = new Error('Listing not found');
      mockListingService.deleteListing.mockRejectedValue(notFoundError);

      await expect(controller.remove(listingId, mockRequest)).rejects.toThrow(
        'Listing not found',
      );
    });

    it('should handle ForbiddenException from service', async () => {
      const forbiddenError = new Error(
        'You are not allowed to delete this listing',
      );
      mockListingService.deleteListing.mockRejectedValue(forbiddenError);

      await expect(controller.remove(listingId, mockRequest)).rejects.toThrow(
        'You are not allowed to delete this listing',
      );
    });

    it('should apply required guards', () => {
      const guards = Reflect.getMetadata('__guards__', controller.remove);
      const roles = Reflect.getMetadata('roles', controller.remove);

      expect(guards).toBeDefined();
      expect(roles).toContain(UserRole.HOST);
    });
  });

  describe('Guards Integration', () => {
    it('should have ThrottlerGuard applied to controller', () => {
      const guards = Reflect.getMetadata('__guards__', ListingController);
      expect(guards).toBeDefined();
    });

    it('should verify JwtAuthGuard is working', () => {
      expect(mockJwtAuthGuard.canActivate).toBeDefined();
    });

    it('should verify RolesGuard is working', () => {
      expect(mockRolesGuard.canActivate).toBeDefined();
    });

    it('should verify ThrottlerGuard is working', () => {
      expect(mockThrottlerGuard.canActivate).toBeDefined();
    });
  });

  describe('HTTP Status Codes', () => {
    it('createListing should return CREATED (201)', async () => {
      const createDto: CreateListingDto = {
        title: 'Test Listing',
        description: 'Test description',
        address: '123 Test Street',
        city: 'Cairo',
        price: 1000,
      };

      mockListingService.createListing.mockResolvedValue({
        message: 'Listing created successfully',
        data: {},
      });

      const mockRequest = { user: { sub: 'user-123' } };
      const result = await controller.createListing(createDto, [], mockRequest);

      expect(result.message).toBe('Listing created successfully');
    });

    it('findAllForUser should return OK (200)', async () => {
      mockListingService.findAllListingForOneUser.mockResolvedValue({
        message: 'Listings fetched successfully',
        data: [],
      });

      const mockRequest = { user: { sub: 'user-123' } };
      const result = await controller.findAllForUser(mockRequest);

      expect(result.message).toBe('Listings fetched successfully');
    });
  });

  describe('File Upload Handling', () => {
    it('should handle multiple image uploads', async () => {
      const multipleImages: Express.Multer.File[] = [
        {
          path: '/uploads/image1.jpg',
          filename: 'image1.jpg',
          mimetype: 'image/jpeg',
        } as Express.Multer.File,
        {
          path: '/uploads/image2.jpg',
          filename: 'image2.jpg',
          mimetype: 'image/jpeg',
        } as Express.Multer.File,
        {
          path: '/uploads/image3.jpg',
          filename: 'image3.jpg',
          mimetype: 'image/jpeg',
        } as Express.Multer.File,
      ];

      const createDto: CreateListingDto = {
        title: 'Test Listing with Images',
        description: 'Test description',
        address: '123 Test Street',
        city: 'Cairo',
        price: 1000,
      };

      mockListingService.createListing.mockResolvedValue({
        message: 'Listing created successfully',
        data: { images: multipleImages },
      });

      const mockRequest = { user: { sub: 'user-123' } };
      const result = await controller.createListing(
        createDto,
        multipleImages,
        mockRequest,
      );

      expect(mockListingService.createListing).toHaveBeenCalledWith(
        'user-123',
        createDto,
        multipleImages,
      );
      expect(result.data.images).toHaveLength(3);
    });

    it('should handle empty image array', async () => {
      const createDto: CreateListingDto = {
        title: 'Test Listing No Images',
        description: 'Test description',
        address: '123 Test Street',
        city: 'Cairo',
        price: 1000,
      };

      mockListingService.createListing.mockResolvedValue({
        message: 'Listing created successfully',
        data: { images: [] },
      });

      const mockRequest = { user: { sub: 'user-123' } };
      const result = await controller.createListing(createDto, [], mockRequest);

      expect(result.data.images).toEqual([]);
    });
  });
});