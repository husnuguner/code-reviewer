---
name: medusajs-module
description: Create MedusaJS 2.x custom modules with services, DML models, and CRUD operations. Use when creating new modules, implementing module services, registering modules in medusa-config, or adding module dependencies. Keywords: module, service, CRUD, MedusaService, createMyEntities, updateMyEntities, deleteMyEntities.
---

# MedusaJS Module Development

## Purpose

Guidance for creating and managing MedusaJS 2.x modules. Modules are self-contained packages that encapsulate business logic, data models, and services.

## When to Use

- Creating a new module in `src/modules/`
- Implementing module services
- Working with module `index.ts` files
- Keywords: "module", "service", "model", "entity"

## Module Structure

```
src/modules/my-module/
├── index.ts                 # Module definition (REQUIRED)
├── service.ts               # Main service (REQUIRED)
├── models/                  # Database entities
│   ├── index.ts            # Export all models
│   └── my-entity.ts
├── types/                   # TypeScript types
│   └── index.ts
└── migrations/             # Auto-generated migrations (DON'T EDIT)
```

## Module Definition (index.ts)

```typescript
import { Module } from '@medusajs/framework/utils';
import MyModuleService from './service';

export const MY_MODULE = 'myModule';

export default Module(MY_MODULE, {
  service: MyModuleService,
});
```

## Service Implementation

### Basic Service (Recommended Start)

```typescript
import type { Logger } from '@medusajs/framework/types';
import { MedusaService } from '@medusajs/framework/utils';
import MyEntity from './models/my-entity';

type InjectedDependencies = {
  logger: Logger;
};

class MyModuleService extends MedusaService({
  MyEntity,
}) {
  private readonly logger_: Logger;

  constructor(container: InjectedDependencies, options?: Record<string, unknown>) {
    super(...arguments);
    this.logger_ = container.logger;
    this.logger_.info(`[${this.constructor.name}]: initialized`);
  }

  // Built-in CRUD methods are automatically available:
  // - createMyEntities(data)
  // - retrieveMyEntity(id)
  // - listMyEntities(filters, config)
  // - updateMyEntities(id, data)
  // - deleteMyEntities(id)
}

export default MyModuleService;
```

### Service with Custom Methods

```typescript
import type { Logger } from '@medusajs/framework/types';
import { MedusaService } from '@medusajs/framework/utils';
import MyEntity from './models/my-entity';

type InjectedDependencies = {
  logger: Logger;
};

class MyModuleService extends MedusaService({
  MyEntity,
}) {
  private readonly logger_: Logger;

  constructor(container: InjectedDependencies, options?: Record<string, unknown>) {
    super(...arguments);
    this.logger_ = container.logger;
  }

  // Custom method example
  async findByExternalId(externalId: string): Promise<typeof MyEntity | null> {
    const [entity] = await this.listMyEntities({
      external_id: externalId,
    });
    return entity || null;
  }

  // Custom business logic
  async processEntity(id: string): Promise<void> {
    const entity = await this.retrieveMyEntity(id);
    // Business logic here
    await this.updateMyEntities(id, { processed: true });
  }
}

export default MyModuleService;
```

### Service with Third-Party Integration

```typescript
import type { Logger, ConfigModule } from '@medusajs/framework/types';

export type ModuleOptions = {
  apiKey: string;
  baseUrl: string;
};

type InjectedDependencies = {
  logger: Logger;
  configModule: ConfigModule;
};

class ExternalIntegrationService {
  private readonly logger_: Logger;
  private readonly options_: ModuleOptions;
  private client_: ExternalClient;

  constructor(container: InjectedDependencies, options: ModuleOptions) {
    this.logger_ = container.logger;
    this.options_ = options;

    // Initialize external client
    this.client_ = new ExternalClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
  }

  async fetchData(): Promise<ExternalData[]> {
    return this.client_.getData();
  }

  async syncData(data: SyncInput): Promise<SyncResult> {
    return this.client_.sync(data);
  }
}

export default ExternalIntegrationService;
```

