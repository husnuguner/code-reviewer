import { Module } from '@medusajs/framework/utils';
import {{SERVICE_CLASS}} from './service';

export const {{MODULE_CONSTANT}} = '{{MODULE_NAME}}';

export default Module({{MODULE_CONSTANT}}, {
  service: {{SERVICE_CLASS}},
});
