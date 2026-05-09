// SPDX-License-Identifier: MIT
/**
 * @file    c-type-parser.ts
 * @brief   Lightweight regex-based C type declaration parser.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Parse C source text to extract type declarations
 *          - Build DocumentSymbolTable (typedefs, structs, unions, enums, variables)
 *          - Handle common embedded C patterns (CMSIS, stdint, register maps)
 *
 *          Design notes:
 *          - Avoids external dependencies (no WASM, no native bindings)
 *          - Regex-based: strips comments first, then matches declarations
 *          - Handles: simple vars, pointers, arrays, function pointers, bit fields
 *          - Not a full C parser; focuses on declaration extraction for sizeof hover
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

import {
  DocumentSymbolTable,
  Scope,
  SymbolEntry,
  SymbolKind,
  TypeKind,
  ResolvedType,
  StructMember,
} from '../type-system/types';
import { resolveBuiltinType, DEFAULT_CONFIG } from '../type-system/primitive-sizes';

export interface ParsePosition {
  line: number;
  column: number;
}

export interface ParsedNode {
  type: string;
  text: string;
  start: ParsePosition;
  end: ParsePosition;
}

interface TopLevelBlock {
  text: string;
  packAlignment?: number;
}

export class CTypeParser {
  private structDefs = new Map<string, ResolvedType>();
  private unionDefs = new Map<string, ResolvedType>();
  private typedefs = new Map<string, ResolvedType>();
  private globalSymbols = new Map<string, SymbolEntry>();
  private builtinTypes = new Map<string, ResolvedType>();
  private lineMap: number[] = [];
  private currentPackAlignment: number | undefined;

  constructor() {
    const config = DEFAULT_CONFIG;
    const builtins = [
      'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
      'int8_t', 'int16_t', 'int32_t', 'int64_t',
      'size_t', 'uintptr_t', 'intptr_t', 'ptrdiff_t',
      'char16_t', 'char32_t', 'float32_t', 'float64_t',
      'bool', 'wchar_t',
    ];
    for (const name of builtins) {
      const resolved = resolveBuiltinType(name, config);
      if (resolved) {
        this.builtinTypes.set(name, resolved);
      }
    }
  }

  parse(text: string): DocumentSymbolTable {
    this.structDefs.clear();
    this.unionDefs.clear();
    this.typedefs.clear();
    this.globalSymbols.clear();

    // Build line map for position calculation
    this.lineMap = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        this.lineMap.push(i + 1);
      }
    }

    const clean = this.stripPreprocessorDirectives(this.stripComments(text));
    const blocks = this.applyPackState(this.splitTopLevel(clean));

    // Pass 1: struct/union/enum definitions and typedefs
    for (const block of blocks) {
      this.currentPackAlignment = block.packAlignment;
      this.processStructUnion(block.text);
      this.processEnum(block.text);
      this.processTypedef(block.text);
    }

    // Pass 2: variable declarations and function definitions
    for (const block of blocks) {
      this.currentPackAlignment = block.packAlignment;
      this.processDeclaration(block.text);
    }

    this.currentPackAlignment = undefined;

    return {
      globalScope: { symbols: this.globalSymbols, parent: null },
      builtinTypes: this.builtinTypes,
      structDefinitions: this.structDefs,
      unionDefinitions: this.unionDefs,
      typedefs: this.typedefs,
    };
  }

  /**
   * Find the type at a specific position in the source text.
   */
  findNodeAt(text: string, line: number, column: number): ParsedNode | null {
    const clean = this.stripComments(text);
    const offset = this.positionToOffset(line, column);

    // Find the word at this position
    const word = this.getWordAt(text, line, column);
    if (!word) return null;

    return {
      type: 'identifier',
      text: word,
      start: { line, column },
      end: { line, column: column + word.length },
    };
  }

  positionToOffset(line: number, column: number): number {
    if (line >= this.lineMap.length) return 0;
    return this.lineMap[line] + column;
  }

  offsetToPosition(offset: number): ParsePosition {
    let line = 0;
    for (let i = this.lineMap.length - 1; i >= 0; i--) {
      if (this.lineMap[i] <= offset) {
        line = i;
        break;
      }
    }
    return { line, column: offset - this.lineMap[line] };
  }

  private stripComments(text: string): string {
    // Remove // comments
    let result = text.replace(/\/\/.*$/gm, ' ');
    // Remove /* */ comments (non-greedy across lines)
    result = result.replace(/\/\*[\s\S]*?\*\//g, ' ');
    return result;
  }

  private stripPreprocessorDirectives(text: string): string {
    const lines = text.split(/\r?\n/);
    const kept: string[] = [];
    let inContinuation = false;

    for (const line of lines) {
      const trimmed = line.trim();
      const isDirective = trimmed.startsWith('#');

      if (inContinuation || isDirective) {
        inContinuation = /\\\s*$/.test(line);
        kept.push(!inContinuation && trimmed.startsWith('#pragma pack')
          ? this.createPragmaPackMarker(trimmed)
          : '');
        continue;
      }

      kept.push(line);
    }

    return kept.join('\n');
  }

  private createPragmaPackMarker(line: string): string {
    const packArgs = line.match(/^#\s*pragma\s+pack\s*\(([^)]*)\)/)?.[1]?.trim();
    if (packArgs === undefined) return '';

    if (packArgs === '') {
      return '__C_SIZEOF_PRAGMA_PACK_DEFAULT;';
    }

    const parts = packArgs.split(',').map(p => p.trim().toLowerCase());
    if (parts[0] === 'pop') {
      return '__C_SIZEOF_PRAGMA_PACK_POP;';
    }
    if (parts[0] === 'push') {
      const align = parts.find(p => /^\d+$/.test(p));
      return align ? `__C_SIZEOF_PRAGMA_PACK_PUSH_${align};` : '__C_SIZEOF_PRAGMA_PACK_PUSH;';
    }
    if (/^\d+$/.test(parts[0])) {
      return `__C_SIZEOF_PRAGMA_PACK_SET_${parts[0]};`;
    }

    return '';
  }

  private applyPackState(blocks: string[]): TopLevelBlock[] {
    const result: TopLevelBlock[] = [];
    const packStack: Array<number | undefined> = [];
    let currentPackAlignment: number | undefined;

    for (const block of blocks) {
      const marker = block.match(/^__C_SIZEOF_PRAGMA_PACK_(DEFAULT|POP|PUSH(?:_(\d+))?|SET_(\d+))$/);
      if (marker) {
        const command = marker[1];
        if (command === 'DEFAULT') {
          currentPackAlignment = undefined;
        } else if (command === 'POP') {
          currentPackAlignment = packStack.pop();
        } else if (command.startsWith('PUSH')) {
          packStack.push(currentPackAlignment);
          currentPackAlignment = marker[2] ? parseInt(marker[2], 10) : currentPackAlignment;
        } else if (command.startsWith('SET_')) {
          currentPackAlignment = marker[3] ? parseInt(marker[3], 10) : undefined;
        }
        continue;
      }

      result.push({ text: block, packAlignment: currentPackAlignment });
    }

    return result;
  }

  /**
   * Split source into top-level blocks at ; and { } boundaries.
   */
  private splitTopLevel(text: string): string[] {
    const blocks: string[] = [];
    let depth = 0;
    let start = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const block = text.substring(start, i + 1).trim();
          if (block && !/^(?:typedef\s+)?(?:struct|union|enum)\b/.test(block)) {
            blocks.push(block);
            start = i + 1;
          }
        }
      } else if (ch === ';' && depth === 0) {
        blocks.push(text.substring(start, i).trim());
        start = i + 1;
      }
    }

    // Handle remaining text (e.g., function bodies)
    const remaining = text.substring(start).trim();
    if (remaining) {
      blocks.push(remaining);
    }

    return blocks.filter(b => b.length > 0);
  }

  private processStructUnion(block: string): void {
    // Match: struct/union [attr] name { body }
    const structRe = /(struct|union)\s+(?:__attribute__\s*\(\([^)]*\)\)\s*)?(\w+)\s*\{([\s\S]*)\}/;
    const match = block.match(structRe);
    if (!match) return;

    const [, kind, tagName, body] = match;
    const isPacked = this.currentPackAlignment === 1 ||
      block.includes('__packed') ||
      block.includes('__attribute__((packed))');

    const members = this.parseFieldDeclarations(body);

    const type: ResolvedType = {
      kind: kind === 'struct' ? TypeKind.Struct : TypeKind.Union,
      name: tagName,
      members,
      isPacked,
    };

    if (kind === 'struct') {
      this.structDefs.set(tagName, type);
    } else {
      this.unionDefs.set(tagName, type);
    }

    // Register as symbol
    const entry: SymbolEntry = {
      name: tagName,
      kind: kind === 'struct' ? SymbolKind.StructTag : SymbolKind.UnionTag,
      type,
      sourceRow: 0,
      sourceColumn: 0,
    };
    this.globalSymbols.set(tagName, entry);
  }

  private processEnum(block: string): void {
    const enumRe = /enum\s+(\w+)?\s*\{([^}]*)\}/;
    const match = block.match(enumRe);
    if (!match) return;

    const [, tagName, body] = match;
    this.createEnumType(tagName, body);
  }

  private processTypedef(block: string): void {
    // Match: typedef <type> <alias>;
    let tdRe = /^typedef\s+([\s\S]+?)\s+(\w+)\s*$/;
    let match = block.match(tdRe);
    if (!match) {
      // Handle "}alias" without space after closing brace
      tdRe = /^typedef\s+([\s\S]+?\})\s*(\w+)\s*$/;
      match = block.match(tdRe);
    }
    if (!match) return;

    const [, typeStr, alias] = match;

    const resolvedType = this.parseTypeString(typeStr);
    if (
      (resolvedType.kind === TypeKind.Struct ||
        resolvedType.kind === TypeKind.Union ||
        resolvedType.kind === TypeKind.Enum) &&
      !resolvedType.name
    ) {
      resolvedType.name = alias;
    }

    const typedefType: ResolvedType = {
      kind: TypeKind.Typedef,
      name: alias,
      aliasFor: resolvedType,
    };

    this.typedefs.set(alias, typedefType);

    // Also for tagged typedefs.
    if (resolvedType.kind === TypeKind.Struct && resolvedType.name) {
      this.structDefs.set(alias, resolvedType);
    } else if (resolvedType.kind === TypeKind.Union && resolvedType.name) {
      this.unionDefs.set(alias, resolvedType);
    } else if (resolvedType.kind === TypeKind.Enum && resolvedType.name) {
      this.globalSymbols.set(alias, {
        name: alias,
        kind: SymbolKind.EnumTag,
        type: resolvedType,
        sourceRow: 0,
        sourceColumn: 0,
      });
    }

    this.globalSymbols.set(alias, {
      name: alias,
      kind: SymbolKind.Typedef,
      type: typedefType,
      sourceRow: 0,
      sourceColumn: 0,
    });
  }

  private processDeclaration(block: string): void {
    // Skip blocks that are struct/union/enum definitions or typedefs
    if (/^(struct|union|enum|typedef)\s/.test(block)) return;
    // Skip preprocessor directives
    if (/^\s*#/.test(block)) return;
    // Function definitions contain both parameters and local declarations that
    // are useful hover targets inside the current document.
    if (block.includes('{')) {
      this.processFunctionDefinition(block);
      return;
    }

    // Try to match variable declarations: [qualifiers] type declarator [, declarator]*
    // Handles: const int *a, int b[10], volatile uint32_t x, etc.
    const declRe = /^(?:const\s+|volatile\s+|__IO\s+|__IM\s+|__OM\s+|static\s+|extern\s+)*([\w\s*]+?)\s+(.+)\s*$/;
    const match = block.match(declRe);
    if (!match) return;

    const typeStr = match[1].trim();
    const declListStr = match[2].trim();

    // Handle __IO, __IM, __OM qualifiers - strip them from type
    const qualifiers = new Set<string>();
    let cleanTypeStr = typeStr;
    for (const q of ['const', 'volatile', '__IO', '__IM', '__OM']) {
      if (cleanTypeStr.includes(q)) {
        qualifiers.add(q);
        cleanTypeStr = cleanTypeStr.replace(new RegExp('\\b' + q + '\\b', 'g'), '').trim();
      }
    }

    // Skip if type looks like a function name (no clear type)
    if (!cleanTypeStr || /^void\s*$/.test(cleanTypeStr)) {
      // void declaration or function
      const funcMatch = block.match(/^void\s+(\w+)\s*\(/);
      if (funcMatch) {
        this.globalSymbols.set(funcMatch[1], {
          name: funcMatch[1],
          kind: SymbolKind.Function,
          type: { kind: TypeKind.Function, name: funcMatch[1] },
          sourceRow: 0,
          sourceColumn: 0,
        });
      }
      return;
    }

    const baseType = this.parseTypeString(cleanTypeStr);
    if (qualifiers.size > 0) {
      baseType.qualifiers = qualifiers as any;
    }

    // Split multiple declarators
    const declarators = this.splitDeclarators(declListStr);

    for (const decl of declarators) {
      const { name, type: declType } = this.parseDeclarator(baseType, decl.trim());
      if (name) {
        this.globalSymbols.set(name, {
          name,
          kind: SymbolKind.Variable,
          type: declType,
          sourceRow: 0,
          sourceColumn: 0,
        });
      }
    }
  }

  private processFunctionDefinition(block: string): void {
    const funcMatch = block.match(/^([\w\s*]+?)\s+(\w+)\s*\(([^)]*)\)\s*\{/);
    if (!funcMatch) return;

    const funcName = funcMatch[2];
    this.globalSymbols.set(funcName, {
      name: funcName,
      kind: SymbolKind.Function,
      type: { kind: TypeKind.Function, name: funcName },
      sourceRow: 0,
      sourceColumn: 0,
    });

    this.processFunctionParameters(funcMatch[3]);

    const bodyStart = block.indexOf('{');
    const bodyEnd = block.lastIndexOf('}');
    if (bodyStart < 0 || bodyEnd <= bodyStart) return;

    const body = block.substring(bodyStart + 1, bodyEnd);
    for (const statement of body.split(';')) {
      const decl = statement.trim();
      if (!decl || decl.includes('=') && !this.looksLikeDeclaration(decl)) continue;
      this.processDeclaration(decl);
    }
  }

  private processFunctionParameters(params: string): void {
    for (const rawParam of this.splitDeclarators(params)) {
      const param = rawParam.trim();
      if (!param || param === 'void' || param === '...') continue;

      const paramMatch = param.match(/^(.+?)(\*?\s*\w+)(?:\s*\[[^\]]*\])?$/);
      if (!paramMatch) continue;

      const typeStr = paramMatch[1].trim();
      const declStr = param.substring(typeStr.length).trim();
      const baseType = this.parseTypeString(typeStr);
      const { name, type } = this.parseDeclarator(baseType, declStr);
      if (!name) continue;

      this.globalSymbols.set(name, {
        name,
        kind: SymbolKind.Variable,
        type,
        sourceRow: 0,
        sourceColumn: 0,
      });
    }
  }

  private looksLikeDeclaration(statement: string): boolean {
    return /^(?:const\s+|volatile\s+|__IO\s+|__IM\s+|__OM\s+|static\s+|extern\s+)*(?:struct\s+\w+|union\s+\w+|enum\s+\w+|[A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)*)\s+[*\w]/.test(statement);
  }

  private splitDeclarators(declList: string): string[] {
    // Split by comma, but respect parentheses and brackets
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < declList.length; i++) {
      const ch = declList[i];
      if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      } else if (ch === ',' && depth === 0) {
        parts.push(declList.substring(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(declList.substring(start).trim());
    return parts.filter(p => p.length > 0);
  }

  private parseDeclarator(
    baseType: ResolvedType,
    declStr: string,
  ): { name: string; type: ResolvedType } {
    // Remove initializer
    const eqIdx = declStr.indexOf('=');
    const cleanDecl = eqIdx >= 0 ? declStr.substring(0, eqIdx).trim() : declStr.trim();

    // Check for function pointer: e.g., void (*func)(int, char)
    const funcPtrMatch = cleanDecl.match(/^\(\s*\*\s*(\w+)\s*\)\s*\(([^)]*)\)/);
    if (funcPtrMatch) {
      return {
        name: funcPtrMatch[1],
        type: { kind: TypeKind.Pointer, pointeeType: baseType },
      };
    }

    // Count pointer levels
    let ptrLevel = 0;
    let remaining = cleanDecl;
    while (remaining.startsWith('*')) {
      ptrLevel++;
      remaining = remaining.substring(1).trim();
    }

    // Check for array
    const arrMatch = remaining.match(/^(\w+)\s*\[(\d*)\]/);
    if (arrMatch) {
      const name = arrMatch[1];
      const countStr = arrMatch[2];
      const elemType = ptrLevel > 0
        ? this.wrapPointers(baseType, ptrLevel)
        : baseType;
      return {
        name,
        type: {
          kind: TypeKind.Array,
          elementType: elemType,
          elementCount: countStr ? parseInt(countStr, 10) : undefined,
        },
      };
    }

    // Simple name
    const nameMatch = remaining.match(/^(\w+)/);
    if (nameMatch) {
      const name = nameMatch[1];
      const finalType = ptrLevel > 0
        ? this.wrapPointers(baseType, ptrLevel)
        : baseType;
      return { name, type: finalType };
    }

    return { name: '', type: baseType };
  }

  private wrapPointers(baseType: ResolvedType, levels: number): ResolvedType {
    let result = baseType;
    for (let i = 0; i < levels; i++) {
      result = { kind: TypeKind.Pointer, pointeeType: result };
    }
    return result;
  }

  private parseFieldDeclarations(body: string): StructMember[] {
    const members: StructMember[] = [];

    // Split body by top-level semicolons (respecting {} nesting)
    const fields = this.splitTopLevelSemicolons(body);

    for (const field of fields) {
      // Check for bit field: type name : width
      const bitMatch = field.match(/^([\w\s]+?)\s+(\w+)\s*:\s*(\d+)/);
      if (bitMatch) {
        const typeStr = bitMatch[1].trim();
        const fieldName = bitMatch[2];
        const width = parseInt(bitMatch[3], 10);
        const baseType = this.parseTypeString(typeStr);
        members.push({
          name: fieldName,
          type: baseType,
          offset: 0,
          bitField: { width, baseType },
        });
        continue;
      }

      // Check for nested struct/union (before splitTypeAndDeclarators,
      // since nested struct/union bodies contain semicolons that confuse it)
      const nestedMembers = this.tryParseNestedStructOrUnion(field);
      if (nestedMembers) {
        for (const nm of nestedMembers) {
          members.push(nm);
        }
        continue;
      }

      const fieldParts = this.splitTypeAndDeclarators(field);
      if (fieldParts) {
        const typeStr = fieldParts.typeStr;
        const declStr = fieldParts.declStr;
        const baseType = this.parseTypeString(typeStr);

        // Check for multiple declarators (int a, b, c)
        const declarators = this.splitDeclarators(declStr);
        for (const decl of declarators) {
          const { name, type: declType } = this.parseDeclarator(baseType, decl);
          if (name) {
            members.push({ name, type: declType, offset: 0 });
          }
        }
        continue;
      }
    }

    return members;
  }

  /**
   * Split text on semicolons that are at brace depth 0.
   */
  private splitTopLevelSemicolons(body: string): string[] {
    const fields: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      } else if (ch === ';' && depth === 0) {
        const field = body.substring(start, i).trim();
        if (field.length > 0) {
          fields.push(field);
        }
        start = i + 1;
      }
    }
    return fields;
  }

  /**
   * Find the matching '}' for a '{' at openIndex, respecting nesting.
   */
  private findMatchingBrace(text: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
      if (text[i] === '{') {
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Try to parse a nested struct/union declaration like:
   *   struct { int a; } foo;
   *   union { int x; char y; } bar;
   *   struct tag { ... } name;
   * Handles nested braces in the struct body.
   *
   * @returns StructMember[] to add to parent, or null if no match.
   *          May return multiple members for C11 anonymous struct/union flattening.
   */
  private tryParseNestedStructOrUnion(field: string): StructMember[] | null {
    const keywordMatch = field.match(/^\s*(struct|union)\b/);
    if (!keywordMatch) {
      return null;
    }

    const kind = keywordMatch[1];
    const afterKeyword = field.substring(keywordMatch[0].length);
    const tagNameMatch = afterKeyword.match(/^\s*(\w+)\s*\{/);

    let bodyStart: number;
    let tagName: string | undefined;

    if (tagNameMatch) {
      tagName = tagNameMatch[1];
      bodyStart = keywordMatch[0].length + tagNameMatch[0].length - 1; // index of '{'
    } else {
      bodyStart = field.indexOf('{');
      if (bodyStart < 0) {
        return null;
      }
    }

    const closeBraceIdx = this.findMatchingBrace(field, bodyStart);
    if (closeBraceIdx < 0) {
      return null;
    }

    const nestedBody = field.substring(bodyStart + 1, closeBraceIdx).trim();
    const afterBrace = field.substring(closeBraceIdx + 1).trim();

    // Parse declarators after closing brace (member name(s))
    const declarators = afterBrace ? this.splitDeclarators(afterBrace) : [];
    const nestedMembers = this.parseFieldDeclarations(nestedBody);

    const isPacked = this.currentPackAlignment === 1;
    const nestedType: ResolvedType = {
      kind: kind === 'struct' ? TypeKind.Struct : TypeKind.Union,
      name: tagName,
      members: nestedMembers,
      isPacked,
    };

    // Register tag if present
    if (tagName) {
      if (kind === 'struct') {
        this.structDefs.set(tagName, nestedType);
      } else {
        this.unionDefs.set(tagName, nestedType);
      }
    }

    if (declarators.length === 0) {
      // Anonymous struct/union with no declarator (C11 anonymous member).
      // Flatten: return all nested members so they become direct members of parent.
      return nestedMembers.map(n => ({ ...n, offset: 0 }));
    }

    const result: StructMember[] = [];
    for (const decl of declarators) {
      const { name, type: declType } = this.parseDeclarator(nestedType, decl);
      if (name) {
        result.push({ name, type: declType, offset: 0 });
      }
    }

    if (result.length === 0) {
      // Fallback: anonymous struct member
      result.push({ name: '', type: nestedType, offset: 0 });
    }

    return result;
  }

  private splitTypeAndDeclarators(field: string): { typeStr: string; declStr: string } | null {
    let best: { typeStr: string; declStr: string } | null = null;
    const splitRe = /\s+/g;

    let match: RegExpExecArray | null;
    while ((match = splitRe.exec(field)) !== null) {
      const typeStr = field.substring(0, match.index).trim();
      const declStr = field.substring(match.index).trim();
      if (!typeStr || !declStr) continue;

      const type = this.parseTypeString(typeStr);
      if (type.kind === TypeKind.Unknown) continue;

      const firstDeclarator = this.splitDeclarators(declStr)[0];
      if (!firstDeclarator) continue;

      const parsed = this.parseDeclarator(type, firstDeclarator);
      if (!parsed.name) continue;

      best = { typeStr, declStr };
    }

    return best;
  }

  parseTypeString(typeStr: string, _depth: number = 0): ResolvedType {
    if (_depth > 32) {
      return { kind: TypeKind.Unknown, name: `(recursion limit: ${typeStr})` };
    }
    let s = typeStr.trim();
    if (!s) return { kind: TypeKind.Unknown, name: '' };

    // Check builtin first
    const builtin = this.builtinTypes.get(s);
    if (builtin) return builtin;

    // Check typedefs
    const td = this.typedefs.get(s);
    if (td) return td;

    // Check struct/union definitions
    const structDef = this.structDefs.get(s);
    if (structDef) return structDef;

    const unionDef = this.unionDefs.get(s);
    if (unionDef) return unionDef;

    // Check primitive types
    const primitives = [
      'void', 'char', 'signed char', 'unsigned char',
      'short', 'short int', 'signed short', 'signed short int',
      'unsigned short', 'unsigned short int',
      'int', 'signed', 'signed int', 'unsigned', 'unsigned int',
      'long', 'long int', 'signed long', 'signed long int',
      'unsigned long', 'unsigned long int',
      'long long', 'long long int', 'signed long long', 'signed long long int',
      'unsigned long long', 'unsigned long long int',
      'float', 'double', 'long double',
      '_Bool', 'bool',
    ];

    if (primitives.includes(s)) {
      return { kind: TypeKind.Primitive, name: s };
    }

    // Handle pointer: type *
    if (s.endsWith('*')) {
      const innerType = this.parseTypeString(s.slice(0, -1).trim(), _depth + 1);
      return { kind: TypeKind.Pointer, pointeeType: innerType };
    }

    // Handle inline struct/union definition:
    // struct { ... }, struct Name { ... }, union { ... }, union Name { ... }
    const inlineStructRe = /^(struct|union)(?:\s+(\w+))?\s*\{([\s\S]*)\}$/;
    const inlineMatch = s.match(inlineStructRe);
    if (inlineMatch) {
      const [, kind, tagName, body] = inlineMatch;
      const members = this.parseFieldDeclarations(body);
      const type: ResolvedType = {
        kind: kind === 'struct' ? TypeKind.Struct : TypeKind.Union,
        name: tagName,
        members,
        isPacked: this.currentPackAlignment === 1,
      };
      if (tagName) {
        if (kind === 'struct') {
          this.structDefs.set(tagName, type);
        } else {
          this.unionDefs.set(tagName, type);
        }
      }
      return type;
    }

    // Handle inline enum definition: enum { A, B } or enum Name { A, B }
    const inlineEnumRe = /^enum(?:\s+(\w+))?\s*\{([\s\S]*)\}$/;
    const inlineEnumMatch = s.match(inlineEnumRe);
    if (inlineEnumMatch) {
      const [, enumName, body] = inlineEnumMatch;
      return this.createEnumType(enumName, body);
    }

    // Handle struct/union tag reference: struct Name or union Name
    const tagRefRe = /^(struct|union|enum)\s+(\w+)$/;
    const tagRefMatch = s.match(tagRefRe);
    if (tagRefMatch) {
      const [, kind, tagName] = tagRefMatch;
      if (kind === 'struct') {
        const def = this.structDefs.get(tagName);
        if (def) return def;
      } else if (kind === 'union') {
        const def = this.unionDefs.get(tagName);
        if (def) return def;
      } else {
        const sym = this.globalSymbols.get(tagName);
        if (sym && sym.kind === SymbolKind.EnumTag) return sym.type;
      }
      // Forward-declared or unknown tag
      return { kind: TypeKind.Incomplete, name: `${kind} ${tagName}` };
    }

    // Handle qualifiers: const, volatile, __IO, __IM, __OM (CMSIS)
    let qualifiers: Set<string> | undefined;
    let stripped = false;
    for (const q of ['const', 'volatile', '__IO', '__IM', '__OM']) {
      if (s.startsWith(q + ' ') || s.includes(' ' + q)) {
        if (!qualifiers) qualifiers = new Set();
        qualifiers.add(q);
        s = s.replace(new RegExp('\\b' + q + '\\b', 'g'), '').trim();
        stripped = true;
      }
    }
    if (stripped) {
      // Guard: if stripping didn't change s, don't recurse
      if (s === typeStr.trim()) {
        return { kind: TypeKind.Unknown, name: s };
      }
      const inner = this.parseTypeString(s, _depth + 1);
      if (qualifiers && qualifiers.size > 0) {
        inner.qualifiers = qualifiers as any;
      }
      return inner;
    }

    // Unknown type — return as-is for later resolution
    return { kind: TypeKind.Unknown, name: s };
  }

  private createEnumType(name: string | undefined, body: string): ResolvedType {
    const values = body.split(',').map(v => v.trim()).filter(v => v.length > 0);
    const enumType: ResolvedType = {
      kind: TypeKind.Enum,
      name,
      underlyingType: {
        kind: TypeKind.Primitive,
        name: 'int',
        size: DEFAULT_CONFIG.intSize,
        alignment: DEFAULT_CONFIG.intSize,
      },
      enumerators: values.map(v => {
        const eqIdx = v.indexOf('=');
        const enumName = eqIdx >= 0 ? v.substring(0, eqIdx).trim() : v;
        let enumValue: number | undefined;
        if (eqIdx >= 0) {
          enumValue = parseInt(v.substring(eqIdx + 1).trim(), 10);
        }
        this.globalSymbols.set(enumName, {
          name: enumName,
          kind: SymbolKind.EnumConstant,
          type: {
            kind: TypeKind.Primitive,
            name: 'int',
            size: DEFAULT_CONFIG.intSize,
            alignment: DEFAULT_CONFIG.intSize,
          },
          sourceRow: 0,
          sourceColumn: 0,
        });
        return { name: enumName, value: enumValue };
      }),
    };

    if (name) {
      this.globalSymbols.set(name, {
        name,
        kind: SymbolKind.EnumTag,
        type: enumType,
        sourceRow: 0,
        sourceColumn: 0,
      });
    }

    return enumType;
  }

  private getWordAt(text: string, line: number, column: number): string | null {
    const lineStart = this.lineMap[line] ?? 0;
    const lineEnd = text.indexOf('\n', lineStart);
    const lineText = lineEnd === -1 ? text.substring(lineStart) : text.substring(lineStart, lineEnd);
    const re = /[A-Za-z_]\w*/g;
    let match;
    while ((match = re.exec(lineText)) !== null) {
      if (column >= match.index && column < match.index + match[0].length) {
        return match[0];
      }
    }
    return null;
  }
}
