# MedusaJS Workflow Templates

This directory contains TypeScript templates for generating MedusaJS workflow boilerplate code.

## Available Templates

### 1. workflow.ts.tpl

Single-step workflow template.

**Placeholders:**
- `{{WORKFLOW_NAME}}`: Workflow name in kebab-case (e.g., `create-notification`)
- `{{WORKFLOW_NAME_PASCAL}}`: Workflow name in PascalCase (e.g., `CreateNotification`)
- `{{STEP_NAME}}`: Step name in camelCase (e.g., `createNotification`)
- `{{STEP_NAME_PASCAL}}`: Step name in PascalCase (e.g., `CreateNotification`)
- `{{OUTPUT_TYPE}}`: Output type name (e.g., `NotificationDto`)
- `{{OUTPUT_TYPE_PATH}}`: Import path for output type

**Example Usage:**
```bash
# Replace placeholders manually or use generate_workflow.py script
sed -e 's/{{WORKFLOW_NAME}}/create-notification/g' \
    -e 's/{{WORKFLOW_NAME_PASCAL}}/CreateNotification/g' \
    -e 's/{{STEP_NAME}}/createNotification/g' \
    -e 's/{{STEP_NAME_PASCAL}}/CreateNotification/g' \
    -e 's/{{OUTPUT_TYPE}}/NotificationDto/g' \
    -e "s|{{OUTPUT_TYPE_PATH}}|../../modules/notification/types|g" \
    workflow.ts.tpl > create-notification.ts
```

### 2. step-basic.ts.tpl

Step without compensation (for read operations).

**Placeholders:**
- `{{STEP_NAME}}`: Step name in kebab-case (e.g., `list-notifications`)
- `{{STEP_NAME_PASCAL}}`: Step name in PascalCase (e.g., `ListNotifications`)
- `{{MODULE_CONSTANT}}`: Module constant name (e.g., `NOTIFICATION_MODULE`)
- `{{MODULE_PATH}}`: Import path for module constant
- `{{SERVICE_CLASS}}`: Service class name (e.g., `NotificationModuleService`)
- `{{SERVICE_PATH}}`: Import path for service class
- `{{SERVICE_VARIABLE}}`: Service variable name in camelCase (e.g., `notificationService`)
- `{{SERVICE_METHOD}}`: Service method to call (e.g., `listNotifications`)
- `{{INPUT_TYPE}}`: Input type name
- `{{OUTPUT_TYPE}}`: Output type name
- `{{TYPES_PATH}}`: Import path for types

### 3. step-with-compensation.ts.tpl

Step with compensation (for create/update/delete operations).

**Additional Placeholders:**
- `{{COMPENSATION_PARAM}}`: Parameter name for compensation function (e.g., `notificationId`)
- `{{COMPENSATION_METHOD}}`: Service method for rollback (e.g., `deleteNotifications`)

### 4. workflow-multi-step.ts.tpl

Multi-step workflow template.

**Additional Placeholders:**
- `{{STEP_IMPORTS}}`: Import statements for all steps
- `{{INPUT_FIELDS}}`: Input type fields
- `{{OUTPUT_FIELDS}}`: Output type fields
- `{{STEP_EXECUTION}}`: Step execution code
- `{{FINAL_RESULT}}`: Final result object

## Using the Generator Script

The recommended way to use these templates is through the TypeScript generator script:

```bash
# Generate a single-step workflow with compensation
npx tsx .claude/skills/medusajs-workflow/scripts/generate-workflow.ts \
  --name create-notification \
  --module notification \
  --operation create \
  --with-compensation \
  --output ./src/workflows/notification

# Generate a multi-step workflow
npx tsx .claude/skills/medusajs-workflow/scripts/generate-workflow.ts \
  --name checkout \
  --module order \
  --steps "validate,create-order,reserve-stock,charge-payment" \
  --output ./src/workflows/checkout

# Generate only a step
npx tsx .claude/skills/medusajs-workflow/scripts/generate-workflow.ts \
  --step-only \
  --name validate-inventory \
  --module inventory \
  --operation validate \
  --output ./src/workflows/inventory/steps
```

## Manual Template Usage

If you prefer to use templates manually:

1. Copy the template file
2. Replace all `{{PLACEHOLDER}}` values
3. Adjust imports and types as needed
4. Run `yarn tsc --noEmit` to check for errors
5. Run `yarn lint --fix` to format code

## Naming Conventions

### Workflow Names
- File: `create-notification.ts` (kebab-case)
- Const: `createNotificationWorkflow` (camelCase)
- ID: `create-notification-workflow` (kebab-case with -workflow suffix)

### Step Names
- File: `create-notification-step.ts` (kebab-case with -step suffix)
- Const: `createNotificationStep` (camelCase with Step suffix)
- ID: `create-notification-step` (kebab-case with -step suffix)

### Types
- Input: `CreateNotificationStepInput` (PascalCase with Input suffix)
- Output: `CreateNotificationStepOutput` (PascalCase with Output suffix)
- Workflow Input: `CreateNotificationWorkflowInput`
- Workflow Output: `CreateNotificationWorkflowOutput`

## Example: Creating Notification Workflow Manually

### Step 1: Create workflow file

```bash
cp templates/workflow.ts.tpl src/workflows/notification/create-notification.ts
```

### Step 2: Replace placeholders

```typescript
// Before
export const {{WORKFLOW_NAME}}Workflow = createWorkflow(

// After
export const createNotificationWorkflow = createWorkflow(
```

### Step 3: Create step file

```bash
cp templates/step-with-compensation.ts.tpl src/workflows/notification/steps/create-notification-step.ts
```

### Step 4: Replace placeholders in step

```typescript
// Before
const {{SERVICE_VARIABLE}}: {{SERVICE_CLASS}} = container.resolve({{MODULE_CONSTANT}});

// After
const notificationService: NotificationModuleService = container.resolve(NOTIFICATION_MODULE);
```

### Step 5: Verify

```bash
yarn tsc --noEmit
yarn lint --fix
```

## Tips

1. **Start with the generator script** - It's faster and less error-prone
2. **Check existing workflows** - Use `references/examples-notification-workflow.md` as a reference
3. **Follow type safety** - Always define explicit Input/Output types
4. **Use type annotations** - Annotate result variables: `const result: Type = await ...`
5. **Test your workflows** - Write unit tests for steps and integration tests for workflows

## Common Patterns

### CRUD Workflow Set

Generate all CRUD workflows for a module:

```bash
# Create
npx tsx scripts/generate-workflow.ts --name create-entity --module entity --operation create --with-compensation

# Read (single)
npx tsx scripts/generate-workflow.ts --name get-entity --module entity --operation retrieve

# Read (list)
npx tsx scripts/generate-workflow.ts --name list-entities --module entity --operation list

# Update
npx tsx scripts/generate-workflow.ts --name update-entity --module entity --operation update

# Delete
npx tsx scripts/generate-workflow.ts --name delete-entity --module entity --operation delete --with-compensation
```

### Complex Multi-Step Workflow

```bash
npx tsx scripts/generate-workflow.ts \
  --name complete-checkout \
  --module order \
  --steps "validate-cart,create-order,reserve-inventory,process-payment,send-confirmation" \
  --output ./src/workflows/checkout
```
