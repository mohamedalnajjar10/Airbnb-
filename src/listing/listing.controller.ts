import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards, UseInterceptors, HttpStatus, UploadedFiles, HttpCode, Query } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ListingService } from './listing.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { multerOptions } from 'src/listing/config/multer.config';
import { UserRole } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ListingQueryDto } from './dto/listing-query.dto';
import { ListingForUserQueryDto } from './dto/listing-user-query.dto';
import { SearchListingDto } from './dto/search-listing.dto';

@ApiTags('Listings')
@Controller('listings')
@UseGuards(ThrottlerGuard)
export class ListingController {
  constructor(private readonly listingService: ListingService) { }

  @Post('create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new Listing (Host only)' })
  @ApiResponse({ status: 201, description: 'Listing created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'Listing already exists' })
  @UseInterceptors(FilesInterceptor('images', 10, multerOptions))
  async createListing(
    @Body() createListingDto: CreateListingDto,
    @UploadedFiles() images: Express.Multer.File[],
    @Req() req: any,
  ) {
    const userId = req.user.sub;
    return this.listingService.createListing(userId, createListingDto, images);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOST)
  @Get('my-listings')
  @ApiOperation({ summary: 'Get all listings for the logged-in host' })
  @ApiResponse({ status: 200, description: 'Listings fetched successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findAllForUser(
    @Req() req: any,
    @Query() query: ListingForUserQueryDto
  ) {
    const userId = req.user.sub;
    return this.listingService.findAllListingForOneUser(userId, query);
  }


  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Update a new Listing (Host only)' })
  @ApiResponse({ status: 201, description: 'Listing updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'Listing already exists' })
  @UseInterceptors(FilesInterceptor('images', 10, multerOptions))
  @Patch('update/:id')
  async updateListing(
    @Param('id') id: string,
    @Body() updateListingDto: UpdateListingDto,
    @UploadedFiles() images: Express.Multer.File[],
    @Req() req: any
  ) {
    const userId = req.user.sub;
    return this.listingService.updateListing(userId, id, updateListingDto, images)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Delete a Listing (Host only)' })
  @ApiResponse({ status: 201, description: 'Listing deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'Listing already exists' })
  @Delete('delete/:id')
  async remove(
    @Param('id') listingId: string,
    @Req() req: any
  ) {
    const userId = req.user.sub;
    return await this.listingService.deleteListing(userId, listingId);
  }

  @Get()
  async findAll(@Query() query: ListingQueryDto) {
    return this.listingService.findAllListing(query);
  }

  @Get('search')
  async searchListings(
    @Query() query: SearchListingDto,
    @Req() req: Request
  ) {
    return this.listingService.searchListings(query);
  }


}
