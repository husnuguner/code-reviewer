#!/usr/bin/env -S bun --no-env-file
/**
 * The `reviewer` executable. `--no-env-file`: the reviewer reads `.env` files itself, in a stated order;
 * the working directory is the checkout under review.
 * @packageDocumentation
 */

import { main } from "./reviewer";

process.exitCode = await main(process.argv.slice(2));
