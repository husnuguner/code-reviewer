# Multiple Entities in One Module

## Service with Multiple Entities

```typescript
import Entity1 from './models/entity1';
import Entity2 from './models/entity2';
import Entity3 from './models/entity3';
import { Entity1Dto, Entity2Dto, Entity3Dto } from './types';

class MyModuleService extends MedusaService<{
  Entity1: { dto: Entity1Dto };
  Entity2: { dto: Entity2Dto };
  Entity3: { dto: Entity3Dto };
}>({
  Entity1,
  Entity2,
  Entity3,
}) {
  private readonly logger_: Logger;
  private readonly options_: MyModuleServiceOptions;

  constructor(container: InjectedDependencies, options: MyModuleServiceOptions) {
    super(...arguments);
    const { logger } = container;
    this.logger_ = logger;
    this.options_ = options;
    this.logger_.info(`[${this.constructor.name}]: initialized`);
  }
}
```

## CRUD Operations for Each Entity

```typescript
// Entity1 operations
await service.createEntity1s(data);
await service.retrieveEntity1(id);
await service.listEntity1s(filters, config);
await service.updateEntity1s(id, data);
await service.deleteEntity1s(id);

// Entity2 operations
await service.createEntity2s(data);
await service.retrieveEntity2(id);
// ... etc

// Entity3 operations
await service.createEntity3s(data);
await service.retrieveEntity3(id);
// ... etc
```

## Types for Multiple Entities

```typescript
// types/index.ts
import { InferTypeOf } from '@medusajs/framework/types';
import Entity1 from '../models/entity1';
import Entity2 from '../models/entity2';
import Entity3 from '../models/entity3';

export type Entity1Dto = InferTypeOf<typeof Entity1>;
export type CreateEntity1Dto = Partial<Omit<Entity1Dto, 'id'>>;
export type UpdateEntity1Dto = Partial<CreateEntity1Dto>;

export type Entity2Dto = InferTypeOf<typeof Entity2>;
export type CreateEntity2Dto = Partial<Omit<Entity2Dto, 'id'>>;
export type UpdateEntity2Dto = Partial<CreateEntity2Dto>;

export type Entity3Dto = InferTypeOf<typeof Entity3>;
export type CreateEntity3Dto = Partial<Omit<Entity3Dto, 'id'>>;
export type UpdateEntity3Dto = Partial<CreateEntity3Dto>;
```