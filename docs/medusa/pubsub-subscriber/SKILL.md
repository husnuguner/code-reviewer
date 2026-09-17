---
name: pubsub-subscriber
description: Implement SubscriberHandler pattern with PubSub Module for reliable event processing using Outbox/Inbox pattern. Use when creating event subscribers with guaranteed delivery, processing payment callbacks, handling async workflows, or implementing event-driven flows with retry support. Keywords: pubsub, subscriber, handler, outbox, inbox, reliable, guaranteed delivery, callback, async.
---

# PubSub Subscriber Development

## Purpose

Guidance for creating subscribers using PubSub Module with SubscriberHandler pattern. This provides reliable, idempotent event processing with automatic retry and follow-up event support.

## When to Use

- Creating subscribers that need reliable processing (no duplicate execution)
- Event-driven workflows with retry capability
- Chaining multiple events together
- Keywords: "pubsub", "outbox", "inbox", "subscriber handler", "reliable event"

## Module Import

```typescript
import { PUB_SUB_MODULE } from '../modules/pub-sub';
import { SubscriberHandler } from '../modules/pub-sub/subscribers/subscriber-handler';
import { SubscriberOutboxEvent, CreateOutboxDto } from '../modules/pub-sub/types';
```

## Basic SubscriberHandler

```typescript
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';
import { SubscriberHandler } from '../../modules/pub-sub/subscribers/subscriber-handler';
import { SubscriberOutboxEvent } from '../../modules/pub-sub/types';

// Define event payload type
export type MyEventPayload = {
  order_id: string;
  customer_id: string;
};

// Create handler class extending SubscriberHandler
export class MyEventHandler extends SubscriberHandler<MyEventPayload> {
  protected async handle(
    event: SubscriberArgs<SubscriberOutboxEvent<MyEventPayload>>,
    _context: Map<string, any>
  ): Promise<void> {
    const { order_id, customer_id } = event.event.data.payload;
    const logger = event.container.resolve('logger');

    logger.info(`[MyEvent] Processing order: ${order_id}`);

    // Your business logic here
    const myService = event.container.resolve('myService');
    await myService.process(order_id);
  }
}

// Create singleton instance
const myEventHandler = new MyEventHandler();

// Subscriber config
export const config: SubscriberConfig = {
  event: 'my-module.event.name',
};

// Default export - the subscriber function
export default async function myEventSubscriber(
  subscriber: SubscriberArgs<SubscriberOutboxEvent<MyEventPayload>>
): Promise<void> {
  await myEventHandler.execute(subscriber);
}
```

## Publishing Events

### From Subscriber/Service

```typescript
import { PUB_SUB_MODULE } from '../../modules/pub-sub';

const pubSubModuleService = container.resolve(PUB_SUB_MODULE);

await pubSubModuleService.save({
  name: 'my-module.event.name',       // Event identifier
  transaction: orderId,                // Groups related events
  payload: {
    order_id: orderId,
    customer_id: customerId,
  },
  options: {
    attempts: 3,                       // Max retry attempts
    backoff: {
      type: 'fixed',
      delay: 60000,                    // 1 minute between retries
    },
  },
});
```

### From Workflow Step

```typescript
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { PUB_SUB_MODULE } from '../../modules/pub-sub';

export const publishEventStep = createStep(
  'publish-my-event',
  async (input: { orderId: string }, { container }) => {
    const pubSubModuleService = container.resolve(PUB_SUB_MODULE);

    await pubSubModuleService.save({
      name: 'my-module.event.name',
      transaction: input.orderId,
      payload: { order_id: input.orderId },
      options: {
        attempts: 3,
        backoff: { type: 'fixed', delay: 60000 },
      },
    });

    return new StepResponse({ published: true });
  }
);
```

## Handler with Follow-Up Events

Use `generateFollowUpEvents` to chain events:

