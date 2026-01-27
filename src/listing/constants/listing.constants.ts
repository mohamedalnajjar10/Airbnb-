export const LISTING_CONSTANTS = {
    // Maximum number of listings a host can create
    MAX_LISTINGS_PER_HOST: 10,

    // Maximum number of listings per day
    MAX_LISTINGS_PER_DAY: 3,

    // Listing title constraints
    TITLE: {
        MIN_LENGTH: 10,
        MAX_LENGTH: 100,
    },

    // Listing description constraints
    DESCRIPTION: {
        MIN_LENGTH: 50,
        MAX_LENGTH: 2000,
    },

    // Address constraints
    ADDRESS: {
        MIN_LENGTH: 10,
        MAX_LENGTH: 500,
    },

    // Price constraints
    PRICE: {
        MIN: 1,
        MAX: 1000000,
    },

    // Guest capacity
    GUESTS: {
        MIN: 1,
        MAX: 50,
    },
} as const;

export type ListingConstants = typeof LISTING_CONSTANTS;
