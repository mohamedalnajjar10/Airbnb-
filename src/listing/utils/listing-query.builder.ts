import { Prisma } from '@prisma/client';
import { SearchListingDto } from '../dto/search-listing.dto';

export class ListingQueryBuilder {
    static buildFilters(query: SearchListingDto): Prisma.ListingWhereInput {
        const filters: Prisma.ListingWhereInput = {};

        // Location search
        if (query.location) {
            filters.OR = [
                { city: { contains: query.location } },
                { address: { contains: query.location } },
            ];
        }

        // Keyword Search
        if (query.keyword) {
            filters.OR = [
                ...(filters.OR ?? []),
                { title: { contains: query.keyword } },
                { description: { contains: query.keyword } },
                { city: { contains: query.keyword } },
                { address: { contains: query.keyword } },
            ];
        }

        // Price Range Filters
        if (query.minPrice || query.maxPrice) {
            filters.price = {};
            if (query.minPrice) filters.price.gte = Number(query.minPrice);
            if (query.maxPrice) filters.price.lte = Number(query.maxPrice);
        }

        return filters;
    }

    // Date Availability Filter
    static buildDateFilter(startDate?: string, endDate?: string): Prisma.ListingWhereInput {
        if (!startDate || !endDate) return {};

        const start = new Date(startDate);
        const end = new Date(endDate);

        return {
            bookings: {
                none: {
                    AND: [
                        { startDate: { lte: end } },
                        { endDate: { gte: start } },
                    ],
                },
            },
        };
    }
}
