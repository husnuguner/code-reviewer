import type { Logger } from '@medusajs/framework/types';
import { MedusaService } from '@medusajs/framework/utils';
import {{ENTITY_CLASS}} from './models/{{ENTITY_FILE}}';
import { {{ENTITY_DTO}} } from './types';

type {{SERVICE_OPTIONS}} = {};

type InjectedDependencies = {
  logger: Logger;
};

class {{SERVICE_CLASS}} extends MedusaService<{
  {{ENTITY_CLASS}}: { dto: {{ENTITY_DTO}} };
}>({
  {{ENTITY_CLASS}},
}) {
  private readonly logger_: Logger;
  private readonly options_: {{SERVICE_OPTIONS}};

  constructor(container: InjectedDependencies, options: {{SERVICE_OPTIONS}}) {
    super(...arguments);

    const { logger } = container;

    this.logger_ = logger;
    this.options_ = options;

    this.logger_.info(`[${this.constructor.name}]: initialized`);
  }
}

export default {{SERVICE_CLASS}};
