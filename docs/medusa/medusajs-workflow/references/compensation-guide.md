# Compensation Guide - Rollback Strategies

## What is Compensation?

Compensation is the rollback mechanism in MedusaJS workflows. When a step fails, the workflow engine automatically executes compensation functions for all previously completed steps in **reverse order**.

## When to Implement Compensation

### ✅ Implement Compensation For:

1. **Database State Changes**
   - Creating entities
   - Updating records
   - Deleting data
   - Modifying relationships

2. **External API Calls**
   - Payment processing
   - Inventory reservations
   - Third-party service calls
   - Email/SMS sending

3. **Critical Business Operations**
   - Order creation
   - Stock allocation
   - Account balance updates
   - Status transitions

4. **Side Effects**
   - File system operations
   - Cache invalidation
   - Event publishing
   - Notification sending

### ❌ Skip Compensation For:

1. **Read-Only Operations**
   - Data queries
   - Fetching records
   - Validation checks
   - Read-only calculations

2. **Idempotent Operations**
   - Operations that can be safely retried
   - Operations with no lasting side effects

## Compensation Execution Order

Compensations execute in **REVERSE ORDER** of step execution:

```typescript
// Workflow execution
export const checkoutWorkflow = createWorkflow(
  'checkout-workflow',
  (input: WorkflowData<CheckoutInput>) => {
    const order = createOrderStep(input);           // Step 1
    const reservation = reserveStockStep(order);    // Step 2
    const payment = chargePaymentStep(order);       // Step 3 ❌ FAILS

    return new WorkflowResponse(payment);
  }
);

// Compensation execution (reverse order)
// 3. No compensation for chargePaymentStep (it failed before completing)
// 2. Release stock reservation (reserveStockStep compensation)
// 1. Delete order (createOrderStep compensation)
```

## Compensation Patterns

### Pattern 1: Simple Delete Compensation

Most common pattern - create something, delete it on rollback.

```typescript
export const createOrderStep = createStep(
  'create-order-step',
  async (input: CreateOrderInput, { container }) => {
    const orderService = container.resolve('orderService');
    const order: Order = await orderService.create(input);

    return new StepResponse(order, order.id);
  },
  // Compensation: delete the created order
  async (orderId: string, { container }) => {
    const orderService = container.resolve('orderService');
    await orderService.delete(orderId);
  }
);
```

### Pattern 2: State Reversal Compensation

Revert state changes back to original state.

```typescript
export const updateOrderStatusStep = createStep(
  'update-order-status-step',
  async (input: { orderId: string; newStatus: string }, { container }) => {
    const orderService = container.resolve('orderService');

    // Get current status before update
    const order: Order = await orderService.findById(input.orderId);
    const previousStatus = order.status;

    // Update to new status
    const updatedOrder: Order = await orderService.updateStatus(
      input.orderId,
      input.newStatus
    );

    // Pass both order ID and previous status for rollback
    return new StepResponse(updatedOrder, {
      orderId: input.orderId,
      previousStatus: previousStatus,
    });
  },
  // Compensation: revert to previous status
  async (compensationData: { orderId: string; previousStatus: string }, { container }) => {
    const orderService = container.resolve('orderService');
    await orderService.updateStatus(
      compensationData.orderId,
      compensationData.previousStatus
    );
  }
);
```

### Pattern 3: Resource Release Compensation

Release reserved resources.

```typescript
export const reserveInventoryStep = createStep(
  'reserve-inventory-step',
  async (input: { items: CartItem[] }, { container }) => {
    const inventoryService = container.resolve('inventoryService');

    const reservations: Reservation[] = [];
    for (const item of input.items) {
      const reservation: Reservation = await inventoryService.reserve({
        sku: item.sku,
        quantity: item.quantity,
      });
      reservations.push(reservation);
    }

    return new StepResponse(reservations, reservations.map(r => r.id));
  },
  // Compensation: release all reservations
  async (reservationIds: string[], { container }) => {
    const inventoryService = container.resolve('inventoryService');

    for (const reservationId of reservationIds) {
      await inventoryService.release(reservationId);
    }
  }
);
```

### Pattern 4: External API Compensation

Cancel or void external operations.

```typescript
export const chargePaymentStep = createStep(
  'charge-payment-step',
  async (input: { orderId: string; amount: number }, { container }) => {
    const paymentService = container.resolve('paymentService');

    const charge: PaymentCharge = await paymentService.charge({
      order_id: input.orderId,
      amount: input.amount,
    });

    return new StepResponse(charge, {
      chargeId: charge.id,
      canRefund: charge.status === 'succeeded',
    });
  },
  // Compensation: refund or void the charge
  async (
    compensationData: { chargeId: string; canRefund: boolean },
    { container }
  ) => {
    const paymentService = container.resolve('paymentService');

    if (compensationData.canRefund) {
      await paymentService.refund(compensationData.chargeId);
    } else {
      await paymentService.void(compensationData.chargeId);
    }
  }
);
```

### Pattern 5: Batch Operation Compensation

Compensate multiple operations in batch.

