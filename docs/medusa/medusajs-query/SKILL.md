---
name: medusajs-query
description: Query data across MedusaJS 2.x modules using Query graph and refetchEntity, define Module Links for cross-module relationships. Use when fetching data from multiple modules, creating links between entities, or querying with filters and pagination. Keywords: query, link, graph, relation, cross-module, refetchEntity, defineLink, remoteLink, filters, pagination.
---

# MedusaJS Query & Module Links

## Purpose

Guidance for using Query to retrieve data across modules and defining Module Links for cross-module relationships in MedusaJS 2.x.

## When to Use

- Querying data across multiple modules
- Defining relationships between custom and core modules
- Keywords: "query", "link", "graph", "relation", "cross-module", "refetchEntity"

## refetchEntity (Preferred for Single Entity)

`refetchEntity` is a simplified utility for fetching a single entity. **Prefer this over `query.graph` when fetching a single record.**

### Import

```typescript
import { refetchEntity } from '@medusajs/framework';
```

### Fetch by ID

```typescript
// Simple ID lookup
const order = await refetchEntity(
  'order',           // entity name
  orderId,           // string ID
  container,         // from step context
  ['id', 'status', 'customer.*']  // fields
);
```

### Fetch by Filter Object

```typescript
// Filter-based lookup (returns first match)
const smartDeviceOrder = await refetchEntity(
  'smart_device_order',
  { order_id: input.order_id },  // filter object
  container,
  ['*', 'smart_device_vin_assignations.*']
);
```

### Complete Example in Workflow Step

```typescript
import { refetchEntity } from '@medusajs/framework';
import { createStep, StepResponse } from '@medusajs/workflows-sdk';

export const myStep = createStep(
  'my-step-id',
  async (input: { order_id: string }, { container }) => {
    // Fetch order with related data
    const order = await refetchEntity(
      'order',
      input.order_id,
      container,
      ['id', 'status', 'items.*', 'customer.email']
    );

    if (!order) {
      return new StepResponse(null);
    }

    // Use optional chaining for nested properties
    const customerEmail = order?.customer?.email;
    const firstItem = order?.items?.[0];

    return new StepResponse({ order, customerEmail });
  }
);
```

### refetchEntity vs query.graph

| Use Case | Recommended |
|----------|-------------|
| Single entity by ID | `refetchEntity` |
| Single entity by filter | `refetchEntity` |
| Multiple entities | `query.graph` |
| Complex filters ($gte, $in, etc.) | `query.graph` |
| Pagination needed | `query.graph` |

## Query Basics

### Resolve Query

```typescript
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

// In API route
const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

// In workflow step
const query = container.resolve(ContainerRegistrationKeys.QUERY);

// In subscriber
const query = container.resolve(ContainerRegistrationKeys.QUERY);
```

### Basic Query

```typescript
const { data: products } = await query.graph({
  entity: 'product',
  fields: ['id', 'title', 'handle', 'status'],
});
```

## Query with Filters

### Simple Filters

```typescript
const { data: products } = await query.graph({
  entity: 'product',
  fields: ['id', 'title', 'status'],
  filters: {
    status: 'published',
    deleted_at: null,
  },
});
```

### Comparison Operators

```typescript
const { data: products } = await query.graph({
  entity: 'product',
  fields: ['id', 'title', 'created_at'],
  filters: {
    deleted_at: null,
    created_at: { $gte: '2024-01-01' },    // Greater than or equal
    // Other operators:
    // $gt: greater than
    // $lt: less than
    // $lte: less than or equal
    // $ne: not equal
    // $in: in array
    // $nin: not in array
    // $like: pattern match
  },
});
```

### In Array Filter

```typescript
const { data: products } = await query.graph({
  entity: 'product',
  fields: ['id', 'title'],
  filters: {
    id: { $in: ['prod_123', 'prod_456', 'prod_789'] },
    deleted_at: null,
  },
});
```

### Nested Filters (Related Entities)

```typescript
const { data: products } = await query.graph({
  entity: 'product',
  fields: ['id', 'title', 'variants.id', 'variants.sku'],
  filters: {
    deleted_at: null,
    variants: {
      sku: { $like: 'SKU-%' },
    },
  },
});
```

## Query with Relations

### Fetch Related Data

```typescript
const { data: orders } = await query.graph({
  entity: 'order',
  fields: [
    'id',
    'display_id',
    'status',
    'customer.id',
    'customer.email',
    'customer.first_name',
    'items.id',
    'items.title',
    'items.quantity',
    'items.unit_price',
  ],
  filters: {
    deleted_at: null,
  },
});
```

### Deep Relations

```typescript
const { data: products } = await query.graph({
  entity: 'product',
  fields: [
    'id',
    'title',
    'variants.id',
    'variants.sku',
    'variants.prices.amount',
    'variants.prices.currency_code',
    'categories.id',
    'categories.name',
  ],
  filters: {
    status: 'published',
    deleted_at: null,
  },
});
```

## Pagination

```typescript
const { data: products } = await query.graph({
  entity: 'product',
  fields: ['id', 'title'],
  filters: {
    deleted_at: null,
  },
  pagination: {
    skip: 0,      // Offset
    take: 20,     // Limit
    order: {
      created_at: 'DESC',
    },
  },
});
```

