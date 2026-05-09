// SPDX-License-Identifier: MIT
/**
 * @file    extension.ts
 * @brief   Extension entry point for C Sizeof Hover.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Activate the extension on language:c
 *          - Initialize the parser
 *          - Register the HoverProvider
 *          - Manage document cache lifecycle
 *          - Handle configuration changes
 *          - Deactivate and clean up resources
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
import { ParserManager } from './parser/parser-manager';
import { DocumentCache } from './parser/document-cache';
import { CSizeofHoverProvider } from './hover-provider';
import { setOutputChannel } from './logger';

let outputChannel: vscode.OutputChannel;
let documentCache: DocumentCache;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('C Sizeof Hover');
  setOutputChannel(outputChannel);
  outputChannel.appendLine('C Sizeof Hover activating...');

  // Initialize parser (synchronous for pure TS parser)
  const parserMgr = ParserManager.getInstance();
  parserMgr.initialize('');
  outputChannel.appendLine('Parser initialized.');

  // Create document cache
  documentCache = new DocumentCache();

  // Delay registration so built-in hover providers are registered first.
  // This ensures our sizeof info appears after other hover content.
  const registerHover = () => {
    const hoverProvider = vscode.languages.registerHoverProvider(
      [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' },
      ],
      new CSizeofHoverProvider(documentCache),
    );
    context.subscriptions.push(hoverProvider);
    outputChannel.appendLine('Hover provider registered for C files.');
  };
  const timer = setTimeout(registerHover, 200);
  context.subscriptions.push({ dispose: () => clearTimeout(timer) });

  // Listen for document close to free cached data
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((e) => {
      documentCache?.invalidate(e.uri);
    }),
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('c-sizeof-hover')) {
        outputChannel.appendLine('Configuration changed, cache cleared.');
        documentCache?.clear();
      }
    }),
  );

  outputChannel.appendLine('C Sizeof Hover activated.');

  // Register disposable for cleanup
  context.subscriptions.push({
    dispose: () => {
      deactivate();
    },
  });
}

export function deactivate(): void {
  documentCache?.clear();
  const parserMgr = ParserManager.getInstance();
  if (parserMgr.isInitialized()) {
    parserMgr.dispose();
  }
  outputChannel?.appendLine('C Sizeof Hover deactivated.');
}
