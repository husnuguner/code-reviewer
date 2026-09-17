import { model } from '@medusajs/framework/utils';

const {{ENTITY_CLASS}} = model.define('{{TABLE_NAME}}', {
  id: model.id().primaryKey(),
});

export default {{ENTITY_CLASS}};
