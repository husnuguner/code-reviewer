# Complete Notification Module Example

This document provides a real-world example of workflows and steps from the TDFS notification module.

## Module Structure

```
src/
├── modules/notification/
│   ├── models/notification.ts
│   ├── service.ts
│   ├── types/index.ts
│   └── index.ts
└── workflows/notification/
    ├── create-notification.ts
    ├── update-notification.ts
    ├── delete-notification.ts
    ├── list-notifications.ts
    ├── mark-notification-as-read.ts
    └── steps/
        ├── create-notification-step.ts
        ├── update-notification-step.ts
        ├── delete-notification-step.ts
        ├── list-notifications-step.ts
        └── mark-notification-as-read-step.ts
```

## Notification Model

```typescript
// src/modules/notification/models/notification.ts
import { model } from '@medusajs/framework/utils';

export const NOTIFICATION_TABLE = 'notification';

const Notification = model.define(NOTIFICATION_TABLE, {
  id: model.id().primaryKey(),
  type: model.text(),
  message: model.text(),
  read: model.boolean().default(false),
  created_at: model.dateTime().default('now'),
  updated_at: model.dateTime().default('now'),
});

export default Notification;
```

## Notification Types

```typescript
// src/modules/notification/types/index.ts
import { InferTypeOf } from '@medusajs/framework/types';
import Notification from '../models/notification';

export type NotificationDto = InferTypeOf<typeof Notification>;

export type CreateNotificationDto = Partial<Omit<NotificationDto, 'id'>>;

export type UpdateNotificationDto = Partial<CreateNotificationDto>;
```

## Notification Service

```typescript
// src/modules/notification/service.ts
import { MedusaService } from '@medusajs/framework/utils';
import { Logger } from '@medusajs/framework/types';
import Notification from './models/notification';
import { NotificationDto } from './types';

type InjectedDependencies = {
  logger: Logger;
};

type NotificationModuleServiceOptions = Record<string, unknown>;

class NotificationModuleService extends MedusaService<{
  Notification: { dto: NotificationDto };
}>({
  Notification,
}) {
  private readonly logger_: Logger;
  private readonly options_: NotificationModuleServiceOptions;

  constructor(container: InjectedDependencies, options: NotificationModuleServiceOptions) {
    super(...arguments);
    const { logger } = container;

    this.logger_ = logger;
    this.options_ = options;

    this.logger_.info(`[${this.constructor.name}]: initialized`);
  }
}

export default NotificationModuleService;
```

## Create Notification Workflow

### Workflow Definition

```typescript
// src/workflows/notification/create-notification.ts
import { createWorkflow, WorkflowData, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { createNotificationStep, CreateNotificationStepInput } from './steps/create-notification-step';
import { NotificationDto } from '../../modules/notification/types';

export type CreateNotificationWorkflowInput = CreateNotificationStepInput;

export type CreateNotificationWorkflowOutput = NotificationDto;

// Input: CreateNotificationWorkflowInput
// Output: CreateNotificationWorkflowOutput
export const createNotificationWorkflow = createWorkflow(
  'create-notification-workflow',
  (input: WorkflowData<CreateNotificationWorkflowInput>): WorkflowResponse<CreateNotificationWorkflowOutput> => {
    const notification = createNotificationStep(input);

    return new WorkflowResponse(notification);
  }
);

export default createNotificationWorkflow;
```

### Step Implementation with Compensation

```typescript
// src/workflows/notification/steps/create-notification-step.ts
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { NOTIFICATION_MODULE } from '../../../modules/notification';
import NotificationModuleService from '../../../modules/notification/service';
import { CreateNotificationDto, NotificationDto } from '../../../modules/notification/types';

export type CreateNotificationStepInput = CreateNotificationDto;

export type CreateNotificationStepOutput = NotificationDto;

export const createNotificationStep = createStep(
  'create-notification-step',
  async (input: CreateNotificationStepInput, { container }): Promise<StepResponse<CreateNotificationStepOutput, string>> => {
    const notificationService: NotificationModuleService = container.resolve(NOTIFICATION_MODULE);

    const notification: NotificationDto = await notificationService.createNotifications(input);

    return new StepResponse(notification, notification.id);
  },
  async (notificationId: string, { container }) => {
    const notificationService: NotificationModuleService = container.resolve(NOTIFICATION_MODULE);

    await notificationService.deleteNotifications(notificationId);
  }
);
```

