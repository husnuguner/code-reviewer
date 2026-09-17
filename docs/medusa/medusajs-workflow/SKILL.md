---
name: medusajs-workflow
description: Create MedusaJS 2.x workflows and steps for multi-step business processes with compensation/rollback support. Use when orchestrating service calls, implementing transactions with rollback, parallel processing, or complex business logic. Keywords: workflow, step, createWorkflow, createStep, StepResponse, compensation, rollback, when, transform.
---

# MedusaJS Workflow Development

## Purpose

Guidance for creating MedusaJS 2.x workflows and steps. Workflows orchestrate multi-step operations with automatic compensation (rollback) on failures.

## When to Use

- Creating workflows in `src/workflows/`
- Implementing workflow steps
- Keywords: "workflow", "step", "compensation", "transaction"

## When to Use Workflows

**Use Workflows For:**
- Multi-step operations requiring rollback capability
- Cross-service coordination
- Operations that modify multiple entities
- Long-running or async operations

**Use Direct Service Calls For:**
- Simple CRUD operations
- Single-step operations
- Read-only queries

## Workflow Structure

```
src/workflows/my-workflow/
├── index.ts              # Workflow definition & export
├── steps/
│   ├── step1.ts
│   └── step2.ts
└── types.ts              # Shared types (optional)
```

## Basic Workflow

```typescript
import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { validateStep } from './steps/validate-step';
import { createEntityStep } from './steps/create-entity-step';

export type MyWorkflowInput = {
  name: string;
  value: number;
};

export type MyWorkflowOutput = {
  id: string;
  name: string;
};

export const myWorkflow = createWorkflow(
  'my-workflow',
  (input: MyWorkflowInput) => {
    const validated = validateStep(input);
    const result = createEntityStep(validated);

    return new WorkflowResponse(result);
  }
);

export default myWorkflow;
```

## Step Types

### Basic Step (No Compensation)

```typescript
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';

export type ValidateStepInput = {
  name: string;
};

export type ValidateStepOutput = {
  name: string;
  isValid: boolean;
};

export const validateStep = createStep(
  'validate-step',
  async (input: ValidateStepInput, { container }): Promise<StepResponse<ValidateStepOutput>> => {
    const logger = container.resolve('logger');
    logger.info(`Validating: ${input.name}`);

    return new StepResponse({
      name: input.name,
      isValid: true,
    });
  }
);
```

### Step with Compensation (Rollback)

```typescript
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';

export type CreateEntityInput = {
  name: string;
  value: number;
};

export type CreateEntityOutput = {
  id: string;
  name: string;
};

export const createEntityStep = createStep(
  'create-entity-step',
  // Main function
  async (input: CreateEntityInput, { container }): Promise<StepResponse<CreateEntityOutput, string>> => {
    const myService = container.resolve('myModuleService');

    const [entity] = await myService.createMyEntities(input);

    // Return: (result, compensationData)
    return new StepResponse(entity, entity.id);
  },
  // Compensation function (rollback)
  async (entityId: string, { container }) => {
    const myService = container.resolve('myModuleService');
    await myService.deleteMyEntities(entityId);
  }
);
```

## Advanced Patterns

### Parallel Steps

```typescript
import { createWorkflow, WorkflowResponse, parallelize } from '@medusajs/framework/workflows-sdk';

export const parallelWorkflow = createWorkflow(
  'parallel-workflow',
  (input: ParallelInput) => {
    // Run steps in parallel
    const [result1, result2] = parallelize(
      step1(input.data1),
      step2(input.data2)
    );

    return new WorkflowResponse({ result1, result2 });
  }
);
```

### Conditional Steps

```typescript
import { createWorkflow, WorkflowResponse, when } from '@medusajs/framework/workflows-sdk';

export const conditionalWorkflow = createWorkflow(
  'conditional-workflow',
  (input: ConditionalInput) => {
    const validated = validateStep(input);

    // Conditional execution
    const notificationResult = when(validated, (v) => v.sendNotification)
      .then(() => sendNotificationStep(input));

    return new WorkflowResponse({ validated, notificationResult });
  }
);
```

### Data Transformation with transform

```typescript
import { createWorkflow, WorkflowResponse, transform } from '@medusajs/framework/workflows-sdk';

export const transformWorkflow = createWorkflow(
  'transform-workflow',
  (input: TransformInput) => {
    const entity = createEntityStep(input);

    // Transform data between steps
    const transformedData = transform(
      { entity, input },
      (data) => ({
        entityId: data.entity.id,
        entityName: data.entity.name,
        originalValue: data.input.value,
      })
    );

    const result = processStep(transformedData);

    return new WorkflowResponse(result);
  }
);
```

### Using Built-in Medusa Workflows

