# Module Registration

## Basic Registration

```typescript
// medusa-config.ts
import { MY_MODULE } from './src/modules/my-module';

export default defineConfig({
  modules: [
    {
      key: MY_MODULE,
      resolve: './modules/my-module',
      options: {},
    },
  ],
});
```

## With Dependencies

```typescript
import { Modules } from '@medusajs/framework/utils';

{
  key: MY_MODULE,
  resolve: './modules/my-module',
  definition: {
    dependencies: [
      Modules.EVENT_BUS,
      Modules.LOCKING,
    ],
  },
  options: {
    customSetting: 'value',
  },
}
```

## Common Built-in Modules

```typescript
Modules.LOCKING          // Distributed locking
Modules.EVENT_BUS        // Event system
Modules.CACHE            // Cache service
Modules.PRODUCT          // Product module
Modules.CUSTOMER         // Customer module
Modules.ORDER            // Order module
Modules.PAYMENT          // Payment module
```