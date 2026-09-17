import { createWorkflow, WorkflowData, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import { {{STEP_NAME}}Step, {{STEP_NAME_PASCAL}}StepInput } from './steps/{{STEP_NAME}}-step';
import { {{OUTPUT_TYPE}} } from '{{OUTPUT_TYPE_PATH}}';

export type {{WORKFLOW_NAME_PASCAL}}WorkflowInput = {{STEP_NAME_PASCAL}}StepInput;

export type {{WORKFLOW_NAME_PASCAL}}WorkflowOutput = {{OUTPUT_TYPE}};

// Input: {{WORKFLOW_NAME_PASCAL}}WorkflowInput
// Output: {{WORKFLOW_NAME_PASCAL}}WorkflowOutput
export const {{WORKFLOW_NAME}}Workflow = createWorkflow(
  '{{WORKFLOW_NAME}}-workflow',
  (input: WorkflowData<{{WORKFLOW_NAME_PASCAL}}WorkflowInput>): WorkflowResponse<{{WORKFLOW_NAME_PASCAL}}WorkflowOutput> => {
    const result = {{STEP_NAME}}Step(input);

    return new WorkflowResponse(result);
  }
);

export default {{WORKFLOW_NAME}}Workflow;