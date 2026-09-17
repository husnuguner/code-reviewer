import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { {{MODULE_CONSTANT}} } from '{{MODULE_PATH}}';
import {{SERVICE_CLASS}} from '{{SERVICE_PATH}}';
import { {{INPUT_TYPE}}, {{OUTPUT_TYPE}} } from '{{TYPES_PATH}}';

export type {{STEP_NAME_PASCAL}}StepInput = {{INPUT_TYPE}};

export type {{STEP_NAME_PASCAL}}StepOutput = {{OUTPUT_TYPE}};

export const {{STEP_NAME}}Step = createStep(
  '{{STEP_NAME}}-step',
  async (input: {{STEP_NAME_PASCAL}}StepInput, { container }): Promise<StepResponse<{{STEP_NAME_PASCAL}}StepOutput>> => {
    const {{SERVICE_VARIABLE}}: {{SERVICE_CLASS}} = container.resolve({{MODULE_CONSTANT}});

    const result: {{STEP_NAME_PASCAL}}StepOutput = await {{SERVICE_VARIABLE}}.{{SERVICE_METHOD}}(input);

    return new StepResponse(result);
  }
);