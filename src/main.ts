import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filter/http-exception.filter';
import { PrismaExceptionFilter } from './common/filter/prisma-exception.filter';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // rawBody: true,
  });

  const configService = app.get(ConfigService)

  //Global Prefix for all routes
  const apiPrefix = configService.get('API_PREFIX') || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // Stripe webhook requires raw body - handled by NestJS rawBody: true option
  // app.use(`/${apiPrefix}/bookings/webhook`, express.raw({ type: '*/*' }));

  // Paypal webhook requires raw body - handled by NestJS rawBody: true option
  app.use(`/${apiPrefix}/bookings/paypal/webhook`, express.raw({ type: '*/*' }));

  // Enable CORS
  app.enableCors({
    origin: configService.get('CORS_ORIGIN') || '*',
    credentials: true
  });

  //Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  )

  // Global error handling can be added here (e.g., filters, interceptors)
  app.useGlobalFilters(new HttpExceptionFilter(), new PrismaExceptionFilter());

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Airbnb Platform API')
    .setDescription('Comprehensive Airbnb Platform API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const port = configService.get('PORT') || 8001;
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}${apiPrefix}/docs`);
}
bootstrap();
