import { InferTypeOf } from '@medusajs/framework/types';
import {{ENTITY_CLASS}} from '../models/{{ENTITY_FILE}}';

export type {{ENTITY_DTO}} = InferTypeOf<typeof {{ENTITY_CLASS}}>;
export type Create{{ENTITY_DTO}} = Partial<Omit<{{ENTITY_DTO}}, 'id'>>;
export type Update{{ENTITY_DTO}} = Partial<Create{{ENTITY_DTO}}>;
