import { Actor, log } from 'apify';
import { useState } from 'crawlee';
import { processRuns } from './process-runs.js';

interface Input {
    actorIdOrName: string;
    onlyRunsNewerThan?: string;
    onlyRunsOlderThan?: string;
    getCostBreakdown: boolean;
    getDatasetItemCount: boolean;
    parallelCalls: number;
}

interface DateAggregation {
    date: string,
    runCount: number,
    cost: number,
    // Only when requested in input
    datasetItems?: number,
    costDetail: Record<string, number>,
    usageDetail: Record<string, number>,
    firstRunDate: string,
    lastRunDate: string,
    buildNumbers: Record<string, number>,
    statuses: Record<string, number>,
    origins: Record<string, number>,
}

type DateAggregations = Record<string, DateAggregation>;

// { date: stats }
export interface State {
    dateAggregations: DateAggregations;
    lastProcessedRunId: string | null;
    lastProcessedOffset: number;
}

// The init() call configures the Actor for its environment. It's recommended to start every Actor with an init()
await Actor.init();

const {
    actorIdOrName,
    onlyRunsNewerThan,
    onlyRunsOlderThan,
    getCostBreakdown,
    getDatasetItemCount,
    parallelCalls,
} = (await Actor.getInput<Input>())!;

let onlyRunsNewerThanDate;

if (onlyRunsNewerThan) {
    onlyRunsNewerThanDate = new Date(onlyRunsNewerThan);
    if (Number.isNaN(onlyRunsNewerThanDate.getTime())) {
        await Actor.fail('Invalid date format for onlyRunsNewerThan, use YYYY-MM-DD or with time YYYY-MM-DDTHH:mm:ss');
    }
}

let onlyRunsOlderThanDate;

if (onlyRunsOlderThan) {
    onlyRunsOlderThanDate = new Date(onlyRunsOlderThan);
    if (Number.isNaN(onlyRunsOlderThanDate.getTime())) {
        await Actor.fail('Invalid date format for onlyRunsOlderThan, use YYYY-MM-DD or with time YYYY-MM-DDTHH:mm:ss');
    }
}

if (onlyRunsNewerThanDate && onlyRunsOlderThanDate && onlyRunsNewerThanDate > onlyRunsOlderThanDate) {
    await Actor.fail(`'onlyRunsNewerThan' must be an older date than 'onlyRunsOlderThan'`);
}

const runsClient = Actor.apifyClient.actor(actorIdOrName).runs();

const state = await useState<State>(
    'STATE',
    { lastProcessedOffset: 0, lastProcessedRunId: null, dateAggregations: {} },
);

const LIMIT = 1000;
let offset = state.lastProcessedOffset;
for (; ;) {
    const runs = await runsClient.list({ desc: true, limit: 1000, offset }).then((res) => res.items);

    log.info(`Loaded ${runs.length} runs (offset from now: ${offset}), newest: ${runs[0]?.startedAt}, `
        + `oldest: ${runs[runs.length - 1]?.startedAt} processing them now`);

    const { stopLoop } = await processRuns({
        runs,
        state,
        onlyRunsOlderThanDate,
        onlyRunsNewerThanDate,
        getCostBreakdown,
        getDatasetItemCount,
        parallelCalls,
    });

    state.lastProcessedOffset = offset;

    if (stopLoop) {
        log.warning(`Reached onlyRunsNewerThanDate ${onlyRunsNewerThanDate}, stopping loading runs`);
        break;
    }

    if (runs.length < LIMIT) {
        log.warning('No more runs to process, stopping loading runs');
        break;
    }

    offset += LIMIT;
}

const totalStats: Omit<DateAggregation, 'date'> = {
    runCount: 0,
    cost: 0,
    costDetail: {},
    usageDetail: {},
    firstRunDate: '',
    lastRunDate: '',
    buildNumbers: {},
    statuses: {},
    origins: {},
};

await Actor.pushData(Object.values(state.dateAggregations)
    .map((aggregation: DateAggregation) => {
        totalStats.runCount += aggregation.runCount;
        totalStats.cost += aggregation.cost;
        if (aggregation.datasetItems) {
            if (!totalStats.datasetItems) {
                totalStats.datasetItems = 0;
            }
            totalStats.datasetItems += aggregation.datasetItems;
        }
        if (!totalStats.lastRunDate) {
            totalStats.lastRunDate = aggregation.lastRunDate;
        }
        totalStats.firstRunDate = aggregation.firstRunDate;
        for (const [buildNumber, count] of Object.entries(aggregation.buildNumbers)) {
            totalStats.buildNumbers[buildNumber] = (totalStats.buildNumbers[buildNumber] ?? 0) + count;
        }
        for (const [status, count] of Object.entries(aggregation.statuses)) {
            totalStats.statuses[status] = (totalStats.statuses[status] ?? 0) + count;
        }
        for (const [origin, count] of Object.entries(aggregation.origins)) {
            totalStats.origins[origin] = (totalStats.origins[origin] ?? 0) + count;
        }

        const cleanedCostDetail: Record<string, number> = {};

        for (const [usageType, usageUsd] of Object.entries(aggregation.costDetail)) {
            cleanedCostDetail[usageType] = Number(usageUsd.toFixed(4));
            totalStats.costDetail[usageType] ??= 0;
            totalStats.costDetail[usageType] += Number(usageUsd.toFixed(4));
        }

        const cleanedUsageDetail: Record<string, number> = {};

        for (const [usageType, usage] of Object.entries(aggregation.usageDetail)) {
            cleanedUsageDetail[usageType] = Number(usage.toFixed(4));
            totalStats.usageDetail[usageType] ??= 0;
            totalStats.usageDetail[usageType] += Number(usage.toFixed(4));
        }

        return { ...aggregation, cost: Number(aggregation.cost.toFixed(4)), costDetail: cleanedCostDetail, usageDetail: cleanedUsageDetail };
    }));

await Actor.setValue('STATE', state);
await Actor.setValue('TOTAL_STATS', totalStats);

const store = await Actor.openKeyValueStore();
const url = store.getPublicUrl('TOTAL_STATS');
await Actor.exit(`Total stats for whole period are available at ${url}`);
