// SPDX-License-Identifier: MIT
/**
 * @file    document-cache.ts
 * @brief   Per-document parsed symbol table cache.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Cache parsed symbol tables per document URI and version
 *          - Invalidate cache on document change or close
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
import * as fs from 'fs';
import * as path from 'path';
import { ParserManager } from './parser-manager';
import { CachedDocument } from '../type-system/types';
import { debug as logDebug } from '../logger';

const MAX_INCLUDE_DEPTH = 32;
const MAX_INCLUDE_FILES = 50;
const MAX_COMBINED_TEXT = 200_000; // 200KB — fall back to single-file above this

export class DocumentCache {
  private cache = new Map<string, CachedDocument>();
  private headerCache = new Map<string, { mtimeMs: number; text: string }>();

  getOrParse(document: vscode.TextDocument): CachedDocument {
    const key = document.uri.toString();
    const cached = this.cache.get(key);

    if (cached && cached.version === document.version) {
      logDebug(
        `getOrParse: CACHE HIT — ${cached.symbolTable.typedefs.size} typedefs, ${cached.symbolTable.structDefinitions.size} structs`,
      );
      return cached;
    }

    logDebug(`getOrParse: cache miss, collecting translation unit...`);

    const parserMgr = ParserManager.getInstance();
    const parser = parserMgr.getParser();
    const text = this.collectTranslationUnitText(document);

    logDebug(`getOrParse: parsing ${text.length} chars...`);
    let symbolTable;
    try {
      symbolTable = parser.parse(text);
      logDebug(
        `getOrParse: OK — ${symbolTable.typedefs.size} typedefs, ${symbolTable.structDefinitions.size} structs`,
      );
    } catch (e) {
      logDebug(`getOrParse: parser.parse FAILED — ${e}`);
      throw e;
    }

    const entry: CachedDocument = {
      uri: key,
      version: document.version,
      tree: null, // No tree-sitter tree
      symbolTable,
      lastParseTime: Date.now(),
    };

    this.cache.set(key, entry);
    return entry;
  }

  invalidate(uri: vscode.Uri): void {
    this.cache.delete(uri.toString());
  }

  clear(): void {
    this.cache.clear();
    this.headerCache.clear();
  }

  private collectTranslationUnitText(document: vscode.TextDocument): string {
    const sourceText = document.getText();
    if (document.uri.scheme !== 'file') {
      return sourceText;
    }

    try {
      const visited = new Set<string>();
      const includes = this.collectIncludedText(
        sourceText,
        path.dirname(document.uri.fsPath),
        visited,
        0,
      );
      logDebug(
        `collectTranslationUnit: ${visited.size} headers collected for ${document.uri.fsPath}`,
      );
      if (includes.length > 0) {
        const combined = `${includes.join('\n')}\n${sourceText}`;
        if (combined.length <= MAX_COMBINED_TEXT) {
          return combined;
        }
        logDebug(
          `collectTranslationUnit: combined text ${combined.length} chars exceeds limit (${MAX_COMBINED_TEXT}), falling back to single-file`,
        );
      }
      return sourceText;
    } catch (e) {
      logDebug(`collectTranslationUnit FAILED: ${e}, falling back to single-file parse`);
      return sourceText;
    }
  }

  private collectIncludedText(
    text: string,
    baseDir: string,
    visited: Set<string>,
    depth: number,
  ): string[] {
    if (depth >= MAX_INCLUDE_DEPTH) {
      logDebug(`  include depth limit (${MAX_INCLUDE_DEPTH}) reached at ${baseDir}`);
      return [];
    }
    if (visited.size >= MAX_INCLUDE_FILES) {
      logDebug(`  include file limit (${MAX_INCLUDE_FILES}) reached`);
      return [];
    }

    const result: string[] = [];
    const includeRe = /^\s*#\s*include\s+"([^"]+)"/gm;

    let match: RegExpExecArray | null;
    while ((match = includeRe.exec(text)) !== null) {
      const includePath = this.resolveIncludePath(match[1], baseDir);
      if (!includePath || visited.has(includePath)) {
        if (includePath && visited.has(includePath)) {
          logDebug(`  skip already-visited: ${includePath}`);
        }
        continue;
      }

      visited.add(includePath);
      logDebug(`  [depth ${depth}] include: ${includePath}`);
      const headerText = this.readFileCached(includePath);
      if (headerText === undefined) continue;

      result.push(
        ...this.collectIncludedText(headerText, path.dirname(includePath), visited, depth + 1),
      );
      result.push(headerText);
    }

    return result;
  }

  private resolveIncludePath(includeName: string, baseDir: string): string | null {
    const directCandidates = [
      path.resolve(baseDir, includeName),
      ...this.workspaceCandidatePaths(includeName),
    ];

    for (const candidate of directCandidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return this.normalizePath(candidate);
      }
    }

    return this.findWorkspaceFile(includeName);
  }

  private workspaceCandidatePaths(includeName: string): string[] {
    const candidates: string[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = folder.uri.fsPath;
      candidates.push(
        path.resolve(root, includeName),
        path.resolve(root, 'include', includeName),
        path.resolve(root, 'inc', includeName),
        path.resolve(root, 'src', includeName),
      );
    }
    return candidates;
  }

  private findWorkspaceFile(includeName: string): string | null {
    const normalizedInclude = includeName.replace(/[\\/]+/g, path.sep);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const found = this.findFileRecursive(folder.uri.fsPath, normalizedInclude);
      if (found) return found;
    }
    return null;
  }

  private findFileRecursive(root: string, includeName: string): string | null {
    const ignored = new Set(['.git', 'node_modules', 'out', 'dist', 'build', '.vscode']);
    const stack = [root];

    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name)) {
            stack.push(fullPath);
          }
          continue;
        }

        if (this.pathEndsWith(fullPath, includeName)) {
          return this.normalizePath(fullPath);
        }
      }
    }

    return null;
  }

  private pathEndsWith(filePath: string, includeName: string): boolean {
    const normalizedFile = this.normalizePath(filePath).replace(/\\/g, '/').toLowerCase();
    const normalizedInclude = this.normalizePath(includeName).replace(/\\/g, '/').toLowerCase();
    return normalizedFile.endsWith(normalizedInclude);
  }

  private readFileCached(filePath: string): string | undefined {
    try {
      const stat = fs.statSync(filePath);
      const cached = this.headerCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.text;
      }

      const text = fs.readFileSync(filePath, 'utf8');
      this.headerCache.set(filePath, { mtimeMs: stat.mtimeMs, text });
      return text;
    } catch {
      return undefined;
    }
  }

  private normalizePath(filePath: string): string {
    return path.normalize(filePath);
  }
}
