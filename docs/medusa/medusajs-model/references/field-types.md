# Field Types Reference

## Basic Types
- `model.id()` - UUID
- `model.text()` - String
- `model.number()` - Integer
- `model.bigNumber()` - BigInt
- `model.boolean()` - Boolean
- `model.dateTime()` - Timestamp
- `model.json()` - JSON
- `model.enum(['val1', 'val2'])` - Enum

## Modifiers
- `.nullable()` - Allow null
- `.default(value)` - Default value
- `.unique()` - Unique constraint
- `.index()` - Add index