```typescript
export const createLineItemsStep = createStep(
  'create-line-items-step',
  async (input: { orderId: string; items: ItemInput[] }, { container }) => {
    const lineItemService = container.resolve('lineItemService');

    const createdItems: LineItem[] = [];
    for (const itemInput of input.items) {
      const item: LineItem = await lineItemService.create({
        order_id: input.orderId,
        ...itemInput,
      });
      createdItems.push(item);
    }

    return new StepResponse(createdItems, {
      orderId: input.orderId,
      itemIds: createdItems.map(item => item.id),
    });
  },
  // Compensation: delete all created items
  async (
    compensationData: { orderId: string; itemIds: string[] },
    { container }
  ) => {
    const lineItemService = container.resolve('lineItemService');

    // Delete in reverse order
    for (const itemId of compensationData.itemIds.reverse()) {
      await lineItemService.delete(itemId);
    }
  }
);
```

### Pattern 6: Cascading Compensation

Compensation that triggers cleanup of related entities.

```typescript
export const createOrderWithRelationsStep = createStep(
  'create-order-with-relations-step',
  async (input: CreateOrderInput, { container }) => {
    const orderService = container.resolve('orderService');
    const addressService = container.resolve('addressService');

    // Create shipping address
    const address: Address = await addressService.create(input.shippingAddress);

    // Create order with address
    const order: Order = await orderService.create({
      ...input,
      shipping_address_id: address.id,
    });

    return new StepResponse(order, {
      orderId: order.id,
      addressId: address.id,
    });
  },
  // Compensation: delete order and its relations
  async (
    compensationData: { orderId: string; addressId: string },
    { container }
  ) => {
    const orderService = container.resolve('orderService');
    const addressService = container.resolve('addressService');

    // Delete in correct order (child first, then parent)
    await orderService.delete(compensationData.orderId);
    await addressService.delete(compensationData.addressId);
  }
);
```

## Best Practices

### ✅ DO

1. **Keep Compensation Simple**
   - Focus on reversing the operation
   - Avoid complex logic in compensation

2. **Make Compensation Idempotent**
   - Handle case where entity might not exist
   - Use soft deletes when appropriate

```typescript
async (orderId: string, { container }) => {
  const orderService = container.resolve('orderService');

  // Check if order exists before deleting
  const order = await orderService.findById(orderId);
  if (order) {
    await orderService.delete(orderId);
  }
}
```

3. **Log Compensation Actions**
   - Record what's being rolled back
   - Aid debugging and auditing

```typescript
async (orderId: string, { container }) => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const orderService = container.resolve('orderService');

  logger.info(`Rolling back order creation: ${orderId}`);
  await orderService.delete(orderId);
}
```

4. **Pass Minimal Compensation Data**
   - Usually just IDs
   - Avoid passing entire entities

### ❌ DON'T

1. **Don't Throw Errors in Compensation**
   - Compensation should be fault-tolerant
   - Handle errors gracefully

```typescript
// ❌ BAD
async (orderId: string, { container }) => {
  const orderService = container.resolve('orderService');
  await orderService.delete(orderId); // Throws if not found
}

// ✅ GOOD
async (orderId: string, { container }) => {
  const orderService = container.resolve('orderService');
  try {
    await orderService.delete(orderId);
  } catch (error) {
    // Log but don't throw
    logger.warn(`Failed to delete order ${orderId}: ${error.message}`);
  }
}
```

2. **Don't Make External Calls Without Checks**
   - Verify state before calling APIs
   - Use idempotency keys

3. **Don't Skip Compensation for Critical Operations**
   - Always implement for state changes
   - Document why if skipped

## Testing Compensation

Always test that compensation works correctly:

```typescript
describe('createOrderStep', () => {
  it('should rollback order creation on failure', async () => {
    const mockOrderService = {
      create: jest.fn().mockResolvedValue({ id: 'order-123' }),
      delete: jest.fn().mockResolvedValue(true),
    };

    const container = {
      resolve: jest.fn().mockReturnValue(mockOrderService),
    };

    // Execute step
    const result = await createOrderStep.invoke(
      { customerId: 'customer-123' },
      { container }
    );

    // Execute compensation
    await createOrderStep.compensate(result[1], { container });

    // Verify deletion was called
    expect(mockOrderService.delete).toHaveBeenCalledWith('order-123');
  });
});
```

## Compensation and Transactions

Compensation is NOT a replacement for database transactions:

- **Use Transactions**: For operations within a single service
- **Use Compensation**: For distributed operations across services

```typescript
// ✅ GOOD: Use transaction for tightly coupled operations
export const updateOrderAndItemsStep = createStep(
  'update-order-and-items-step',
  async (input: UpdateInput, { container }) => {
    const orderService = container.resolve('orderService');

    // Single transaction handles both operations
    const result = await orderService.transaction(async (manager) => {
      const order = await manager.updateOrder(input.orderId, input.orderData);
      const items = await manager.updateItems(input.orderId, input.items);
      return { order, items };
    });

    return new StepResponse(result);
  }
);

// ✅ GOOD: Use compensation for distributed operations
export const placeOrderWorkflow = createWorkflow(
  'place-order-workflow',
  (input) => {
    const order = createOrderStep(input);              // Order Service
    const reservation = reserveInventoryStep(order);   // Inventory Service
    const charge = processPaymentStep(order);          // Payment Service

    return new WorkflowResponse({ order, reservation, charge });
  }
);
```
