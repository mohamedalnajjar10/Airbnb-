import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { FileValidator } from "@nestjs/common/pipes/file/file-validator.interface";
import magicBytes from 'magic-bytes.js';
import { FileValidatorOptions, FileWithBuffer } from "../interface/listing.interface";



export class FileSignatureValidator extends FileValidator {
    private readonly allowedMimeTypes: string[];
    private readonly maxFileSize: number;
    constructor(options: FileValidatorOptions) {
        super(options);
        this.allowedMimeTypes = options.allowedMimeTypes;
        this.maxFileSize = options.maxFileSize;
    }

    isValid(file: FileWithBuffer): boolean | Promise<boolean> {
        if (!file || !file.buffer || !file.mimetype || !file.size || !file.originalname) {
            throw new BadRequestException("Invalid file or missing required properties (buffer, mimetype, size, originalname).");
        }
        if (file.size > this.maxFileSize) {
            throw new PayloadTooLargeException(
                `File size (${file.size} bytes) exceeds the allowed limit (${this.maxFileSize} bytes).`,
            );
        }
        // validate file signature
        const filesSignatures = magicBytes(file.buffer).map((file) => file.mime);
        // console.log('filesSignatures', filesSignatures);
        if (!filesSignatures.length) {
            throw new BadRequestException("Unable to detect file signature.");
        }

        const isMatch = filesSignatures.includes(file.mimetype);
        if (!isMatch) {
            throw new BadRequestException(
                `File signature does not match the MIME type. Detected signatures: ${filesSignatures.join(', ')}, but got: ${file.mimetype}`,
            );
        }

        return true;
    }
    buildErrorMessage(file: FileWithBuffer): string {
        return `File validation failed for ${file.originalname}. Allowed MIME types: ${this.allowedMimeTypes.join(', ')}. Max file size: ${this.maxFileSize} bytes.`;
    }
}
