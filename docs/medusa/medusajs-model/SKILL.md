---
name: medusajs-model
description: Define MedusaJS 2.x data models using Data Model Language (DML) with fields, relationships, indexes, and cascades. Use when creating database models, adding columns/fields, defining relationships (hasOne, hasMany, belongsTo, manyToMany), or setting up indexes. Keywords: model, DML, entity, field, relation, index, cascade, migration.
---

# MedusaJS Data Model Development

## Purpose

Guidance for creating MedusaJS 2.x data models using the Data Model Language (DML) with proper field types, relationships, indexes, and migration safety.

## When to Use

- Creating models in `src/modules/*/models/`
- Adding fields to existing models
- Defining relationships between models
- Keywords: "model", "field", "relationship", "migration", "entity"

## Quick Model Example

```typescript
import { model } from '@medusajs/framework/utils';

const MyEntity = model.define('my_entity', {
  id: model.id({ prefix: 'myent' }).primaryKey(),
  name: model.text(),
  email: model.text().unique(),
  is_active: model.boolean().default(true),
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ['name'],
    where: 'deleted_at IS NULL',
  },
]);

export default MyEntity;
```

## Field Types

### Primary Types

```typescript
model.id({ prefix: 'prefix' })    // UUID with optional prefix
model.text()                       // String/varchar
model.number()                     // Integer
model.bigNumber()                  // BigInt (for large numbers)
model.boolean()                    // Boolean
model.dateTime()                   // Timestamp with timezone
model.json()                       // JSON/JSONB
model.array()                      // Array type
model.enum(MyEnum)                 // Enum from TypeScript enum
```

### Field Modifiers

```typescript
.nullable()                        // Allow null values
.default('value')                  // Set default value
.default('now')                    // Current timestamp (for dateTime)
.unique()                          // Unique constraint
.index()                           // Simple index (use .indexes() for complex)
.primaryKey()                      // Mark as primary key
```

## Relationships

### One-to-Many (Parent has many Children)

```typescript
// Parent model
const Parent = model.define('parent', {
  id: model.id().primaryKey(),
  children: model.hasMany(() => Child, { mappedBy: 'parent' }),
});

// Child model
const Child = model.define('child', {
  id: model.id().primaryKey(),
  parent: model.belongsTo(() => Parent, { mappedBy: 'children' }),
});
```

### Many-to-Many

```typescript
const Product = model.define('product', {
  id: model.id().primaryKey(),
  tags: model.manyToMany(() => Tag, { mappedBy: 'products' }),
});

const Tag = model.define('tag', {
  id: model.id().primaryKey(),
  products: model.manyToMany(() => Product, { mappedBy: 'tags' }),
});
```

### One-to-One

```typescript
const User = model.define('user', {
  id: model.id().primaryKey(),
  profile: model.hasOne(() => Profile, { mappedBy: 'user' }),
});

const Profile = model.define('profile', {
  id: model.id().primaryKey(),
  user: model.belongsTo(() => User, { mappedBy: 'profile' }),
});
```

## Indexes

### Simple Index

```typescript
const MyEntity = model.define('my_entity', {
  id: model.id().primaryKey(),
  name: model.text().index(), // Simple index on single column
});
```

### Complex Indexes

```typescript
const MyEntity = model.define('my_entity', {
  id: model.id().primaryKey(),
  name: model.text(),
  code: model.text(),
})
.indexes([
  // Composite index
  {
    on: ['name', 'code'],
  },
  // Unique index with condition
  {
    name: 'IDX_my_entity_code_unique',
    on: ['code'],
    unique: true,
    where: 'deleted_at IS NULL',
  },
]);
```

## Soft Delete

MedusaJS automatically adds `deleted_at` field for soft delete. Use in index conditions:

```typescript
.indexes([
  {
    on: ['external_id'],
    unique: true,
    where: 'deleted_at IS NULL', // Only enforce unique for non-deleted
  },
]);
```

## Complete Model Example

```typescript
import { model } from '@medusajs/framework/utils';
import { OrderStatus } from './enums';
import Customer from './customer';
import OrderItem from './order-item';

const Order = model.define('order', {
  id: model.id({ prefix: 'order' }).primaryKey(),
  order_number: model.text().unique(),
  status: model.enum(OrderStatus).default(OrderStatus.PENDING),
  total_amount: model.bigNumber(),
  currency_code: model.text(),
  notes: model.text().nullable(),
  metadata: model.json().nullable(),

  // Relationships
  customer: model.belongsTo(() => Customer, { mappedBy: 'orders' }),
  items: model.hasMany(() => OrderItem, { mappedBy: 'order' }),
})
.indexes([
  {
    name: 'IDX_order_customer_status',
    on: ['customer_id', 'status'],
    where: 'deleted_at IS NULL',
  },
  {
    name: 'IDX_order_number_unique',
    on: ['order_number'],
    unique: true,
    where: 'deleted_at IS NULL',
  },
]);

export default Order;
```

## Critical Rules

### ⚠️ Migration Safety

- **NEVER edit migration files manually** - They are auto-generated
- **NEVER run db:generate or db:migrate without user permission**
- Always inform user before running migration commands
- Migrations are generated from model files using `yarn db:generate`

### ✅ DO

- Use `model.define()` for all models
- Add proper indexes for frequently queried fields
- Use `where: 'deleted_at IS NULL'` for unique indexes
- Run `yarn tsc --noEmit` after changes
- Export model as default

### ❌ DON'T

- Don't use `@Entity` decorators (that's MikroORM, not DML)
- Don't manually create migration files
- Don't add fields without user request
- Don't forget to export the model

## References

- [Field Types Reference](references/field-types.md)

## Templates

```bash
# Generate model from template (if script exists)
npx tsx .claude/skills/medusajs-model/scripts/generate-model.ts \
  --name my-entity \
  --table my_entity
```