```typescript
export class OrderProcessedHandler extends SubscriberHandler<OrderProcessedPayload> {
  protected async handle(
    event: SubscriberArgs<SubscriberOutboxEvent<OrderProcessedPayload>>,
    context: Map<string, any>
  ): Promise<void> {
    const { order_id } = event.event.data.payload;
    const orderService = event.container.resolve('orderService');

    // Process order
    const order = await orderService.retrieve(order_id);

    // Store data in context for follow-up events
    context.set('order', order);
    context.set('shouldNotify', order.status === 'completed');
  }

  protected async generateFollowUpEvents(
    event: SubscriberArgs<SubscriberOutboxEvent<OrderProcessedPayload>>,
    context: Map<string, any>
  ): Promise<CreateOutboxDto[]> {
    const events: CreateOutboxDto[] = [];
    const order = context.get('order');
    const shouldNotify = context.get('shouldNotify');

    if (shouldNotify) {
      events.push({
        name: 'notification.order.completed',
        transaction: order.id,
        payload: {
          order_id: order.id,
          customer_email: order.customer.email,
        },
        options: {
          attempts: 3,
          backoff: { type: 'fixed', delay: 30000 },
        },
      });
    }

    // Always create audit event
    events.push({
      name: 'audit.order.processed',
      transaction: order.id,
      payload: { order_id: order.id, processed_at: new Date().toISOString() },
      options: { attempts: 1 },
    });

    return events;
  }
}
```

## Handler with Dynamic Follow-Up Events

Store follow-up events in context during `handle()`:

```typescript
export class DocumentCreationHandler extends SubscriberHandler<DocumentPayload> {
  protected async handle(
    event: SubscriberArgs<SubscriberOutboxEvent<DocumentPayload>>,
    context: Map<string, any>
  ): Promise<void> {
    const { order_id, document_types } = event.event.data.payload;
    const followUpEvents: CreateOutboxDto[] = [];

    // Create documents and determine follow-up events dynamically
    for (const docType of document_types) {
      const document = await createDocument(docType, order_id);

      if (docType === 'invoice') {
        followUpEvents.push({
          name: 'email.send.invoice',
          transaction: order_id,
          payload: { document_id: document.id },
          options: { attempts: 3, backoff: { type: 'fixed', delay: 60000 } },
        });
      }
    }

    // Store for generateFollowUpEvents
    context.set('followUpEvents', followUpEvents);
  }

  protected async generateFollowUpEvents(
    _event: SubscriberArgs<SubscriberOutboxEvent<DocumentPayload>>,
    context: Map<string, any>
  ): Promise<CreateOutboxDto[]> {
    return context.get('followUpEvents') || [];
  }
}
```

## Event Naming Convention

Follow this pattern for event names:

```typescript
// Module events
'smart-device.order.created'
'smart-device.order.paid'
'smart-device.vin.assigned'

// Workflow events
'workflow.order.process-payment'
'workflow.order.create-documents'

// Integration events
'sap.order.sync'
'ulustrans.fulfillment.create'

// Notification events
'notification.email.send'
'notification.sms.send'
```

## Backoff Options

```typescript
// Fixed delay between retries
options: {
  attempts: 3,
  backoff: {
    type: 'fixed',
    delay: 60000,  // 1 minute
  },
}

// Common delay patterns
delay: 10000,      // 10 seconds
delay: 30000,      // 30 seconds
delay: 60000,      // 1 minute
delay: 300000,     // 5 minutes
delay: 10000 * 6,  // 1 minute (alternative)
```

## Accessing Event Data

```typescript
protected async handle(
  event: SubscriberArgs<SubscriberOutboxEvent<MyPayload>>,
  context: Map<string, any>
): Promise<void> {
  // Access payload data
  const { order_id, customer_id } = event.event.data.payload;

  // Access outbox metadata
  const outboxId = event.event.data.outbox.id;
  const transactionId = event.event.data.outbox.transaction;
  const attemptNumber = event.event.data.outbox.attempts;

  // Resolve services
  const logger = event.container.resolve('logger');
  const pubSubService = event.container.resolve(PUB_SUB_MODULE);
  const myService = event.container.resolve('myModuleService');
}
```

## Error Handling

Errors are automatically caught and tracked:

```typescript
export class MyHandler extends SubscriberHandler<MyPayload> {
  protected async handle(
    event: SubscriberArgs<SubscriberOutboxEvent<MyPayload>>,
    context: Map<string, any>
  ): Promise<void> {
    // If this throws, the error is:
    // 1. Logged to inbox.exception and inbox.stack
    // 2. inbox.attempts incremented
    // 3. If attempts < max, event retried after backoff delay
    // 4. If attempts >= max, inbox.retry set to COMPLETED

    const result = await riskyOperation();

    if (!result.success) {
      // Throw to trigger retry
      throw new Error(`Operation failed: ${result.error}`);
    }
  }
}
```

## Complete Example

