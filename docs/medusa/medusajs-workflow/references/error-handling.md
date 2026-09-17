# Error Handling in Workflows

## Core Principle: Let Errors Propagate

**CRITICAL:** Steps should NOT catch errors. The workflow engine handles errors and triggers compensation automatically.

```typescript
// ✅ CORRECT: Let errors propagate
export const myStep = createStep(
  'my-step',
  async (input, { container }) => {
    const service = container.resolve('myService');

    // If this throws, workflow engine catches it and runs compensation
    const result = await service.performOperation(input);

    return new StepResponse(result, result.id);
  },
  async (id: string, { container }) => {
    // Compensation runs automatically
    await container.resolve('myService').rollback(id);
  }
);

// ❌ WRONG: Catching and swallowing errors
export const myStep = createStep(
  'my-step',
  async (input, { container }) => {
    try {
      const result = await service.performOperation(input);
      return new StepResponse(result);
    } catch (error) {
      // This prevents compensation from running!
      return new StepResponse(null);
    }
  }
);
```

## When to Use try-catch in Steps

Only use try-catch for:
1. Custom logging before re-throwing
2. Adding context to errors
3. Cleanup that must happen regardless of success/failure

Always **re-throw** the error after handling.

### Pattern 1: Logging Before Re-throw

```typescript
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

export const processPaymentStep = createStep(
  'process-payment-step',
  async (input: PaymentInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    const paymentService = container.resolve('paymentService');

    try {
      logger.info(`Processing payment for order ${input.orderId}`);
      const payment = await paymentService.charge(input);
      logger.info(`Payment successful: ${payment.id}`);

      return new StepResponse(payment, payment.id);
    } catch (error) {
      logger.error(`Payment failed for order ${input.orderId}:`, error);
      throw error; // Re-throw to trigger compensation
    }
  },
  async (paymentId: string, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    logger.info(`Refunding payment ${paymentId}`);
    await container.resolve('paymentService').refund(paymentId);
  }
);
```

### Pattern 2: Adding Context to Errors

```typescript
import { MedusaError } from '@medusajs/framework/utils';

export const validateInventoryStep = createStep(
  'validate-inventory-step',
  async (input: { items: CartItem[] }, { container }) => {
    const inventoryService = container.resolve('inventoryService');

    try {
      const validationResults = await inventoryService.checkAvailability(input.items);
      return new StepResponse(validationResults);
    } catch (error) {
      // Add business context to technical error
      throw new MedusaError(
        MedusaError.Types.INSUFFICIENT_INVENTORY,
        `Failed to validate inventory for ${input.items.length} items: ${error.message}`,
        error
      );
    }
  }
);
```

### Pattern 3: Cleanup Before Re-throw

```typescript
export const processFileStep = createStep(
  'process-file-step',
  async (input: { filePath: string }, { container }) => {
    const fileService = container.resolve('fileService');
    let tempFile = null;

    try {
      // Create temporary file
      tempFile = await fileService.createTemp(input.filePath);

      // Process file
      const result = await fileService.process(tempFile);

      return new StepResponse(result);
    } catch (error) {
      // Clean up temp file before re-throwing
      if (tempFile) {
        await fileService.deleteTempFile(tempFile);
      }
      throw error;
    } finally {
      // Final cleanup
      if (tempFile) {
        await fileService.deleteTempFile(tempFile);
      }
    }
  }
);
```

## Error Handling at Workflow Level

### Pattern 1: Execute with Error Handling

```typescript
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result, errors } = await myWorkflow(req.scope).run({
    input: req.validatedBody,
    throwOnError: false, // Don't throw, return errors instead
  });

  if (errors && errors.length > 0) {
    // Log the error
    req.logger.error('Workflow failed:', errors[0]);

    // Return appropriate error response
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      errors[0].message
    );
  }

  res.json({ result });
};
```

### Pattern 2: Execute with Automatic Error Throwing

```typescript
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  // Throws on error automatically (default behavior)
  const { result } = await myWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  res.json({ result });
};
```

### Pattern 3: Workflow-Level Error Context

```typescript
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { result } = await myWorkflow(req.scope).run({
      input: req.validatedBody,
    });

    res.json({ result });
  } catch (error) {
    req.logger.error('Order creation workflow failed:', {
      customerId: req.validatedBody.customerId,
      error: error.message,
      stack: error.stack,
    });

    // Re-throw with business context
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed to create order for customer ${req.validatedBody.customerId}`,
      error
    );
  }
};
```

## Throwing Errors in Steps

### Using MedusaError Types

```typescript
import { MedusaError } from '@medusajs/framework/utils';

export const validateOrderStep = createStep(
  'validate-order-step',
  async (input: { orderId: string }, { container }) => {
    const orderService = container.resolve('orderService');
    const order = await orderService.findById(input.orderId);

    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Order with ID ${input.orderId} not found`
      );
    }

    if (order.status !== 'pending') {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order ${input.orderId} cannot be processed. Current status: ${order.status}`
      );
    }

    return new StepResponse(order);
  }
);
```

### Common MedusaError Types

```typescript
// Not found errors
MedusaError.Types.NOT_FOUND

