# Route Patterns

## Collection Routes (route.ts)
```typescript
export const GET = async (req, res) => { /* List */ };
export const POST = async (req, res) => { /* Create */ };
```

## Item Routes ([id]/route.ts)
```typescript
export const GET = async (req, res) => { /* Retrieve */ };
export const POST = async (req, res) => { /* Update - NO PUT! */ };
export const DELETE = async (req, res) => { /* Delete */ };
```
