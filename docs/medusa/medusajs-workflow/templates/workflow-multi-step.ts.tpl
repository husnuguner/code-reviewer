import { createWorkflow, WorkflowData, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
{{STEP_IMPORTS}}

export type {{WORKFLOW_NAME_PASCAL}}WorkflowInput = {
  {{INPUT_FIELDS}}
};

export type {{WORKFLOW_NAME_PASCAL}}WorkflowOutput = {
  {{OUTPUT_FIELDS}}
};

// Input: {{WORKFLOW_NAME_PASCAL}}WorkflowInput
// Output: {{WORKFLOW_NAME_PASCAL}}WorkflowOutput
export const {{WORKFLOW_NAME}}Workflow = createWorkflow(
  '{{WORKFLOW_NAME}}-workflow',
  (input: WorkflowData<{{WORKFLOW_NAME_PASCAL}}WorkflowInput>): WorkflowResponse<{{WORKFLOW_NAME_PASCAL}}WorkflowOutput> => {
    {{STEP_EXECUTION}}

    return new WorkflowResponse({{FINAL_RESULT}});
  }
);

export default {{WORKFLOW_NAME}}Workflow;