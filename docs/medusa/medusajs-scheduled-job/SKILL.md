---
name: medusajs-scheduled-job
description: Create MedusaJS 2.x scheduled jobs (cron jobs) for periodic tasks like data sync, cleanup, and batch processing. Use when implementing periodic synchronization, cleanup tasks, daily reports, or scheduled data processing. Keywords: job, scheduled, cron, sync, periodic, batch, cleanup, daily, hourly.
---

# MedusaJS Scheduled Job Development

## Purpose

Guidance for creating scheduled jobs (cron jobs) in MedusaJS 2.x. Scheduled jobs run at specified intervals for tasks like syncing data, cleanup, and periodic processing.

## When to Use

- Creating jobs in `src/jobs/`
- Periodic data synchronization
- Cleanup tasks
- Keywords: "job", "scheduled", "cron", "sync", "periodic"

## Job Structure

```
src/jobs/
├── sync-products.ts          # Product sync job
├── cleanup-carts.ts          # Cart cleanup job
├── daily-report.ts           # Daily report job
└── stock-update.ts           # Stock update job
```

## Basic Scheduled Job

```typescript
import { MedusaContainer } from '@medusajs/framework/types';

export default async function cleanupCartsJob(container: MedusaContainer) {
  const logger = container.resolve('logger');
  const cartService = container.resolve('cartService');

  logger.info('[CleanupCarts] Starting cart cleanup');

  const abandonedCarts = await cartService.listAbandonedCarts({
    older_than: '7d',
  });

  for (const cart of abandonedCarts) {
    await cartService.delete(cart.id);
  }

  logger.info(`[CleanupCarts] Cleaned ${abandonedCarts.length} carts`);
}

export const config = {
  name: 'cleanup-abandoned-carts',
  schedule: '0 2 * * *', // Daily at 2 AM
};
```

## Job with Workflow

```typescript
import { MedusaContainer } from '@medusajs/framework/types';
import { syncProductsWorkflow } from '../workflows/sync-products';

export default async function syncProductsJob(container: MedusaContainer) {
  const logger = container.resolve('logger');

  logger.info('[SyncProducts] Starting product sync');

  const { result } = await syncProductsWorkflow(container).run({
    input: { source: 'scheduled' },
  });

  logger.info(`[SyncProducts] Synced ${result.count} products`);
}

export const config = {
  name: 'sync-products-from-erp',
  schedule: '0 */6 * * *', // Every 6 hours
};
```

## Cron Schedule Patterns

| Schedule | Pattern | Description |
|----------|---------|-------------|
| Every minute | `* * * * *` | For debugging only |
| Every 5 minutes | `*/5 * * * *` | Frequent checks |
| Every hour | `0 * * * *` | Hourly tasks |
| Every 6 hours | `0 */6 * * *` | Regular sync |
| Daily at midnight | `0 0 * * *` | Daily tasks |
| Daily at 2 AM | `0 2 * * *` | Off-peak tasks |
| Weekly (Sunday) | `0 0 * * 0` | Weekly reports |
| Monthly (1st) | `0 0 1 * *` | Monthly tasks |

### Cron Format

```
┌─────────── minute (0-59)
│ ┌───────── hour (0-23)
│ │ ┌─────── day of month (1-31)
│ │ │ ┌───── month (1-12)
│ │ │ │ ┌─── day of week (0-6, 0=Sunday)
│ │ │ │ │
* * * * *
```

## Data Sync Job Pattern

For syncing large datasets from external systems:

```typescript
import { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { chunk } from 'lodash';

const BATCH_SIZE = 50;

export default async function syncExternalDataJob(container: MedusaContainer) {
  const logger = container.resolve('logger');
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const externalService = container.resolve('externalService');
  const myService = container.resolve('myModuleService');

  logger.info('[SyncExternal] Starting sync');

  // Fetch external data
  const externalItems = await externalService.fetchAll();

  // Get existing items for comparison
  const { data: existingItems } = await query.graph({
    entity: 'my_entity',
    fields: ['id', 'external_id', 'updated_at'],
    filters: { deleted_at: null },
  });

  const existingMap = new Map(
    existingItems.map(item => [item.external_id, item])
  );

  const toCreate: any[] = [];
  const toUpdate: any[] = [];

  for (const item of externalItems) {
    const existing = existingMap.get(item.id);
    if (existing) {
      toUpdate.push({ id: existing.id, ...item });
    } else {
      toCreate.push(item);
    }
  }

  // Process in batches
  if (toCreate.length > 0) {
    const batches = chunk(toCreate, BATCH_SIZE);
    for (const batch of batches) {
      await myService.createMyEntities(batch);
    }
  }

  if (toUpdate.length > 0) {
    const batches = chunk(toUpdate, BATCH_SIZE);
    for (const batch of batches) {
      await myService.updateMyEntities(batch);
    }
  }

  logger.info(`[SyncExternal] Created: ${toCreate.length}, Updated: ${toUpdate.length}`);
}

export const config = {
  name: 'sync-external-data',
  schedule: '0 */4 * * *', // Every 4 hours
};
```

