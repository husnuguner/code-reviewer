---
name: medusajs-route
description: Create MedusaJS 2.x Admin and Store API routes with Zod validation and middleware configuration. Use when creating API endpoints, implementing request validation, or adding custom routes. Keywords: route, api, endpoint, controller, GET, POST, DELETE, validation, middleware, AuthenticatedMedusaRequest, validatedBody.
---

# MedusaJS API Route Development

## Purpose

Guidance for creating Admin and Store API routes in MedusaJS 2.x.

## When to Use

- Creating routes in `src/api/admin/` or `src/api/store/`
- Keywords: "route", "api", "endpoint", "controller"

## Route Structure

```
src/api/
├── admin/                          # Admin API routes (requires auth)
│   └── my-resource/
│       ├── route.ts               # Collection: GET list, POST create
│       ├── validation-schemas.ts  # Zod schemas and types
│       └── [id]/
│           ├── route.ts           # Item: GET, POST update, DELETE
│           ├── validation-schemas.ts
│           └── action/
│               ├── route.ts       # Custom action: POST
│               └── validation-schemas.ts
├── store/                          # Store API routes (public/customer)
│   └── my-resource/
│       └── route.ts
└── middlewares.ts                  # Central middleware registration
```

## HTTP Methods

| Method | Purpose | Status Code |
|--------|---------|-------------|
| `GET` | Retrieve data | 200 |
| `POST` | Create or Action | 201 (create) / 200 (action) |
| `DELETE` | Delete resource | 200 or 204 |

**⚠️ NO PUT method** - Use POST for updates

## Standard Route Pattern

### 1. validation-schemas.ts

```typescript
import { z } from 'zod';

export const createMyEntityRequestSchema = z.object({
  name: z.string().min(1),
  value: z.number().positive(),
  is_active: z.boolean().optional().default(true),
});

export type CreateMyEntityRequestBody = z.infer<typeof createMyEntityRequestSchema>;
```

### 2. route.ts (with typed body)

```typescript
import { MedusaResponse } from '@medusajs/framework';
import { AuthenticatedMedusaRequest } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { CreateMyEntityRequestBody } from './validation-schemas';

export const POST = async (
  req: AuthenticatedMedusaRequest<CreateMyEntityRequestBody>,
  res: MedusaResponse
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const myService = req.scope.resolve('myModuleService');

  logger.info(`Creating entity: ${req.validatedBody.name}`);

  const [entity] = await myService.createMyEntities(req.validatedBody);

  res.status(201).json({ entity });
};
```

### 3. middlewares.ts (register validation)

```typescript
// src/api/admin/my-resource/middlewares.ts
import { validateAndTransformBody } from '@medusajs/framework';
import { CustomRouteConfig } from '../../utils/types';
import { createMyEntityRequestSchema } from './validation-schemas';

export const myResourceMiddlewares: CustomRouteConfig[] = [
  {
    method: 'POST',
    matcher: '/admin/my-resource',
    middlewares: [validateAndTransformBody(createMyEntityRequestSchema)],
  },
];
```

Then import in `src/api/middlewares.ts`:

```typescript
import { myResourceMiddlewares } from './admin/my-resource/middlewares';

export default defineMiddlewares({
  routes: [
    ...myResourceMiddlewares,
    // other middlewares...
  ],
});
```

## Route Examples

### Collection Route (List & Create)

```typescript
import { MedusaResponse } from '@medusajs/framework';
import { AuthenticatedMedusaRequest } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

// GET /admin/my-resource
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: items } = await query.graph({
    entity: 'my_entity',
    fields: ['id', 'name', 'created_at'],
    filters: {
      deleted_at: null,
    },
  });

  res.json({ items });
};
```

### Item Route (Get, Update, Delete)

```typescript
import { MedusaResponse } from '@medusajs/framework';
import { AuthenticatedMedusaRequest } from '@medusajs/framework/http';
import { UpdateMyEntityRequestBody } from './validation-schemas';

// GET /admin/my-resource/:id
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const myService = req.scope.resolve('myModuleService');

  const entity = await myService.retrieveMyEntity(req.params.id);

  res.json({ entity });
};

// POST /admin/my-resource/:id (Update - NOT PUT!)
export const POST = async (
  req: AuthenticatedMedusaRequest<UpdateMyEntityRequestBody>,
  res: MedusaResponse
) => {
  const myService = req.scope.resolve('myModuleService');

  const entity = await myService.updateMyEntities({
    id: req.params.id,
    ...req.validatedBody,
  });

  res.json({ entity });
};

// DELETE /admin/my-resource/:id
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const myService = req.scope.resolve('myModuleService');

  await myService.deleteMyEntities(req.params.id);

  res.status(200).json({ success: true });
};
```

### Route with Workflow

```typescript
import { MedusaResponse } from '@medusajs/framework';
import { AuthenticatedMedusaRequest } from '@medusajs/framework/http';
import { myWorkflow } from '../../../workflows/my-workflow';
import { MyWorkflowRequestBody } from './validation-schemas';

export const POST = async (
  req: AuthenticatedMedusaRequest<MyWorkflowRequestBody>,
  res: MedusaResponse
) => {
  const { result } = await myWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  res.status(201).json({ result });
};
```

