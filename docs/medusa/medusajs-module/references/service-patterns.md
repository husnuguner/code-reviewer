# Service Patterns

## InjectedDependencies Pattern

### Basic Service with Logger Only

```typescript
type InjectedDependencies = {
  logger: Logger;
};

class MyService extends MedusaService<{ MyEntity: { dto: MyEntityDto } }>({ MyEntity }) {
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

### Service with Custom Dependencies

```typescript
type InjectedDependencies = {
  logger: Logger;
  eventBusService: IEventBusModuleService;
  lockingService: ILockingProvider;
};

class MyService extends MedusaService<{ MyEntity: { dto: MyEntityDto } }>({ MyEntity }) {
  private readonly logger_: Logger;
  private readonly eventBusService_: IEventBusModuleService;
  private readonly lockingService_: ILockingProvider;
  private readonly options_: MyModuleServiceOptions;

  constructor(container: InjectedDependencies, options: MyModuleServiceOptions) {
    super(...arguments);
    const { logger, eventBusService, lockingService } = container;

    this.logger_ = logger;
    this.eventBusService_ = eventBusService;
    this.lockingService_ = lockingService;
    this.options_ = options;

    this.logger_.info(`[${this.constructor.name}]: initialized`);
  }
}
```

## Multiple Entities

```typescript
class MyService extends MedusaService<{
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

## Custom Methods

Only add custom methods when user explicitly requests them:

```typescript
class MyService extends MedusaService<{ MyEntity: { dto: MyEntityDto } }>({ MyEntity }) {
  // ... constructor ...

  async findByCustomCriteria(criteria: CustomCriteria): Promise<MyEntityDto[]> {
    const entities: MyEntityDto[] = await this.listMyEntities(
      { /* filters */ },
      { /* config */ }
    );
    return entities;
  }
}
```