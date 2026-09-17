import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // TODO: Implement GET logic
  res.json({ message: 'GET {{RESOURCE_NAME}}' });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  // TODO: Implement POST logic
  res.status(201).json({ message: 'POST {{RESOURCE_NAME}}' });
};