## Query with Filters

```typescript
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: items } = await query.graph({
    entity: 'my_entity',
    fields: ['id', 'name', 'status', 'related.id', 'related.name'],
    filters: {
      deleted_at: null,
      status: 'active',
      related: {
        type: 'specific_type',
      },
    },
    pagination: {
      skip: 0,
      take: 20,
    },
  });

  res.json({ items });
};
```

## Code Style Guidelines

### Don't Use Try-Catch

Global exception handler exists - errors are automatically caught:

```typescript
// ✅ Good - let errors propagate
export const POST = async (
  req: AuthenticatedMedusaRequest<CreateRequestBody>,
  res: MedusaResponse
) => {
  const result = await myService.create(req.validatedBody);
  res.json({ result });
};

// ❌ Bad - unnecessary try-catch
export const POST = async (
  req: AuthenticatedMedusaRequest<CreateRequestBody>,
  res: MedusaResponse
) => {
  try {
    const result = await myService.create(req.validatedBody);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

### Don't Destructure When Not Needed

```typescript
// ✅ Good - direct access
logger.info(`Processing order ${req.params.id}, type: ${req.validatedBody.payment_type}`);

// ❌ Bad - unnecessary destructuring
const { payment_type } = req.validatedBody;
const { id } = req.params;
logger.info(`Processing order ${id}, type: ${payment_type}`);
```

### Don't Use Defensive Null Checks

When data is guaranteed to exist, don't add unnecessary checks:

```typescript
// ✅ Good - data is guaranteed from query
const productVariantId = variant.product_variant.id;

// ❌ Bad - unnecessary defensive code
const productVariantId = variant.product_variant?.id;
if (!productVariantId) return;
```

### Return Simple Responses

```typescript
// ✅ Good - minimal response
res.json({ success: true });
res.json({ success: true, count: items.length });

// ❌ Bad - too much detail
res.json({
  success: true,
  processed: items.length,
  results: items.map(i => ({ id: i.id, status: 'ok' })),
  timestamp: new Date(),
});
```

## Complete Example

### validation-schemas.ts

```typescript
import { z } from 'zod';

export const paymentSuccessRequestSchema = z.object({
  payment_type: z.string(),
});

export type PaymentSuccessRequestBody = z.infer<typeof paymentSuccessRequestSchema>;
```

### route.ts

```typescript
import { MedusaResponse } from '@medusajs/framework';
import { AuthenticatedMedusaRequest } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PUB_SUB_MODULE } from 'src/modules/pub-sub';
import { PubSubModuleService } from 'src/modules/pub-sub/pub-sub-module-service';
import { Status, StatusNameEnum } from '../../types';
import { PaymentSuccessRequestBody } from './validation-schemas';

export const POST = async (
  req: AuthenticatedMedusaRequest<PaymentSuccessRequestBody>,
  res: MedusaResponse
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  logger.info(
    `[PaymentSuccess] Processing for order ${req.params.id}, type: ${req.validatedBody.payment_type}`
  );

  await triggerWorkflow(req);

  res.json({
    success: true,
    message: 'Payment success processed',
  });
};

const triggerWorkflow = async (
  req: AuthenticatedMedusaRequest<PaymentSuccessRequestBody>
) => {
  const status = Status.from(StatusNameEnum.DOWNPAYMENT_CHECKOUT_DONE);
  const pubSubModuleService = req.scope.resolve<PubSubModuleService>(PUB_SUB_MODULE);

  await pubSubModuleService.save({
    name: status.event,
    transaction: req.params.id,
    payload: {
      status,
      body: req.validatedBody,
      order: { id: req.params.id },
    },
    options: {
      attempts: 3,
      backoff: { type: 'fixed', delay: 30000 },
    },
  });
};
```

### middlewares.ts entry

```typescript
{
  method: 'POST',
  matcher: '/admin/smart-device/orders/:id/payment-success',
  middlewares: [validateAndTransformBody(paymentSuccessRequestSchema)],
},
```

## Critical Rules

### ✅ DO

- Use `AuthenticatedMedusaRequest<T>` with typed body
- Use `req.validatedBody` for validated request body
- Register validation in middlewares.ts
- Use workflows for complex business logic
- Return proper HTTP status codes
- Use `req.scope.resolve()` to get services
- Keep routes thin - delegate to services/workflows

### ❌ DON'T

- Don't use PUT method (use POST)
- Don't use try-catch (global handler exists)
- Don't destructure when not needed
- Don't add unnecessary null checks
- Don't use `req.body as Type` (use `req.validatedBody`)
- Don't add complex business logic in routes

## File Naming Convention

| File | Purpose |
|------|---------|
| `route.ts` | Route handlers (GET, POST, DELETE) |
| `validation-schemas.ts` | Zod schemas and type exports |
| `middlewares.ts` | Middleware configuration |

---

**Remember:** Always follow CLAUDE.md guidelines:
- Run `yarn tsc --noEmit` and `yarn lint --fix` after changes
- NO PUT method - use POST instead
- Keep routes clean and simple