## Update Notification Workflow

### Workflow Definition

```typescript
// src/workflows/notification/update-notification.ts
import { createWorkflow, WorkflowData, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { updateNotificationStep, UpdateNotificationStepInput } from './steps/update-notification-step';
import { NotificationDto } from '../../modules/notification/types';

export type UpdateNotificationWorkflowInput = UpdateNotificationStepInput;

export type UpdateNotificationWorkflowOutput = NotificationDto;

// Input: UpdateNotificationWorkflowInput
// Output: UpdateNotificationWorkflowOutput
export const updateNotificationWorkflow = createWorkflow(
  'update-notification-workflow',
  (input: WorkflowData<UpdateNotificationWorkflowInput>): WorkflowResponse<UpdateNotificationWorkflowOutput> => {
    const notification = updateNotificationStep(input);

    return new WorkflowResponse(notification);
  }
);

export default updateNotificationWorkflow;
```

### Step Implementation (No Compensation)

```typescript
// src/workflows/notification/steps/update-notification-step.ts
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { NOTIFICATION_MODULE } from '../../../modules/notification';
import NotificationModuleService from '../../../modules/notification/service';
import { NotificationDto, UpdateNotificationDto } from '../../../modules/notification/types';

export type UpdateNotificationStepInput = {
  id: string;
  data: UpdateNotificationDto;
};

export type UpdateNotificationStepOutput = NotificationDto;

export const updateNotificationStep = createStep(
  'update-notification-step',
  async (input: UpdateNotificationStepInput, { container }): Promise<StepResponse<UpdateNotificationStepOutput>> => {
    const notificationService: NotificationModuleService = container.resolve(NOTIFICATION_MODULE);

    const notification: NotificationDto = await notificationService.updateNotifications(input.id, input.data);

    return new StepResponse(notification);
  }
);
```

## Mark as Read Workflow

### Workflow Definition

```typescript
// src/workflows/notification/mark-notification-as-read.ts
import { createWorkflow, WorkflowData, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { markNotificationAsReadStep, MarkNotificationAsReadStepInput } from './steps/mark-notification-as-read-step';
import { NotificationDto } from '../../modules/notification/types';

export type MarkNotificationAsReadWorkflowInput = MarkNotificationAsReadStepInput;

export type MarkNotificationAsReadWorkflowOutput = NotificationDto;

// Input: MarkNotificationAsReadWorkflowInput
// Output: MarkNotificationAsReadWorkflowOutput
export const markNotificationAsReadWorkflow = createWorkflow(
  'mark-notification-as-read-workflow',
  (input: WorkflowData<MarkNotificationAsReadWorkflowInput>): WorkflowResponse<MarkNotificationAsReadWorkflowOutput> => {
    const notification = markNotificationAsReadStep(input);

    return new WorkflowResponse(notification);
  }
);

export default markNotificationAsReadWorkflow;
```

### Step Implementation

```typescript
// src/workflows/notification/steps/mark-notification-as-read-step.ts
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { NOTIFICATION_MODULE } from '../../../modules/notification';
import NotificationModuleService from '../../../modules/notification/service';
import { NotificationDto } from '../../../modules/notification/types';

export type MarkNotificationAsReadStepInput = {
  id: string;
};

export type MarkNotificationAsReadStepOutput = NotificationDto;

export const markNotificationAsReadStep = createStep(
  'mark-notification-as-read-step',
  async (input: MarkNotificationAsReadStepInput, { container }): Promise<StepResponse<MarkNotificationAsReadStepOutput>> => {
    const notificationService: NotificationModuleService = container.resolve(NOTIFICATION_MODULE);

    const notification: NotificationDto = await notificationService.updateNotifications(input.id, { read: true });

    return new StepResponse(notification);
  }
);
```

## List Notifications Workflow

### Workflow Definition