## Module Links

Module Links create relationships between data models in different modules.

### Define a Link

```typescript
// src/links/my-entity-product.ts
import { defineLink } from '@medusajs/framework/utils';
import { MY_MODULE } from '../modules/my-module';
import { Modules } from '@medusajs/framework/utils';

export default defineLink(
  {
    linkable: MY_MODULE,
    field: 'my_entity_id',
  },
  {
    linkable: Modules.PRODUCT,
    field: 'product_id',
  }
);
```

### Link with Custom Properties

```typescript
import { defineLink } from '@medusajs/framework/utils';
import { MY_MODULE } from '../modules/my-module';
import { Modules } from '@medusajs/framework/utils';

export default defineLink(
  {
    linkable: MY_MODULE,
    field: 'my_entity_id',
  },
  {
    linkable: Modules.PRODUCT,
    field: 'product_id',
  },
  {
    // Custom link properties
    database: {
      table: 'my_entity_product_link',
      idPrefix: 'meplink',
    },
  }
);
```

### Query Linked Data

After defining a link, you can query across modules:

```typescript
// Query products with linked custom entity data
const { data: products } = await query.graph({
  entity: 'product',
  fields: [
    'id',
    'title',
    'my_entity_link.my_entity.id',
    'my_entity_link.my_entity.name',
    'my_entity_link.my_entity.value',
  ],
  filters: {
    status: 'published',
    deleted_at: null,
  },
});

// Query custom entity with linked product data
const { data: myEntities } = await query.graph({
  entity: 'my_entity',
  fields: [
    'id',
    'name',
    'product_link.product.id',
    'product_link.product.title',
  ],
  filters: {
    deleted_at: null,
  },
});
```

## Creating Links

### In Workflow Step

```typescript
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { MY_MODULE } from '../../modules/my-module';

export const linkEntityToProductStep = createStep(
  'link-entity-to-product',
  async (input: { entityId: string; productId: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK);

    await remoteLink.create({
      [MY_MODULE]: {
        my_entity_id: input.entityId,
      },
      [Modules.PRODUCT]: {
        product_id: input.productId,
      },
    });

    return new StepResponse({ linked: true }, input);
  },
  async (input, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK);

    await remoteLink.dismiss({
      [MY_MODULE]: {
        my_entity_id: input.entityId,
      },
      [Modules.PRODUCT]: {
        product_id: input.productId,
      },
    });
  }
);
```

### Using createLinksWorkflow

```typescript
import { createLinksWorkflow } from '@medusajs/core-flows';
import { Modules } from '@medusajs/framework/utils';
import { MY_MODULE } from '../../modules/my-module';

// In your workflow
createLinksWorkflow.runAsStep({
  input: [
    {
      [MY_MODULE]: {
        my_entity_id: entity.id,
      },
      [Modules.PRODUCT]: {
        product_id: product.id,
      },
    },
  ],
});
```

## Query Custom Module Data

```typescript
// Query your custom module's entity
const { data: myEntities } = await query.graph({
  entity: 'my_entity',  // Uses model.define name
  fields: ['id', 'name', 'value', 'metadata'],
  filters: {
    deleted_at: null,
    is_active: true,
  },
});
```

## Common Entity Names

| Module | Entity Name |
|--------|-------------|
| Product | `product`, `product_variant`, `product_category` |
| Order | `order`, `order_item` |
| Customer | `customer`, `customer_group` |
| Cart | `cart`, `cart_item` |
| Region | `region` |
| Store | `store` |
| Sales Channel | `sales_channel` |
| Custom Module | Use model.define name (e.g., `my_entity`) |

## Complete Example

```typescript
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // Get products with their custom data
  const { data: products } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'title',
      'status',
      'variants.id',
      'variants.sku',
      'variants.prices.amount',
      'smart_device_product_link.smart_device_product.id',
      'smart_device_product_link.smart_device_product.quote',
    ],
    filters: {
      status: 'published',
      deleted_at: null,
    },
    pagination: {
      take: 50,
      order: { created_at: 'DESC' },
    },
  });

  res.json({ products });
};
```

## Best Practices

### ✅ DO

- **Use `refetchEntity` for single entity lookups** (cleaner, less boilerplate)
- Always filter `deleted_at: null` for soft-deleted entities
- Select only needed fields to optimize performance
- Use pagination for large result sets
- Define links for cross-module relationships
- Use `$in` operator for batch lookups
- Use optional chaining (`?.`) for nested property access

### ❌ DON'T

- Don't use `query.graph` when fetching a single entity (use `refetchEntity`)
- Don't fetch all fields when not needed
- Don't skip pagination for potentially large datasets
- Don't create circular links
- Don't query inside loops (use batch queries)
- Don't access array elements without optional chaining (`arr?.[0]?.prop`)

## Critical Rules

- Query is read-only - use services/workflows for mutations
- Links require both modules to be registered
- Entity names match `model.define()` names
- Relations follow link definitions

---

**Remember:** Always follow CLAUDE.md guidelines:
- Run `yarn tsc --noEmit` and `yarn lint --fix` after changes
- Use Query for read operations across modules
- Define Module Links for cross-module relationships