## Stream Processing for Large Data

For very large datasets, use streaming to avoid memory issues:

```typescript
import { MedusaContainer } from '@medusajs/framework/types';
import { batchProductsWorkflow } from '@medusajs/medusa/core-flows';

const PROCESS_BATCH_SIZE = 50;

async function* streamProductsFromApi(): AsyncGenerator<any> {
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `https://api.example.com/products?limit=200&offset=${offset}`
    );
    const data = await response.json();

    for (const product of data.products) {
      yield product;
    }

    if (data.products.length < 200) {
      hasMore = false;
    } else {
      offset += data.products.length;
    }
  }
}

async function* batchProducts(
  products: AsyncGenerator<any>,
  batchSize: number
): AsyncGenerator<any[]> {
  let batch: any[] = [];

  for await (const product of products) {
    batch.push(product);

    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }

  if (batch.length > 0) {
    yield batch;
  }
}

export default async function syncProductsJob(container: MedusaContainer) {
  const logger = container.resolve('logger');

  let totalProcessed = 0;

  const productStream = streamProductsFromApi();
  const batchedProducts = batchProducts(productStream, PROCESS_BATCH_SIZE);

  for await (const batch of batchedProducts) {
    await batchProductsWorkflow(container).run({
      input: {
        create: batch,
      },
    });

    totalProcessed += batch.length;
    logger.info(`[SyncProducts] Processed ${totalProcessed} products`);
  }

  logger.info(`[SyncProducts] Completed. Total: ${totalProcessed}`);
}

export const config = {
  name: 'sync-products-streaming',
  schedule: '0 0 * * *', // Daily at midnight
};
```

## Error Handling

### With Retry Logic

```typescript
import { MedusaContainer } from '@medusajs/framework/types';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export default async function syncWithRetryJob(container: MedusaContainer) {
  const logger = container.resolve('logger');
  const externalService = container.resolve('externalService');

  const data = await withRetry(() => externalService.fetchData());

  logger.info(`[SyncWithRetry] Fetched ${data.length} items`);
}

export const config = {
  name: 'sync-with-retry',
  schedule: '0 * * * *', // Every hour
};
```

### Critical vs Non-Critical Jobs

```typescript
// Critical job - let errors propagate
export default async function criticalSyncJob(container: MedusaContainer) {
  const result = await criticalOperation();
  // Errors will be logged and job will be marked as failed
}

// Non-critical job - log and continue
export default async function nonCriticalCleanupJob(container: MedusaContainer) {
  const logger = container.resolve('logger');

  try {
    await cleanupOperation();
  } catch (error) {
    logger.warn(`[Cleanup] Non-critical failure: ${error.message}`);
    // Don't re-throw - job completes normally
  }
}
```

## Job Configuration Options

```typescript
export const config = {
  name: 'my-job',              // Unique job identifier
  schedule: '0 * * * *',       // Cron expression
  // numberOfExecutions: 10,   // Limit total executions (optional)
};
```

## Best Practices

### ✅ DO

- Use workflows for complex multi-step operations
- Process data in batches to manage memory
- Implement retry logic for external API calls
- Log job progress and results
- Use streaming for very large datasets
- Set appropriate schedule based on data volume

### ❌ DON'T

- Don't run heavy jobs during peak hours
- Don't fetch all data into memory at once
- Don't skip error handling for external calls
- Don't use `* * * * *` in production
- Don't create jobs that run longer than their interval

## Critical Rules

- Jobs run on worker instances (not main server)
- Use batching for large data operations
- Consider timezone for schedule timing
- Monitor job execution times
- Implement idempotency where possible

---

**Remember:** Always follow CLAUDE.md guidelines:
- Run `yarn tsc --noEmit` and `yarn lint --fix` after changes
- Use workflows for complex operations
- Consider memory usage for large datasets