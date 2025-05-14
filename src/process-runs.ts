import { Actor, log } from 'apify';

import type { ActorRunListItem, ActorRun } from 'apify-client';
import { sleep } from 'crawlee';
import type { State } from './main.js';

interface ProcessRunsInputsBase {
    state: State;
    onlyRunsOlderThanDate?: Date;
    onlyRunsNewerThanDate?: Date;
    getCostBreakdown: boolean;
    getDatasetItemCount: boolean;
}

interface ProcessRunsInputs extends ProcessRunsInputsBase {
    runs: ActorRunListItem[];
    parallelCalls: number;
}

interface ProcessSingleRunInputs extends ProcessRunsInputsBase {
    run: ActorRunListItem;
}

let isMigrating = false;
Actor.on('migrating', () => {
    isMigrating = true;
});

let foundLastProcessedRun = false;

const processRun = async ({
    run,
    state,
    onlyRunsOlderThanDate,
    onlyRunsNewerThanDate,
    getCostBreakdown,
    getDatasetItemCount,
}: ProcessSingleRunInputs): Promise<{ stopLoop: boolean }> => {
    if (isMigrating) {
        log.warning('Actor is migrating, pausing all processing and storing last state to continue where we left of');
        state.lastProcessedRunId = run.id;
        await sleep(999999);
    }

    // If we load after migration, we need to find run we already processed
    if (state.lastProcessedRunId && !foundLastProcessedRun) {
        const isLastProcessed = state.lastProcessedRunId === run.id;
        if (isLastProcessed) {
            foundLastProcessedRun = true;
            state.lastProcessedRunId = null;
        } else {
            log.warning(`Skipping run we already processed before migration ${run.id}`);
            // We are skipping runs we already processed but we might reach unprocessed ones
            return { stopLoop: false };
        }
    }

    if (onlyRunsOlderThanDate && run.startedAt > onlyRunsOlderThanDate) {
        // We are skipping runs that are too new but might reach ones that are in date range
        return { stopLoop: false };
    }
    if (onlyRunsNewerThanDate && run.startedAt < onlyRunsNewerThanDate) {
        // We are going from present to past so at this point we can exit the processing completely
        return { stopLoop: true };
    }

    // We do all calls for details only after we know the run is in date range
    if (getCostBreakdown) {
        run = (await Actor.apifyClient.run(run.id).get())! as ActorRun;
    }

    let cleanItemCount = null;
    if (getDatasetItemCount) {
        cleanItemCount = await Actor.apifyClient.dataset(run.defaultDatasetId).get().then((res) => res!.cleanItemCount);
    }

    const runDate = run.startedAt.toISOString().split('T')[0];
    state.dateAggregations[runDate] ??= {
        date: runDate,
        runCount: 0,
        cost: 0,
        costDetail: {},
        usageDetail: {},
        firstRunDate: run.startedAt.toISOString(),
        lastRunDate: run.startedAt.toISOString(),
        buildNumbers: {},
        statuses: {},
        origins: {},
    };

    state.dateAggregations[runDate].runCount++;
    state.dateAggregations[runDate].cost += run.usageTotalUsd ?? 0;

    if ((run as ActorRun).usageUsd) {
        for (const [usageType, usageUsd] of Object.entries((run as ActorRun).usageUsd as Record<string, number>)) {
            state.dateAggregations[runDate].costDetail[usageType] ??= 0;
            state.dateAggregations[runDate].costDetail[usageType] += usageUsd;
        }
    }

    if ((run as ActorRun).usage) {
        for (const [usageType, usage] of Object.entries((run as ActorRun).usage as Record<string, number>)) {
            state.dateAggregations[runDate].usageDetail[usageType] ??= 0;
            state.dateAggregations[runDate].usageDetail[usageType] += usage;
        }
    }

    // lastRunDate is always the first we encounter because we go desc so we don't have to update it
    state.dateAggregations[runDate].firstRunDate = run.startedAt.toISOString();

    state.dateAggregations[runDate].buildNumbers[run.buildNumber] ??= 0;
    state.dateAggregations[runDate].buildNumbers[run.buildNumber]++;

    state.dateAggregations[runDate].statuses[run.status] ??= 0;
    state.dateAggregations[runDate].statuses[run.status]++;

    state.dateAggregations[runDate].origins[run.meta.origin] ??= 0;
    state.dateAggregations[runDate].origins[run.meta.origin]++;

    if (getDatasetItemCount && cleanItemCount !== null) {
        state.dateAggregations[runDate].datasetItems ??= 0;
        state.dateAggregations[runDate].datasetItems += cleanItemCount;
    }
    return { stopLoop: false };
};

export const processRuns = async ({
    runs,
    parallelCalls,
    ...params
}: ProcessRunsInputs): Promise<{ stopLoop: boolean }> => {
    // Runs are in decs mode
    for (let i = 0; i < runs.length; i += parallelCalls) {
        const runToRunInParallel = runs.slice(i, i + parallelCalls);
        const callResults = await Promise.all(runToRunInParallel.map((run) => processRun({ run, ...params })));

        if (callResults.some((result) => result.stopLoop)) {
            log.warning('Reached onlyRunsNewerThanDate, stopping loading runs');
            return { stopLoop: true };
        }
    }

    return { stopLoop: false };
};
