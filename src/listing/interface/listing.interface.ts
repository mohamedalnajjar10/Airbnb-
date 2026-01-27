export interface FileWithBuffer {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
    size: number;
}
export interface FileValidatorOptions {
    allowedMimeTypes: string[];
    maxFileSize: number; 
}