```typescript
// src/subscribers/smart-device/order/order-payment-verified.ts
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';
import { SubscriberHandler } from '../../../modules/pub-sub/subscribers/subscriber-handler';
import { SubscriberOutboxEvent, CreateOutboxDto } from '../../../modules/pub-sub/types';
import { PUB_SUB_MODULE } from '../../../modules/pub-sub';
import { SmartDeviceOrderEvents } from '../../../constants/events';

export type OrderPaymentVerifiedPayload = {
  order_id: string;
  payment_id: string;
  amount: number;
};

export class OrderPaymentVerifiedHandler extends SubscriberHandler<OrderPaymentVerifiedPayload> {
  protected async handle(
    event: SubscriberArgs<SubscriberOutboxEvent<OrderPaymentVerifiedPayload>>,
    context: Map<string, any>
  ): Promise<void> {
    const { order_id, payment_id, amount } = event.event.data.payload;
    const logger = event.container.resolve('logger');
    const orderService = event.container.resolve('smartDeviceOrderService');

    logger.info(`[OrderPaymentVerified] Processing order: ${order_id}, payment: ${payment_id}`);

    // Update order status
    const order = await orderService.updateStatus(order_id, 'payment_verified');

    // Store for follow-up events
    context.set('order', order);
    context.set('amount', amount);
  }

  protected async generateFollowUpEvents(
    event: SubscriberArgs<SubscriberOutboxEvent<OrderPaymentVerifiedPayload>>,
    context: Map<string, any>
  ): Promise<CreateOutboxDto[]> {
    const order = context.get('order');
    const amount = context.get('amount');

    return [
      {
        name: SmartDeviceOrderEvents.CREATE_SAP_ORDER,
        transaction: order.id,
        payload: {
          order_id: order.id,
          amount,
        },
        options: {
          attempts: 3,
          backoff: { type: 'fixed', delay: 60000 },
        },
      },
      {
        name: 'notification.payment.confirmed',
        transaction: order.id,
        payload: {
          order_id: order.id,
          customer_email: order.customer.email,
        },
        options: {
          attempts: 3,
          backoff: { type: 'fixed', delay: 30000 },
        },
      },
    ];
  }
}

const orderPaymentVerifiedHandler = new OrderPaymentVerifiedHandler();

export const config: SubscriberConfig = {
  event: SmartDeviceOrderEvents.PAYMENT_VERIFIED,
};

export default async function orderPaymentVerifiedSubscriber(
  subscriber: SubscriberArgs<SubscriberOutboxEvent<OrderPaymentVerifiedPayload>>
): Promise<void> {
  await orderPaymentVerifiedHandler.execute(subscriber);
}
```

## File Structure

```
src/subscribers/
├── smart-device/
│   └── order/
│       ├── order-paid.ts
│       ├── order-payment-verified.ts
│       ├── order-create-sap-order.ts
│       ├── order-vin-assigned.ts
│       └── documents/
│           └── order-create-documents.ts
├── stock-sync-handler.ts
└── notification/
    └── send-email.ts
```

## Best Practices

### ✅ DO

- Always extend `SubscriberHandler` for reliable processing
- Use descriptive event names following the naming convention
- Store shared data in context Map for use in `generateFollowUpEvents`
- Set appropriate retry attempts (3 is common)
- Use transaction ID to group related events
- Log meaningful information with event context

### ❌ DON'T

- Don't use standard MedusaJS subscribers for critical business events
- Don't catch and swallow errors (let them propagate for retry)
- Don't hardcode delay values without consideration
- Don't create circular event chains
- Don't put too much logic in `generateFollowUpEvents`

## Critical Rules

- SubscriberHandler provides idempotency via distributed locking
- Inbox pattern prevents duplicate processing
- Errors are tracked in inbox table with full stack trace
- Follow-up events are only published after successful handling
- Transaction ID groups all related events for tracing

## vs Standard MedusaJS Subscriber

| Feature | Standard Subscriber | PubSub SubscriberHandler |
|---------|---------------------|--------------------------|
| Idempotency | Manual | Automatic (inbox) |
| Retry | No | Yes (configurable) |
| Duplicate Prevention | No | Yes (unique inbox) |
| Error Tracking | Basic logging | Full inbox tracking |
| Event Chaining | Manual | Built-in |
| Distributed Lock | No | Yes |

---

**Remember:** Always follow CLAUDE.md guidelines:
- Run `yarn tsc --noEmit` and `yarn lint --fix` after changes
- Use PubSub SubscriberHandler for critical business events
- Use standard MedusaJS subscribers only for non-critical events