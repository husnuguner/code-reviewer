# StepResponse Types - Common Patterns

## Understanding StepResponse Parameters

`StepResponse` takes two parameters:
1. **First parameter (required)**: The result data to return to the workflow
2. **Second parameter (optional)**: Compensation data passed to rollback function

```typescript
new StepResponse(resultData, compensationData)
```

## Pattern 1: Simple Response (No Compensation)

Use for read operations or steps that don't need rollback.

```typescript
export const readDataStep = createStep(
  'read-data-step',
  async (input: { id: string }, { container }) => {
    const service = container.resolve('myService');
    const data = await service.findById(input.id);

    // Only return data, no compensation needed for read operations
    return new StepResponse(data);
  }
);
```

## Pattern 2: Single Entity Response with ID for Compensation

Most common pattern for create operations.

```typescript
export const createOrderStep = createStep(
  'create-order-step',
  async (input: { customerId: string }, { container }): Promise<StepResponse<Order, string>> => {
    const orderService = container.resolve('orderService');
    const order: Order = await orderService.create({ customer_id: input.customerId });

    // Return order, pass order.id for compensation
    return new StepResponse(order, order.id);
  },
  async (orderId: string, { container }) => {
    const orderService = container.resolve('orderService');
    await orderService.delete(orderId);
  }
);
```

## Pattern 3: Complex Object for Compensation

Use when you need multiple pieces of data for rollback.

```typescript
export type ReservationCompensation = {
  reservationId: string;
  variantId: string;
  quantity: number;
};

export const reserveStockStep = createStep(
  'reserve-stock-step',
  async (
    input: { variantId: string; quantity: number },
    { container }
  ): Promise<StepResponse<Reservation, ReservationCompensation>> => {
    const stockService = container.resolve('stockService');

    const reservation: Reservation = await stockService.reserve({
      variant_id: input.variantId,
      quantity: input.quantity,
    });

    // Pass entire object with all data needed for compensation
    return new StepResponse(reservation, {
      reservationId: reservation.id,
      variantId: input.variantId,
      quantity: input.quantity,
    });
  },
  async (compensationData: ReservationCompensation, { container }) => {
    const stockService = container.resolve('stockService');

    await stockService.release({
      reservation_id: compensationData.reservationId,
      variant_id: compensationData.variantId,
      quantity: compensationData.quantity,
    });
  }
);
```

## Pattern 4: Multiple IDs for Compensation

Use when creating multiple related entities.

```typescript
export type OrderWithItemsCompensation = {
  orderId: string;
  itemIds: string[];
};

export const createOrderWithItemsStep = createStep(
  'create-order-with-items-step',
  async (
    input: { items: Array<{ productId: string; quantity: number }> },
    { container }
  ): Promise<StepResponse<Order, OrderWithItemsCompensation>> => {
    const orderService = container.resolve('orderService');

    const order: Order = await orderService.create(input.items);
    const itemIds = order.items.map(item => item.id);

    // Return order, pass both order ID and item IDs for cleanup
    return new StepResponse(order, {
      orderId: order.id,
      itemIds: itemIds,
    });
  },
  async (compensationData: OrderWithItemsCompensation, { container }) => {
    const orderService = container.resolve('orderService');

    // Delete items first, then order
    for (const itemId of compensationData.itemIds) {
      await orderService.deleteItem(itemId);
    }
    await orderService.delete(compensationData.orderId);
  }
);
```

## Pattern 5: Conditional Compensation Data

Use when compensation is only needed in certain cases.

```typescript
export const sendNotificationStep = createStep(
  'send-notification-step',
  async (
    input: { email: string; message: string; shouldTrack: boolean },
    { container }
  ): Promise<StepResponse<NotificationResult, string | null>> => {
    const notificationService = container.resolve('notificationService');

    const result: NotificationResult = await notificationService.send({
      email: input.email,
      message: input.message,
    });

    // Only pass tracking ID if tracking is enabled
    const compensationData = input.shouldTrack ? result.trackingId : null;

    return new StepResponse(result, compensationData);
  },
  async (trackingId: string | null, { container }) => {
    if (!trackingId) {
      return; // No compensation needed
    }

    const notificationService = container.resolve('notificationService');
    await notificationService.markAsCancelled(trackingId);
  }
);
```

## Pattern 6: Array Response with Batch Compensation

Use when creating multiple entities that all need rollback.

```typescript
export const createMultipleEntitiesStep = createStep(
  'create-multiple-entities-step',
  async (
    input: { entities: Array<{ name: string }> },
    { container }
  ): Promise<StepResponse<Entity[], string[]>> => {
    const service = container.resolve('myService');

    const createdEntities: Entity[] = [];
    for (const entityData of input.entities) {
      const entity: Entity = await service.create(entityData);
      createdEntities.push(entity);
    }

    // Return array of entities, pass array of IDs for batch deletion
    return new StepResponse(
      createdEntities,
      createdEntities.map(e => e.id)
    );
  },
  async (entityIds: string[], { container }) => {
    const service = container.resolve('myService');

    // Delete all created entities
    for (const id of entityIds) {
      await service.delete(id);
    }
  }
);
```

## Best Practices for StepResponse

### ✅ DO
- Return full entity objects from steps (useful for subsequent steps)
- Pass minimal data needed for compensation (usually just IDs)
- Use typed objects for complex compensation data
- Document what compensation data is used for
- Define explicit types for compensation data

### ❌ DON'T
- Don't pass sensitive data in compensation (it may be logged)
- Don't pass entire entities for compensation (just pass IDs)
- Don't return null/undefined unless intentional
- Don't forget compensation data for state-changing operations

## Type Safety with StepResponse

Always define clear types for step input, output, and compensation:

```typescript
// Define clear types
export type CreateEntityStepInput = {
  name: string;
  code: string;
};

export type CreateEntityStepOutput = {
  id: string;
  name: string;
  code: string;
  created_at: Date;
};

export type CreateEntityStepCompensation = {
  entityId: string;
};

// Use types in step definition
export const createEntityStep = createStep(
  'create-entity-step',
  async (
    input: CreateEntityStepInput,
    { container }
  ): Promise<StepResponse<CreateEntityStepOutput, CreateEntityStepCompensation>> => {
    const service = container.resolve('myService');
    const entity: CreateEntityStepOutput = await service.create(input);

    return new StepResponse(entity, { entityId: entity.id });
  },
  async (
    compensationData: CreateEntityStepCompensation,
    { container }
  ): Promise<void> => {
    const service = container.resolve('myService');
    await service.delete(compensationData.entityId);
  }
);
```