// Validation errors
MedusaError.Types.INVALID_DATA

// Permission errors
MedusaError.Types.NOT_ALLOWED

// Business logic errors
MedusaError.Types.UNEXPECTED_STATE

// Insufficient inventory
MedusaError.Types.INSUFFICIENT_INVENTORY

// Payment errors
MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR
```

## Compensation Error Handling

Compensation functions should be fault-tolerant and not throw errors.

```typescript
export const createOrderStep = createStep(
  'create-order-step',
  async (input: CreateOrderInput, { container }) => {
    const orderService = container.resolve('orderService');
    const order = await orderService.create(input);

    return new StepResponse(order, order.id);
  },
  async (orderId: string, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    const orderService = container.resolve('orderService');

    try {
      logger.info(`Rolling back order creation: ${orderId}`);
      await orderService.delete(orderId);
      logger.info(`Successfully rolled back order: ${orderId}`);
    } catch (error) {
      // Log but don't throw - compensation should be fault-tolerant
      logger.error(`Failed to rollback order ${orderId}:`, error);
      // Optionally: send alert, create manual cleanup task, etc.
    }
  }
);
```

## Error Flow Example

```typescript
// Workflow definition
export const checkoutWorkflow = createWorkflow(
  'checkout-workflow',
  (input: WorkflowData<CheckoutInput>) => {
    const order = createOrderStep(input);           // Step 1 ✓
    const reservation = reserveStockStep(order);    // Step 2 ✓
    const payment = chargePaymentStep(order);       // Step 3 ❌ THROWS ERROR

    return new WorkflowResponse(payment);
  }
);

// What happens when Step 3 fails:
// 1. chargePaymentStep throws an error
// 2. Workflow engine catches the error
// 3. Compensation runs in REVERSE order:
//    a. reserveStockStep compensation (release stock)
//    b. createOrderStep compensation (delete order)
// 4. Original error is re-thrown to caller
// 5. API route catches error and returns appropriate response
```

## Best Practices

### ✅ DO

1. **Let Errors Propagate**
   ```typescript
   // NO try-catch needed
   const result = await service.operation();
   return new StepResponse(result);
   ```

2. **Use Specific Error Types**
   ```typescript
   throw new MedusaError(
     MedusaError.Types.NOT_FOUND,
     'Resource not found'
   );
   ```

3. **Log Before Re-throwing**
   ```typescript
   try {
     return await operation();
   } catch (error) {
     logger.error('Operation failed', error);
     throw error; // Re-throw!
   }
   ```

4. **Make Compensation Fault-Tolerant**
   ```typescript
   async (id, { container }) => {
     try {
       await cleanup(id);
     } catch (error) {
       logger.error('Cleanup failed', error);
       // Don't throw
     }
   }
   ```

### ❌ DON'T

1. **Don't Catch and Swallow Errors**
   ```typescript
   // ❌ BAD
   try {
     await operation();
   } catch (error) {
     return new StepResponse(null); // Prevents compensation!
   }
   ```

2. **Don't Throw in Compensation**
   ```typescript
   // ❌ BAD
   async (id, { container }) => {
     await service.delete(id); // Might throw
   }

   // ✅ GOOD
   async (id, { container }) => {
     try {
       await service.delete(id);
     } catch (error) {
       logger.error('Delete failed', error);
     }
   }
   ```

3. **Don't Use Generic Errors**
   ```typescript
   // ❌ BAD
   throw new Error('Something went wrong');

   // ✅ GOOD
   throw new MedusaError(
     MedusaError.Types.UNEXPECTED_STATE,
     'Payment processing failed'
   );
   ```

## Testing Error Scenarios

```typescript
describe('createOrderStep', () => {
  it('should trigger compensation on error', async () => {
    const mockService = {
      create: jest.fn().mockResolvedValue({ id: 'order-123' }),
      delete: jest.fn().mockResolvedValue(true),
    };

    // Test normal execution
    const result = await createOrderStep.invoke(
      { customerId: 'customer-123' },
      { container: { resolve: () => mockService } }
    );

    expect(result[0]).toEqual({ id: 'order-123' });
    expect(result[1]).toEqual('order-123'); // Compensation data

    // Test compensation
    await createOrderStep.compensate(
      result[1],
      { container: { resolve: () => mockService } }
    );

    expect(mockService.delete).toHaveBeenCalledWith('order-123');
  });

  it('should handle errors and re-throw', async () => {
    const mockService = {
      create: jest.fn().mockRejectedValue(new Error('Database error')),
    };

    // Should throw and not catch
    await expect(
      createOrderStep.invoke(
        { customerId: 'customer-123' },
        { container: { resolve: () => mockService } }
      )
    ).rejects.toThrow('Database error');
  });
});
```
