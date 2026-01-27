import { applyDecorators } from '@nestjs/common';
import {
    ApiResponse,
    ApiInternalServerErrorResponse,
    ApiBadRequestResponse,
    ApiNotFoundResponse,
} from '@nestjs/swagger';


export function CommonApiResponses() {
    return applyDecorators(
        ApiNotFoundResponse({ description: 'Resource not found.' }),
        ApiInternalServerErrorResponse({ description: 'Unexpected server error.' }),
    );
}

export function CreateApiResponses(resourceName: string = 'Resource') {
    return applyDecorators(
        ApiResponse({
            status: 201,
            description: `${resourceName} created successfully.`
        }),
        ApiBadRequestResponse({ description: 'Bad Request - Invalid input data.' }),
        ApiInternalServerErrorResponse({ description: 'Unexpected server error.' }),
    );
}

export function UpdateApiResponses(resourceName: string = 'Resource') {
    return applyDecorators(
        ApiResponse({
            status: 200,
            description: `${resourceName} updated successfully.`
        }),
        ApiNotFoundResponse({ description: `${resourceName} not found.` }),
        ApiBadRequestResponse({ description: 'Bad Request - Invalid input data.' }),
        ApiInternalServerErrorResponse({ description: 'Unexpected server error.' }),
    );
}

export function DeleteApiResponses(resourceName: string = 'Resource') {
    return applyDecorators(
        ApiResponse({
            status: 200,
            description: `${resourceName} deleted successfully.`
        }),
        ApiNotFoundResponse({ description: `${resourceName} not found.` }),
        ApiInternalServerErrorResponse({ description: 'Unexpected server error.' }),
    );
}

export function GetOneApiResponses(resourceName: string = 'Resource') {
    return applyDecorators(
        ApiResponse({
            status: 200,
            description: `${resourceName} retrieved successfully.`
        }),
        ApiNotFoundResponse({ description: `${resourceName} not found.` }),
        ApiInternalServerErrorResponse({ description: 'Unexpected server error.' }),
    );
}

export function GetManyApiResponses(resourceName: string = 'Resources') {
    return applyDecorators(
        ApiResponse({
            status: 200,
            description: `${resourceName} retrieved successfully.`
        }),
        ApiInternalServerErrorResponse({ description: 'Unexpected server error.' }),
    );
}