```typescript
// src/workflows/notification/list-notifications.ts
import { createWorkflow, WorkflowData, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { listNotificationsStep, ListNotificationsStepInput } from './steps/list-notifications-step';
import { NotificationDto } from '../../modules/notification/types';

export type ListNotificationsWorkflowInput = ListNotificationsStepInput;

export type ListNotificationsWorkflowOutput = NotificationDto[];

// Input: ListNotificationsWorkflowInput
// Output: ListNotificationsWorkflowOutput
export const listNotificationsWorkflow = createWorkflow(
  'list-notifications-workflow',
  (input: WorkflowData<ListNotificationsWorkflowInput>): WorkflowResponse<ListNotificationsWorkflowOutput> => {
    const notifications = listNotificationsStep(input);

    return new WorkflowResponse(notifications);
  }
);

export default listNotificationsWorkflow;
```

### Step Implementation

```typescript
// src/workflows/notification/steps/list-notifications-step.ts
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { NOTIFICATION_MODULE } from '../../../modules/notification';
import NotificationModuleService from '../../../modules/notification/service';
import { NotificationDto } from '../../../modules/notification/types';

export type ListNotificationsStepInput = {
  filters?: Record<string, any>;
  config?: Record<string, any>;
};

export type ListNotificationsStepOutput = NotificationDto[];

export const listNotificationsStep = createStep(
  'list-notifications-step',
  async (input: ListNotificationsStepInput, { container }): Promise<StepResponse<ListNotificationsStepOutput>> => {
    const notificationService: NotificationModuleService = container.resolve(NOTIFICATION_MODULE);

    const notifications: NotificationDto[] = await notificationService.listNotifications(input.filters, input.config);

    return new StepResponse(notifications);
  }
);
```

## Usage in API Routes

### Create Notification

```typescript
// src/api/admin/notifications/route.ts
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { createNotificationWorkflow } from '../../../workflows/notification/create-notification';

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await createNotificationWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  res.status(201).json({ notification: result });
};
```

### List Notifications

```typescript
// src/api/admin/notifications/route.ts
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listNotificationsWorkflow } from '../../../workflows/notification/list-notifications';

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listNotificationsWorkflow(req.scope).run({
    input: {
      filters: req.filterableFields,
      config: req.remoteQueryConfig,
    },
  });

  res.json({ notifications: result });
};
```

### Mark as Read

```typescript
// src/api/admin/notifications/[id]/read/route.ts
import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { markNotificationAsReadWorkflow } from '../../../../workflows/notification/mark-notification-as-read';

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;

  const { result } = await markNotificationAsReadWorkflow(req.scope).run({
    input: { id },
  });

  res.json({ notification: result });
};
```

## Key Patterns Demonstrated

1. **Explicit Input/Output Types**: Every workflow and step defines clear Input and Output types
2. **Type Annotations**: Result variables use type annotations: `const notification: NotificationDto = ...`
3. **Compensation Logic**: Create operation includes compensation to delete on rollback
4. **No Compensation for Reads**: Read and list operations don't need compensation
5. **Service Resolution**: Steps resolve services using module constants
6. **Workflow Composition**: Each workflow is simple and focused on a single operation
7. **MedusaService CRUD**: Service extends MedusaService for built-in CRUD operations

## Testing Example

```typescript
// src/workflows/notification/__tests__/create-notification.spec.ts
import { createNotificationStep } from '../steps/create-notification-step';

describe('createNotificationStep', () => {
  it('should create notification and provide compensation data', async () => {
    const mockNotificationService = {
      createNotifications: jest.fn().mockResolvedValue({
        id: 'notif-123',
        type: 'info',
        message: 'Test notification',
        read: false,
      }),
      deleteNotifications: jest.fn(),
    };

    const container = {
      resolve: jest.fn().mockReturnValue(mockNotificationService),
    };

    const input = {
      type: 'info',
      message: 'Test notification',
    };

    const [result, compensationData] = await createNotificationStep.invoke(
      input,
      { container }
    );

    expect(result).toEqual({
      id: 'notif-123',
      type: 'info',
      message: 'Test notification',
      read: false,
    });
    expect(compensationData).toBe('notif-123');
  });

  it('should delete notification on compensation', async () => {
    const mockNotificationService = {
      deleteNotifications: jest.fn().mockResolvedValue(true),
    };

    const container = {
      resolve: jest.fn().mockReturnValue(mockNotificationService),
    };

    await createNotificationStep.compensate('notif-123', { container });

    expect(mockNotificationService.deleteNotifications).toHaveBeenCalledWith('notif-123');
  });
});
```
