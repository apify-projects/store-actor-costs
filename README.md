Get costs and usage stats for your actor use aggregated daily. The actor also provides summary stats for the whole period.

It extends data available on https://console.apify.com/billing/usage with
1. Daily usage breakdown
2. Arbitrary time period with summary stats for the whole period
3. Other useful stats - `runCount`, `buildNumbers`, `statuses`, `origins`

 *Important*: Run costs are attributed to a specific date based on the start time of the run. The actor does not exactly report the costs per day or month. E.g. if your run runs for 2 days, this actor will report its cost fully to the first day while https://console.apify.com/billing/usage will correctly split the usage into 2 days. The overall usage for a period should be the same.

## Example output

```json
[{
    "date": "2024-02-24",
    "runCount": 1,
    "cost": 0.0086,
    "firstRunDate": "2024-02-24T20:59:22.127Z",
    "lastRunDate": "2024-02-24T20:59:22.127Z",
    "buildNumbers": {
        "0.14.259": 1
    },
    "statuses": {
        "SUCCEEDED": 1
    },
    "origins": {
        "WEB": 1
    }
},
{
    "date": "2024-02-16",
    "runCount": 4,
    "cost": 0.0838,
    "firstRunDate": "2024-02-16T10:02:35.200Z",
    "lastRunDate": "2024-02-16T16:16:02.125Z",
    "buildNumbers": {
        "0.14.258": 2,
        "0.14.257": 2
    },
    "statuses": {
        "SUCCEEDED": 1,
        "FAILED": 1,
        "ABORTED": 2
    },
    "origins": {
        "WEB": 4
    }
}]
```