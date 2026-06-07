import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { sequelize } from '../config/sequelize';
import { connectMongoDB } from '../config/db';
import Contact, { ContactStatus } from '../models/Contact';
import UserSignal, { ProductSurface, SignalType, TargetType } from '../models/UserSignal';
import { InteractionType } from '../models/RealGraphEdge';
import { realGraphService } from '../services/recommendation/RealGraphService';
import { redis } from '../config/redis';

dotenv.config();

function parseArgs() {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = value;
    }
    return {
        dryRun: kv['dry-run'] === 'true',
        limit: Math.max(1, parseInt(kv.limit || '10000', 10) || 10000),
        batchSize: Math.max(1, parseInt(kv.batch || '500', 10) || 500),
    };
}

async function main() {
    const args = parseArgs();
    await connectMongoDB();
    const result = await replayContacts(args);
    console.log(JSON.stringify(result, null, 2));
}

async function replayContacts(options: { dryRun: boolean; limit: number; batchSize: number }) {
    let scanned = 0;
    let signalCandidates = 0;
    let insertedSignals = 0;
    let realGraphInteractions = 0;
    let offset = 0;

    while (scanned < options.limit) {
        const contacts = await Contact.findAll({
            order: [['updatedAt', 'DESC']],
            offset,
            limit: Math.min(options.batchSize, options.limit - scanned),
        });
        if (contacts.length === 0) break;
        scanned += contacts.length;
        offset += contacts.length;

        const interactions: Array<{
            sourceUserId: string;
            targetUserId: string;
            interactionType: InteractionType;
            value?: number;
        }> = [];

        for (const contact of contacts) {
            const signalType = signalForStatus(contact.status);
            const interactionType = interactionForStatus(contact.status);
            if (!signalType || !interactionType) continue;
            signalCandidates += 1;
            if (options.dryRun) continue;

            const sourceContactId = contact.id;
            const write = await UserSignal.updateOne(
                {
                    userId: contact.userId,
                    signalType,
                    targetId: contact.contactId,
                    'metadata.sourceContactId': sourceContactId,
                },
                {
                    $setOnInsert: {
                        userId: contact.userId,
                        signalType,
                        targetId: contact.contactId,
                        targetType: TargetType.USER,
                        targetAuthorId: contact.contactId,
                        productSurface: ProductSurface.SPACE_FEED,
                        metadata: {
                            sourceContactId,
                            replayedFrom: 'contacts',
                            contactStatus: contact.status,
                        },
                        timestamp: contact.updatedAt || contact.addedAt || new Date(),
                        expiresAt: expiresAtForSignal(signalType, contact.updatedAt || contact.addedAt || new Date()),
                    },
                },
                { upsert: true },
            );

            if (write.upsertedCount > 0) {
                insertedSignals += 1;
                interactions.push({
                    sourceUserId: contact.userId,
                    targetUserId: contact.contactId,
                    interactionType,
                    value: 1,
                });
            }
        }

        if (interactions.length > 0) {
            await realGraphService.recordInteractionsBatch(interactions);
            realGraphInteractions += interactions.length;
        }
    }

    return {
        dryRun: options.dryRun,
        scanned,
        signalCandidates,
        insertedSignals,
        realGraphInteractions,
    };
}

function signalForStatus(status: ContactStatus): SignalType | null {
    if (status === ContactStatus.ACCEPTED) return SignalType.FOLLOW;
    if (status === ContactStatus.BLOCKED) return SignalType.BLOCK;
    return null;
}

function interactionForStatus(status: ContactStatus): InteractionType | null {
    if (status === ContactStatus.ACCEPTED) return InteractionType.FOLLOW;
    if (status === ContactStatus.BLOCKED) return InteractionType.BLOCK;
    return null;
}

function expiresAtForSignal(signalType: SignalType, timestamp: Date): Date {
    const days = signalType === SignalType.BLOCK ? 365 : 30;
    return new Date(timestamp.getTime() + days * 24 * 60 * 60 * 1000);
}

main()
    .catch((error) => {
        console.error('[ReplayContactsToRecommendationGraph] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            mongoose.connection.removeAllListeners('disconnected');
            mongoose.connection.removeAllListeners('error');
            await mongoose.disconnect();
        } catch {
            // ignore
        }
        try {
            await sequelize.close();
        } catch {
            // ignore
        }
        try {
            redis.disconnect();
        } catch {
            // ignore
        }
    });
