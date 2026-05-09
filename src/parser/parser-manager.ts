// SPDX-License-Identifier: MIT
/**
 * @file    parser-manager.ts
 * @brief   Parser factory and lifecycle management.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Provide a singleton CTypeParser instance
 *          - No WASM initialization needed (pure TypeScript parser)
 *
 * @author  Max.Li
 * @date    2026-05-09
 * @version 1.0.0
 *
 * Copyright (c) 2026 Max.Li.
 * All rights reserved.
 *
 * This file is licensed under the MIT License.
 * See the LICENSE file for full license text.
 */

import { CTypeParser } from './c-type-parser';

export class ParserManager {
  private static instance: ParserManager;
  private parser: CTypeParser;
  private initialized = false;

  static getInstance(): ParserManager {
    if (!ParserManager.instance) {
      ParserManager.instance = new ParserManager();
    }
    return ParserManager.instance;
  }

  constructor() {
    this.parser = new CTypeParser();
  }

  async initialize(_wasmDir: string): Promise<void> {
    // Pure TS parser — no async init needed
    this.initialized = true;
  }

  getParser(): CTypeParser {
    return this.parser;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.initialized = false;
  }
}
