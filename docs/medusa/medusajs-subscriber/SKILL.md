---
name: medusajs-subscriber
description: Create MedusaJS 2.x event subscribers for event-driven architecture. Use when handling Medusa events (order.placed, product.created), emitting custom events, or responding to system events. Keywords: subscriber, event, handler, listener, SubscriberConfig, eventBus, emit, order.placed, product.created, customer.created.
---

# MedusaJS Subscriber Development

## Purpose

Guidance for creating event subscribers in MedusaJS 2.x. Subscribers listen for events and execute logic in response, enabling event-driven architecture.

## When to Use

- Creating subscribers in `src/subscribers/`
- Handling Medusa events (order.placed, product.created, etc.)
- Keywords: "subscriber", "event", "handler", "listener"

## Subscriber Structure

```
src/subscribers/
├── order-placed.ts           # Single event subscriber
├── product-sync.ts           # Sync subscriber
└── notification/
    ├── index.ts              # Multiple related subscribers
    └── handlers.ts
```

## Basic Subscriber

```typescript
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';

export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve('logger');
  const orderId = event.data.id;

  logger.info(`[OrderPlaced] Processing order: ${orderId}`);

  // Handle event logic
}

export const config: SubscriberConfig = {
  event: 'order.placed',
};
```

## Subscriber with Workflow

```typescript
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';
import { syncOrderWorkflow } from '../workflows/sync-order';

export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  await syncOrderWorkflow(container).run({
    input: {
      orderId: event.data.id,
    },
  });
}

export const config: SubscriberConfig = {
  event: 'order.placed',
};
```

## Subscriber with Service

```typescript
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';

type ProductCreatedData = {
  id: string;
  handle: string;
};

export default async function productCreatedHandler({
  event,
  container,
}: SubscriberArgs<ProductCreatedData>) {
  const searchService = container.resolve('searchService');
  const logger = container.resolve('logger');

  logger.info(`[ProductCreated] Indexing product: ${event.data.id}`);

  await searchService.indexProduct(event.data.id);
}

export const config: SubscriberConfig = {
  event: 'product.created',
};
```

## Multiple Events Subscriber

```typescript
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';

type ProductEventData = {
  id: string;
};

export default async function productChangeHandler({
  event,
  container,
}: SubscriberArgs<ProductEventData>) {
  const logger = container.resolve('logger');
  const cacheService = container.resolve('cacheService');

  logger.info(`[ProductChange] Event: ${event.name}, Product: ${event.data.id}`);

  // Invalidate cache on any product change
  await cacheService.invalidate(`product:${event.data.id}`);
}

export const config: SubscriberConfig = {
  event: ['product.created', 'product.updated', 'product.deleted'],
};
```

## Common Medusa Events

### Order Events

```typescript
'order.placed'           // Order created and payment authorized
'order.canceled'         // Order canceled
'order.completed'        // Order completed
'order.updated'          // Order updated
'order.fulfillment_created'  // Fulfillment created
```

### Product Events

```typescript
'product.created'        // Product created
'product.updated'        // Product updated
'product.deleted'        // Product deleted
```

### Customer Events

```typescript
'customer.created'       // Customer registered
'customer.updated'       // Customer updated
'customer.deleted'       // Customer deleted
'customer.password_reset' // Password reset requested
```

### Cart Events

```typescript
'cart.created'           // Cart created
'cart.updated'           // Cart updated
'cart.customer_updated'  // Customer attached to cart
```

### Payment Events

```typescript
'payment.captured'       // Payment captured
'payment.refunded'       // Payment refunded
```

## Emitting Custom Events

### From Workflow Step

```typescript
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { Modules } from '@medusajs/framework/utils';

export const emitEventStep = createStep(
  'emit-event-step',
  async (input: { orderId: string }, { container }) => {
    const eventBus = container.resolve(Modules.EVENT_BUS);

    await eventBus.emit({
      name: 'custom.order.synced',
      data: {
        order_id: input.orderId,
        synced_at: new Date().toISOString(),
      },
    });

    return new StepResponse({ emitted: true });
  }
);
```

### From Service

```typescript
import { Modules } from '@medusajs/framework/utils';

class MyService {
  private eventBus_: IEventBusService;

  constructor(container: InjectedDependencies) {
    this.eventBus_ = container[Modules.EVENT_BUS];
  }

  async processItem(id: string): Promise<void> {
    // Process logic...

    await this.eventBus_.emit({
      name: 'my-module.item.processed',
      data: { id, processed_at: new Date().toISOString() },
    });
  }
}
```

## Subscribe to Custom Events

```typescript
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';

type CustomEventData = {
  order_id: string;
  synced_at: string;
};

export default async function customOrderSyncedHandler({
  event,
  container,
}: SubscriberArgs<CustomEventData>) {
  const logger = container.resolve('logger');
  logger.info(`[CustomEvent] Order synced: ${event.data.order_id}`);
}

export const config: SubscriberConfig = {
  event: 'custom.order.synced',
};
```

## Async Subscriber (Background Processing)

For long-running tasks, use workflows with async execution:

```typescript
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';
import { syncDataWorkflow } from '../workflows/sync-data';

export default async function dataSyncHandler({
  event,
  container,
}: SubscriberArgs<{ ids: string[] }>) {
  // Run workflow asynchronously (doesn't wait for completion)
  await syncDataWorkflow(container).run({
    input: { ids: event.data.ids },
    throwOnError: false, // Don't throw if workflow fails
  });
}

export const config: SubscriberConfig = {
  event: 'batch.data.sync',
};
```

## Error Handling

### Let Errors Propagate (Recommended)

```typescript
export default async function myHandler({ event, container }: SubscriberArgs) {
  const myService = container.resolve('myService');

  // Errors will be logged and can trigger retries
  await myService.process(event.data.id);
}
```

### Log and Continue (Non-Critical Events)

```typescript
export default async function myHandler({ event, container }: SubscriberArgs) {
  const logger = container.resolve('logger');
  const myService = container.resolve('myService');

  try {
    await myService.process(event.data.id);
  } catch (error) {
    logger.error(`[MyHandler] Failed to process ${event.data.id}: ${error.message}`);
    // Don't re-throw - event is non-critical
  }
}
```

## Best Practices

### ✅ DO

- Use workflows for complex multi-step operations
- Keep subscribers focused (single responsibility)
- Use proper typing for event data
- Log meaningful information
- Handle errors appropriately based on criticality

### ❌ DON'T

- Don't put heavy business logic directly in subscribers
- Don't block on long-running operations (use async workflows)
- Don't swallow errors for critical events
- Don't create circular event emissions

## Critical Rules

- Subscribers run asynchronously - don't expect immediate execution
- Use workflows for operations requiring rollback
- Consider idempotency - events may be delivered multiple times
- Keep subscriber execution time short

---

**Remember:** Always follow CLAUDE.md guidelines:
- Run `yarn tsc --noEmit` and `yarn lint --fix` after changes
- Use workflows for complex operations
- Consider event delivery guarantees