// SPDX-License-Identifier: MIT
/**
 * @file    logger.ts
 * @brief   Output-channel logger for c-sizeof-hover.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Provide a single debug log sink that writes to the VS Code Output channel
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

let _channel: vscode.OutputChannel | null = null;

export function setOutputChannel(channel: vscode.OutputChannel): void {
  _channel = channel;
}

export function debug(...args: unknown[]): void {
  if (!_channel) return;
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  _channel.appendLine(`[DEBUG] ${msg}`);
}