```typescript
import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { createProductsWorkflow } from '@medusajs/medusa/core-flows';

export const productSyncWorkflow = createWorkflow(
  'product-sync-workflow',
  (input: ProductSyncInput) => {
    // Use built-in workflow as a step
    const products = createProductsWorkflow.runAsStep({
      input: {
        products: input.productsToCreate,
      },
    });

    return new WorkflowResponse(products);
  }
);
```

## Workflow Execution

### From API Route

```typescript
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { myWorkflow } from '../../../workflows/my-workflow';

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await myWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  res.status(201).json({ result });
};
```

### From Subscriber

```typescript
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework';
import { myWorkflow } from '../workflows/my-workflow';

export default async function mySubscriber({ event, container }: SubscriberArgs) {
  await myWorkflow(container).run({
    input: event.data,
  });
}

export const config: SubscriberConfig = {
  event: 'order.placed',
};
```

### From Scheduled Job

```typescript
import { MedusaContainer } from '@medusajs/framework/types';
import { syncWorkflow } from '../workflows/sync-workflow';

export default async function syncJob(container: MedusaContainer) {
  await syncWorkflow(container).run({
    input: { source: 'scheduled' },
  });
}

export const config = {
  name: 'sync-job',
  schedule: '0 0 * * *', // Daily at midnight
};
```

## Compensation (Rollback)

### When to Implement Compensation

Implement compensation for steps that:
- Modify database state (create, update, delete)
- Call external APIs
- Send notifications
- Update critical business entities

Skip compensation for:
- Read-only operations
- Validation steps
- Data transformation

### Compensation Execution Order

Compensations run in **REVERSE ORDER**:

```
Workflow execution:
  Step 1 (create order)     → Success
  Step 2 (reserve stock)    → Success
  Step 3 (charge payment)   → FAILS

Compensation runs:
  2. Release stock (Step 2 compensation)
  1. Delete order (Step 1 compensation)
```

### Compensation Data Pattern

```typescript
export const createOrderStep = createStep(
  'create-order-step',
  async (input, { container }) => {
    const orderService = container.resolve('orderService');
    const order = await orderService.create(input);

    // Pass data needed for rollback
    return new StepResponse(order, {
      orderId: order.id,
      items: order.items.map(i => i.id),
    });
  },
  async (compensationData, { container }) => {
    const orderService = container.resolve('orderService');
    // Use compensation data
    await orderService.delete(compensationData.orderId);
  }
);
```

## Error Handling

### Let Errors Propagate (Recommended)

```typescript
export const myStep = createStep(
  'my-step',
  async (input, { container }) => {
    const service = container.resolve('myService');

    // No try-catch - errors propagate and trigger compensation
    const result = await service.performOperation(input);

    return new StepResponse(result, result.id);
  },
  async (id, { container }) => {
    const service = container.resolve('myService');
    await service.rollback(id);
  }
);
```

### Log Before Re-throwing (When Needed)

```typescript
export const myStep = createStep(
  'my-step',
  async (input, { container }) => {
    const logger = container.resolve('logger');

    try {
      const result = await performOperation(input);
      return new StepResponse(result, result.id);
    } catch (error) {
      logger.error(`[MyStep] Operation failed: ${error.message}`);
      throw error; // Re-throw to trigger compensation
    }
  },
  async (id, { container }) => {
    await cleanup(id);
  }
);
```

## Best Practices

### ✅ DO

- Give workflows and steps descriptive IDs (inline the ID string; export it as a constant only if you need to reuse it elsewhere)
- Define explicit input/output types
- Implement compensation for state-changing operations
- Let errors propagate (don't catch unless logging)
- Keep steps focused (single responsibility)
- Use `transform` for data manipulation between steps

### ❌ DON'T

- Don't put business logic directly in workflow function
- Don't skip compensation for critical operations
- Don't catch and swallow errors
- Don't create overly complex workflows (break them down)
- Don't use workflows for simple CRUD operations

## References

- [StepResponse Types](references/step-response-types.md)
- [Compensation Guide](references/compensation-guide.md)
- [Error Handling](references/error-handling.md)
- [Workflow Examples](references/examples-notification-workflow.md)

## Templates

```bash
npx tsx .claude/skills/medusajs-workflow/scripts/generate-workflow.ts \
  --name my-workflow \
  --module my-module \
  --steps "validate,create,notify"
```

Available templates:
- `workflow.ts.tpl` - Workflow index file
- `step-basic.ts.tpl` - Basic step
- `step-with-compensation.ts.tpl` - Step with rollback

---

**Remember:** Always follow CLAUDE.md guidelines:
- Run `yarn tsc --noEmit` and `yarn lint --fix` after changes
- Write tests for workflows and steps
- Consider compensation for all state-changing steps