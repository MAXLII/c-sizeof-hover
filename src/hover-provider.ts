// SPDX-License-Identifier: MIT
/**
 * @file    hover-provider.ts
 * @brief   VS Code HoverProvider that shows sizeof for C variables.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Implement vscode.HoverProvider interface
 *          - Look up the word at cursor position in the symbol table
 *          - Resolve type through typedef chains
 *          - Calculate sizeof and format markdown hover text
 *
 *          Design notes:
 *          - Uses CTypeParser for symbol table building (no tree-sitter)
 *          - Supports: variables, typedefs, struct/union tags, field access
 *          - Field access detection via regex scanning of the source line
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
import { DocumentCache } from './parser/document-cache';
import { CTypeParser } from './parser/c-type-parser';
import {
  ResolvedType,
  TypeKind,
  DocumentSymbolTable,
} from './type-system/types';
import {
  resolveThroughTypedefs,
  formatTypeName,
  formatStructLayout,
} from './type-system/type-resolver';
import { calculateSize, formatBytes } from './type-system/size-calculator';
import { ExtensionConfig, readConfig } from './config';
import { debug as logDebug } from './logger';

type AccessSegment = {
  operator: '->' | '.';
  field: string;
  indexed: boolean;
};

export class CSizeofHoverProvider implements vscode.HoverProvider {
  private documentCache: DocumentCache;

  constructor(documentCache: DocumentCache) {
    this.documentCache = documentCache;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Hover> {
    const config = readConfig();

    try {
      const cached = this.documentCache.getOrParse(document);
      const word = this.getWordAtPosition(document, position);
      if (config.debug) {
        logDebug(
          `hover: file=${document.uri.fsPath}`,
          `pos=${position.line}:${position.character}`,
          `word=${word ?? '(none)'}`,
          `typedefs=${cached.symbolTable.typedefs.size}`,
          `structs=${cached.symbolTable.structDefinitions.size}`,
        );
      }
      if (!word) return null;

      const fieldAccess = this.tryFieldAccess(document, position, cached.symbolTable);
      if (fieldAccess) {
        if (config.debug) logDebug(`  => fieldAccess: ${fieldAccess.name}`);
        return this.buildHover(fieldAccess.name, fieldAccess.type, config);
      }

      const typeInfo = this.lookupWord(word, cached.symbolTable);
      if (typeInfo) {
        if (config.debug) logDebug(`  => lookupWord found: ${typeInfo.name}, kind=${typeInfo.type.kind}`);
        const hover = this.buildHover(typeInfo.name, typeInfo.type, config);
        if (hover) return hover;
        if (config.debug) logDebug(`  => buildHover returned null`);
      } else if (config.debug) {
        logDebug(`  => lookupWord not found, trying fallback...`);
      }

      const fallbackTypeInfo = this.lookupLocalTypedefBlock(document, word);
      if (!fallbackTypeInfo) {
        if (config.debug) logDebug(`  => fallback also not found, returning null`);
        return null;
      }

      if (config.debug) logDebug(`  => fallback found: ${fallbackTypeInfo.name}`);
      return this.buildHover(fallbackTypeInfo.name, fallbackTypeInfo.type, config);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logDebug(`  => EXCEPTION: ${err.message}`);
      logDebug(`  => STACK: ${err.stack?.replace(/\n/g, ' | ')}`);
      return null;
    }
  }

  private buildHover(
    name: string,
    type: ResolvedType,
    config: ExtensionConfig,
  ): vscode.Hover | null {
    const resolvedType = resolveThroughTypedefs(type);
    const sizeResult = calculateSize(resolvedType, config);

    if (!sizeResult) {
      const typeName = formatTypeName(resolvedType);
      if (
        resolvedType.kind === TypeKind.Unknown ||
        typeName === '(unknown)' ||
        typeName.startsWith('(incomplete')
      ) {
        return null;
      }
      const md = new vscode.MarkdownString(`*(incomplete type)* \`${typeName}\``);
      return new vscode.Hover(md);
    }

    const md = this.formatHoverMarkdown(type, resolvedType, sizeResult.size, config);
    return new vscode.Hover(md);
  }

  private getWordAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string | null {
    const range = document.getWordRangeAtPosition(position);
    if (!range) return null;
    return document.getText(range);
  }

  private tryFieldAccess(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbolTable: DocumentSymbolTable,
  ): { name: string; type: ResolvedType } | null {
    const line = document.lineAt(position.line).text;
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;

    const expression = this.getAccessExpressionToWord(line, wordRange);
    if (!expression || !/(?:->|\.)/.test(expression)) return null;

    const tokens = this.parseAccessExpression(expression);
    if (!tokens) return null;

    const base = this.lookupWord(tokens.base, symbolTable);
    if (!base) return null;

    let currentType = base.type;
    for (const segment of tokens.segments) {
      let containerType = resolveThroughTypedefs(currentType);

      if (segment.operator === '->') {
        if (containerType.kind !== TypeKind.Pointer || !containerType.pointeeType) {
          return null;
        }
        containerType = resolveThroughTypedefs(containerType.pointeeType);
      } else if (containerType.kind === TypeKind.Array && containerType.elementType) {
        containerType = resolveThroughTypedefs(containerType.elementType);
      }

      if (
        containerType.kind !== TypeKind.Struct &&
        containerType.kind !== TypeKind.Union
      ) {
        return null;
      }

      const member = containerType.members?.find(m => m.name === segment.field);
      if (!member) return null;

      currentType = member.type;
      if (segment.indexed) {
        const indexedType = resolveThroughTypedefs(currentType);
        if (indexedType.kind === TypeKind.Array && indexedType.elementType) {
          currentType = indexedType.elementType;
        }
      }
    }

    return { name: expression.replace(/\s+/g, ''), type: currentType };
  }

  private lookupLocalTypedefBlock(
    document: vscode.TextDocument,
    word: string,
  ): { name: string; type: ResolvedType } | null {
    if (!/^[A-Za-z_]\w*$/.test(word)) return null;

    const text = document.getText();
    const typedefBlock = this.findTypedefBlockForAlias(text, word);
    if (!typedefBlock) return null;

    const parser = new CTypeParser();
    const symbolTable = parser.parse(typedefBlock);
    return this.lookupWord(word, symbolTable);
  }

  private findTypedefBlockForAlias(text: string, alias: string): string | null {
    const aliasPattern = new RegExp(`\\b${this.escapeRegExp(alias)}\\s*;`, 'g');
    let match: RegExpExecArray | null;

    while ((match = aliasPattern.exec(text)) !== null) {
      const end = match.index + match[0].length;
      const start = this.findNearestTypedefStart(text, match.index);
      if (start < 0) continue;

      const block = text.substring(start, end);
      if (/^typedef\s+(struct|union|enum)\b/.test(block.trim())) {
        return block;
      }
    }

    return null;
  }

  private findNearestTypedefStart(text: string, beforeOffset: number): number {
    let searchFrom = beforeOffset;
    while (searchFrom >= 0) {
      const start = text.lastIndexOf('typedef', searchFrom);
      if (start < 0) return -1;

      const between = text.substring(start, beforeOffset);
      const lastSemicolon = between.lastIndexOf(';');
      const firstBrace = between.indexOf('{');
      if (lastSemicolon < 0 || (firstBrace >= 0 && lastSemicolon < firstBrace)) {
        return start;
      }

      searchFrom = start - 1;
    }

    return -1;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getAccessExpressionToWord(
    line: string,
    wordRange: vscode.Range,
  ): string | null {
    const uptoWord = line.substring(0, wordRange.end.character);
    const match = uptoWord.match(
      /([A-Za-z_]\w*(?:\s*(?:->|\.)\s*[A-Za-z_]\w*(?:\s*\[[^\]]*\])?)*)$/,
    );
    return match ? match[1] : null;
  }

  private parseAccessExpression(
    expression: string,
  ): { base: string; segments: AccessSegment[] } | null {
    const baseMatch = expression.match(/^\s*([A-Za-z_]\w*)/);
    if (!baseMatch) return null;

    const segments: AccessSegment[] = [];
    const segmentRe = /\s*(->|\.)\s*([A-Za-z_]\w*)(\s*\[[^\]]*\])?/g;
    segmentRe.lastIndex = baseMatch[0].length;

    let match: RegExpExecArray | null;
    while ((match = segmentRe.exec(expression)) !== null) {
      segments.push({
        operator: match[1] as '->' | '.',
        field: match[2],
        indexed: match[3] !== undefined,
      });
    }

    return segments.length > 0 ? { base: baseMatch[1], segments } : null;
  }

  private lookupWord(
    word: string,
    symbolTable: DocumentSymbolTable,
  ): { name: string; type: ResolvedType } | null {
    const sym = symbolTable.globalScope.symbols.get(word);
    if (sym) {
      return { name: word, type: sym.type };
    }

    const td = symbolTable.typedefs.get(word);
    if (td) {
      return { name: word, type: td };
    }

    const structDef = symbolTable.structDefinitions.get(word);
    if (structDef) {
      return { name: word, type: structDef };
    }

    const unionDef = symbolTable.unionDefinitions.get(word);
    if (unionDef) {
      return { name: word, type: unionDef };
    }

    const builtin = symbolTable.builtinTypes.get(word);
    if (builtin) {
      return { name: word, type: builtin };
    }

    return null;
  }

  private formatHoverMarkdown(
    originalType: ResolvedType,
    resolvedType: ResolvedType,
    size: number,
    config: ExtensionConfig,
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    const typeName = formatTypeName(resolvedType);
    md.appendCodeblock(`sizeof(${typeName}) = ${formatBytes(size)}`, 'c');

    if (resolvedType.qualifiers && resolvedType.qualifiers.size > 0) {
      const quals = [...resolvedType.qualifiers].join(' ');
      md.appendMarkdown(`\n\n*Qualifiers:* \`${quals}\``);
    }

    if (config.showTypedefChain && originalType.kind === TypeKind.Typedef) {
      md.appendMarkdown('\n\n---\n\n*Typedef chain:*\n');
      md.appendMarkdown(this.formatTypedefChain(originalType));
    }

    if (
      config.showAlignment &&
      (resolvedType.kind === TypeKind.Struct ||
        resolvedType.kind === TypeKind.Union) &&
      resolvedType.members &&
      resolvedType.members.length > 0
    ) {
      md.appendMarkdown('\n\n---\n\n**Memory Layout:**\n\n');
      md.appendCodeblock(formatStructLayout(resolvedType), 'c');
    }

    if (resolvedType.kind === TypeKind.Array && resolvedType.elementCount !== undefined) {
      const elementSize = calculateSize(resolvedType.elementType!, config)?.size;
      if (elementSize !== undefined) {
        md.appendMarkdown(
          `\n\n${resolvedType.elementCount} elements x ${formatBytes(elementSize)} each`,
        );
      }
    }

    if (resolvedType.kind === TypeKind.Pointer && resolvedType.pointeeType) {
      const pointeeSize = calculateSize(resolveThroughTypedefs(resolvedType.pointeeType), config)?.size;
      if (pointeeSize !== undefined) {
        md.appendMarkdown(
          `\n\nPoints to: \`${formatTypeName(resolvedType.pointeeType)}\` (${formatBytes(pointeeSize)})`,
        );
      }
    }

    return md;
  }

  private formatTypedefChain(type: ResolvedType): string {
    const chain: string[] = [];
    let current: ResolvedType | undefined = type;

    while (current && current.kind === TypeKind.Typedef) {
      chain.push(`\`${current.name || '(anonymous)'}\``);
      current = current.aliasFor;
    }

    if (current && current.kind !== TypeKind.Typedef) {
      chain.push(`\`${formatTypeName(current)}\``);
    }

    return chain.join(' -> ');
  }
}
