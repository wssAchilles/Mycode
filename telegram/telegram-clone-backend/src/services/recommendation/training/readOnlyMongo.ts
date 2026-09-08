import {
    connectMongoDB,
    disconnectMongoDB,
    type MongoConnectionOverrides,
} from '../../../config/db';

export const READ_ONLY_MONGO_OPTIONS = {
    autoIndex: false,
    autoCreate: false,
    quiet: true,
} as const satisfies MongoConnectionOverrides;

export async function connectReadOnlyMongo(): Promise<void> {
    await connectMongoDB(READ_ONLY_MONGO_OPTIONS);
}

export async function disconnectReadOnlyMongo(): Promise<void> {
    await disconnectMongoDB();
}
