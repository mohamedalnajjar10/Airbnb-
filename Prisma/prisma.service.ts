import { INestApplication, Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";


type PrismaClientEvents = PrismaClient & {
    $on(event: 'beforeExit', callback: () => Promise<void>): void;
};

@Injectable()
export class PrismaService extends (PrismaClient as new () => PrismaClientEvents) implements OnModuleInit {
    async onModuleInit() {
        await this.$connect();
    }
    async enableShutdownHooks(app: INestApplication) {
        this.$on('beforeExit', async () => {
            await app.close();
        });
    }
}