## Model Definition

```typescript
import { model } from '@medusajs/framework/utils';

const MyEntity = model.define('my_entity', {
  id: model.id({ prefix: 'myent' }).primaryKey(),
  name: model.text(),
  external_id: model.text().nullable(),
  is_active: model.boolean().default(true),
  metadata: model.json().nullable(),
})
.indexes([
  {
    name: 'IDX_my_entity_external_id_unique',
    on: ['external_id'],
    unique: true,
    where: 'deleted_at IS NULL',
  },
]);

export default MyEntity;
```

## Type Definitions

```typescript
// types/index.ts
import { InferTypeOf } from '@medusajs/framework/types';
import MyEntity from '../models/my-entity';

export type MyEntityDto = InferTypeOf<typeof MyEntity>;
export type CreateMyEntityDto = Partial<Omit<MyEntityDto, 'id' | 'created_at' | 'updated_at'>>;
export type UpdateMyEntityDto = Partial<CreateMyEntityDto>;
```

## Register Module in medusa-config.ts

```typescript
import { defineConfig } from '@medusajs/framework/utils';
import { MY_MODULE } from './src/modules/my-module';

export default defineConfig({
  // ...
  modules: [
    {
      resolve: './src/modules/my-module',
      options: {
        // Module options (passed to service constructor)
      },
    },
  ],
});
```

## Built-in CRUD Operations

MedusaService automatically provides these methods (pluralized entity name):

```typescript
// Create single or multiple
await service.createMyEntities({ name: 'Example' });
await service.createMyEntities([{ name: 'One' }, { name: 'Two' }]);

// Retrieve single by ID
await service.retrieveMyEntity('id');
await service.retrieveMyEntity('id', { relations: ['related'] });

// List with filters
await service.listMyEntities({ is_active: true });
await service.listMyEntities(
  { is_active: true },
  { take: 10, skip: 0, order: { created_at: 'DESC' } }
);

// List and count
await service.listAndCountMyEntities({ is_active: true });

// Update single or multiple
await service.updateMyEntities({ id: 'id', name: 'Updated' });
await service.updateMyEntities([{ id: 'id1', name: 'Updated1' }, { id: 'id2', name: 'Updated2' }]);

// Delete
await service.deleteMyEntities('id');
await service.deleteMyEntities(['id1', 'id2']);

// Soft delete (if model supports)
await service.softDeleteMyEntities('id');

// Restore soft deleted
await service.restoreMyEntities('id');
```

## Module Links (Cross-Module Relationships)

To link your module's entities with other modules (e.g., Product, Order):

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

## Critical Rules

### ⚠️ Initial Module Creation

- **Service**: Start with only constructor and built-in CRUD
- **Model**: Start with minimal fields, add as needed
- Wait for user request before adding custom methods/fields

### ✅ DO

- Use `MedusaService` for automatic CRUD operations
- Use `InferTypeOf` to derive types from models
- Add initialization logging in constructor
- Use InjectedDependencies pattern
- Export module constant for registration

### ❌ DON'T

- Don't manually implement CRUD methods (use built-in)
- Don't edit migration files manually
- Don't add service methods without user request
- Don't forget to register module in medusa-config.ts

## References

- [Service Patterns](references/service-patterns.md)
- [Module Registration](references/module-registration.md)
- [Multiple Entities](references/multiple-entities.md)

## Templates

```bash
# Generate complete module
npx tsx .claude/skills/medusajs-module/scripts/generate-module.ts \
  --name my-module \
  --entity my-entity
```

Available templates:
- `module-index.ts.tpl` - Module definition
- `service.ts.tpl` - Service class
- `model.ts.tpl` - Model definition
- `types.ts.tpl` - Type definitions

---

**Remember:** Always follow CLAUDE.md guidelines:
- Run `yarn tsc --noEmit` and `yarn lint --fix` after changes
- DO NOT add fields/methods without user request
- Use built-in CRUD operations