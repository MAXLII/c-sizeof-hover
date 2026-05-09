// SPDX-License-Identifier: MIT
/**
 * @file    config.ts
 * @brief   Extension configuration accessor.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Read VS Code configuration settings
 *          - Convert to PrimitiveSizeConfig for type-system modules
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

import * as vscode from 'vscode';
import { PrimitiveSizeConfig, DEFAULT_CONFIG } from './type-system/primitive-sizes';

const SECTION = 'c-sizeof-hover';

export interface ExtensionConfig extends PrimitiveSizeConfig {
  showAlignment: boolean;
  showPadding: boolean;
  showTypedefChain: boolean;
  debug: boolean;
}

export const DEFAULT_EXT_CONFIG: ExtensionConfig = {
  ...DEFAULT_CONFIG,
  showAlignment: true,
  showPadding: false,
  showTypedefChain: true,
  debug: false,
};

export function readConfig(): ExtensionConfig {
  const ws = vscode.workspace.getConfiguration(SECTION);
  return {
    pointerSize: ws.get<number>('pointerSize', 4),
    charSize: ws.get<number>('charSize', 1),
    shortSize: ws.get<number>('shortSize', 2),
    intSize: ws.get<number>('intSize', 4),
    longSize: ws.get<number>('longSize', 4),
    longLongSize: ws.get<number>('longLongSize', 8),
    floatSize: ws.get<number>('floatSize', 4),
    doubleSize: ws.get<number>('doubleSize', 8),
    longDoubleSize: ws.get<number>('longDoubleSize', 8),
    enumSize: ws.get<number>('enumSize', 4),
    customTypeSizes: ws.get<Record<string, number>>('customTypeSizes', {}),
    showAlignment: ws.get<boolean>('showAlignment', true),
    showPadding: ws.get<boolean>('showPadding', false),
    showTypedefChain: ws.get<boolean>('showTypedefChain', true),
    debug: ws.get<boolean>('debug', false),
  };
}
