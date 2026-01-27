import { Listing, ListingImage } from '@prisma/client';

export interface ListingResponse {
  message: string;
  data: Listing & {
    images: ListingImage[];
    host: {
      id: string;
      fullName: string;
      mobile: string;
      email: string | null;
    };
  };
}